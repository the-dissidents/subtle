console.info('Playback loading');

import { tick } from "svelte";
import { get, writable, type Readable } from "svelte/store";
import { Debug } from "../Debug";
import { AsyncEventHost, EventHost, showProgress } from "@the_dissidents/svelte-ui";
import { Overridable } from "../details/Overridable.svelte";
import type { MediaSampler } from "../component/timeline/MediaSampler";
import { InputConfig } from "../config/Groups";
import { UICommand } from "./CommandBase";
import { CommandBinding, KeybindingManager } from "./Keybinding";
import { unwrapFunctionStore, _ } from "svelte-i18n";
import { Frontend, guard, guardAsync } from "./Frontend";
import { MediaPlayerInterface, type MediaPlayer } from "$lib/component/preview/MediaPlayer";
import type { SeekOptions } from "$lib/component/preview/PlayerBuffer";
import { convertBackendSubtitles } from "$lib/core/formats/BackendSubtitles";
import { SubtitleUtil } from "$lib/core/SubtitleUtil.svelte";
import { Dialog } from "$lib/dialog";
import { openDialog } from "$lib/DialogOutlet.svelte";
import { Selection } from "./Editing";
import { Source, ChangeType } from "./Source";
import { MMedia } from "$lib/API";

const $_ = unwrapFunctionStore(_);

export type LoadState = 'empty' | 'loading' | 'loaded';

export type PlayArea = {
    start: number | undefined,
    end: number | undefined,
    loop: boolean
}

const loadState = writable<LoadState>('empty');
let position = 0,
    duration = 0;

const me = {};
void tick().then(() => {
    MediaPlayerInterface.onPlayback.bind(me, async (pos) => {
        position = pos;
        Playback.onPositionChanged.dispatch(pos);

        if (Playback.isPlaying) {
            const playArea = Playback.playArea.value;
            if (playArea.end !== undefined && position > playArea.end) {
                void Debug.debug('jumping to in point from after out point', playArea, position);
                Playback.playArea.override = null;
                if (!playArea.loop) await Playback.play(false);
                await Playback.forceSetPosition(playArea.start ?? 0);
                return;
            }
        }
    })
});

export const Playback = {
    get position() { return position; },
    get duration() { return duration; },
    get loaded() { return get(loadState) == 'loaded'; },
    get loadState(): Readable<LoadState> { return loadState; },
    get isPlaying() { return this.player?.isPlaying ?? false; },

    player: null as MediaPlayer | null,
    sampler: null as MediaSampler | null,

    playArea: new Overridable<PlayArea>({
        start: undefined,
        end: undefined,
        loop: false
    }),

    onLoad: new AsyncEventHost<[rawurl: string, id: number]>(),
    onClose: new AsyncEventHost<[]>(),
    onLoaded: new EventHost<[]>(),
    onSetAudioStream: new EventHost<[id: number]>(),
    onPositionChanged: new EventHost<[pos: number]>(),

    async load(rawurl: string, audio: number) {
        if (get(loadState) === 'loaded')
            return Debug.early();

        await Debug.debug('loadState -> loading');
        loadState.set('loading');
        try {
            await this.onLoad.dispatchAndAwaitAll(rawurl, audio);
            if (this.player === null)
                throw new Error('Playback.player is unexpectedly null');
        } catch (err) {
            await Debug.forwardError(err);
            await Debug.info('An error occurred when trying to load media. We now attempt to close it.');
            await this.close(true);
            if (get(loadState) == 'loading') {
                await Debug.info('To prevent loadState being still `loading`, we reset it to `empty`.')
                loadState.set('empty');
            }
            return;
        }
        duration = this.player.duration!;
        await Debug.debug('loadState -> loaded');
        loadState.set('loaded');
        Playback.onLoaded.dispatch();
    },

    async setAudioStream(id: number) {
        Debug.assert(this.player !== null);
        await Promise.all([
            this.player.setAudioStream(id),
            this.sampler?.setAudioStream(id),
        ]);
    },

    async close(force = false) {
        if (!force && get(loadState) != 'loaded')
            return Debug.early();

        try {
            await this.onClose.dispatchAndAwaitAll()
            await this.forceSetPosition(0);
            Debug.assert(this.player === null);
        } catch (err) {
            await Debug.forwardError(err);
            await Debug.info('An error occurred when trying to close media.');
            if (this.player === null)
                await Debug.info('However, since the player is null, we consider the media closed.');
            else
                await Debug.info('Since the player is not null, we do not change loadState.');
        } finally {
            if (this.player === null) {
                loadState.set('empty');
                duration = 0;
            }
        }
    },

    async setPosition(pos: number, opt?: SeekOptions) {
        if (this.player === null)
            await this.forceSetPosition(pos);
        else
            await this.player.seek(pos, opt);
    },

    snapPositionToFrame(pos: number, rounding: 'left' | 'right' | 'round') {
        if (!this.player || this.player.isVfr) return pos;
        const i = Math.max(0, pos * this.player.frameRate);
        return (rounding == 'left' ? Math.floor(i)
              : rounding == 'right' ? Math.ceil(i)
              : rounding == 'round' ? Math.round(i)
              : Debug.never(rounding)) / this.player.frameRate;
    },

    async forceSetPosition(pos: number) {
        if (this.player === null) {
            position = pos;
            Playback.onPositionChanged.dispatch(pos);
        } else {
            await this.player.seek(pos);
        }
    },

    async play(state = true) {
        Debug.assert(this.player !== null);
        await (state ? this.player.play() : this.player.stop());
    },

    async toggle() {
        Debug.assert(this.player !== null);
        await this.play(!this.player.isPlaying);
    }
}

export const PlaybackCommands = {
    selectAudioStream: new UICommand(() => $_('category.media'),
        [ ],
    {
        name: () => $_('menu.select-audio-stream'),
        isApplicable: () => get(Playback.loadState) == 'loaded',
        items: () => Playback.player?.streams.filter((x) => x.type == 'audio')
            .map((x) => ({
                name: `[${x.index}] ${x.type}: ${x.codecId ?? ''} ${x.languageCode}` + (
                    x.index == Playback.player?.currentAudioStream
                    ? ' ' + $_('menu.audio-stream-current') : ''),
                isApplicable: () => x.index != Playback.player?.currentAudioStream,
                async call() {
                    if (Playback.player) await guardAsync(
                        () => Playback.setAudioStream(x.index),
                        $_('msg.failed-to-set-audio-stream'))
                }
            })) ?? [],
        emptyText: () => $_('msg.no-available-item')
    }),
    extractSubtitles: new UICommand(() => $_('category.media'),
        [ ],
    {
        name: () => $_('action.extract-subtitle-track'),
        isApplicable: () => get(Playback.loadState) == 'loaded',
        items: () => Playback.player?.streams.filter((x) => x.type == 'subtitle')
            .map((x) => ({
                name: `[${x.index}] ${x.type}: ${x.codecId ?? ''} ${x.languageCode}`,
                async call() {
                    Debug.assert(!!Playback.player);
                    const result = await showProgress(
                        () => guardAsync(async () => {
                            const media = await MMedia.open(Playback.player!.source);
                            const subs = await media.extractSubtitles(x.index);
                            await media.close();
                            return subs;
                        }, $_('msg.failed-to-extract-subtitle-track'), null),
                        $_('msg.extracting-subtitle-track'), null);
                    if (!result) return;

                    const subs = guard(() => convertBackendSubtitles(result),
                        $_('msg.failed-to-extract-subtitle-track'), null);
                    if (!subs || subs.entries.length == 0) {
                        Frontend.setStatus($_('msg.failed-to-extract-subtitle-track'), 'error');
                        return;
                    }

                    const options = await openDialog(
                        Dialog.importOptions, subs.migrated != 'text', subs);
                    if (!options) return;

                    const entries = SubtitleUtil.merge(Source.subs, subs, options);
                    if (entries.length > 0) await Selection.set(entries);
                    await Source.markChanged(ChangeType.General, $_('c.import-extracted-track'));
                    Frontend.setStatus($_('msg.imported-extracted-track'));
                }
            })) ?? [],
        emptyText: () => $_('msg.no-available-item')
    }),
    togglePlay: new UICommand(() => $_('category.media'),
        [ CommandBinding.from(['Space'], ['Table', 'Timeline', 'Preview']),
          CommandBinding.from(['Alt+Space']), ],
    {
        name: () => $_('action.toggle-play'),
        call: async () => {
            if (Playback.player)
                await Playback.toggle();
        }
    }),
    toggleInPoint: new UICommand(() => $_('category.media'),
        [ CommandBinding.from(['I'], ['Table', 'Timeline', 'Preview']),
          CommandBinding.from(['Alt+I']), ],
    {
        name: () => $_('action.toggle-in-point'),
        call() {
            const pos = Playback.position;
            const area = Playback.playArea.setting;
            Playback.playArea.setting.start =
                (area.start == pos || (area.end !== undefined && area.end <= pos))
                ? undefined : pos;
        }
    }),
    toggleOutPoint: new UICommand(() => $_('category.media'),
        [ CommandBinding.from(['O'], ['Table', 'Timeline', 'Preview']),
          CommandBinding.from(['Alt+O']), ],
    {
        name: () => $_('action.toggle-out-point'),
        call() {
            const pos = Playback.position;
            const area = Playback.playArea.setting;
            Playback.playArea.setting.end =
                (area.end == pos || (area.start !== undefined && area.start >= pos))
                ? undefined : pos;
        }
    }),
    previousFrame: new UICommand(() => $_('category.media'),
        [ CommandBinding.from(['CmdOrCtrl+ArrowLeft'], ['Timeline', 'Preview']),
          CommandBinding.from(['Alt+CmdOrCtrl+ArrowLeft']), ],
    {
        name: () => $_('action.previous-frame'),
        call: () => Playback.player?.requestPreviousFrame()
    }),
    nextFrame: new UICommand(() => $_('category.media'),
        [ CommandBinding.from(['CmdOrCtrl+ArrowRight'], ['Timeline', 'Preview']),
          CommandBinding.from(['Alt+CmdOrCtrl+ArrowRight']), ],
    {
        name: () => $_('action.next-frame'),
        call: () => Playback.player?.requestNextFrame()
    }),
    jumpBackward: new UICommand(() => $_('category.media'),
        [ CommandBinding.from(['ArrowLeft'], ['Timeline', 'Preview']),
          CommandBinding.from(['Alt+ArrowLeft']), ],
    {
        name: () => $_('action.jump-backward'),
        call: () => Playback.setPosition(Playback.position - InputConfig.data.skipDuration)
    }),
    jumpForward: new UICommand(() => $_('category.media'),
        [ CommandBinding.from(['ArrowRight'], ['Timeline', 'Preview']),
          CommandBinding.from(['Alt+ArrowRight']), ],
    {
        name: () => $_('action.jump-forward'),
        call: () => Playback.setPosition(Playback.position + InputConfig.data.skipDuration)
    }),
}
KeybindingManager.register(PlaybackCommands);
