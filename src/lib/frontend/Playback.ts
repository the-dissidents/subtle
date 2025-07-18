console.info('Playback loading');

import { tick } from "svelte";
import { get, writable, type Readable } from "svelte/store";
import { Debug } from "../Debug";
import { EventHost } from "../details/EventHost";
import { Overridable } from "../details/Overridable.svelte";
import type { MediaSampler2 } from "../component/timeline/MediaSampler2";
import { InputConfig } from "../config/Groups";
import { UICommand } from "./CommandBase";
import { CommandBinding, KeybindingManager } from "./Keybinding";
import { unwrapFunctionStore, _ } from "svelte-i18n";
import { guardAsync } from "./Frontend";
import { MediaPlayerInterface2, type MediaPlayer2, type SetPositionOptions } from "../component/preview/MediaPlayer2";

const $_ = unwrapFunctionStore(_);

export type PlayArea = {
    start: number | undefined,
    end: number | undefined,
    loop: boolean
}

let isLoaded = writable(false),
    position = 0,
    duration = 0;

const me = {};
tick().then(() => {
    MediaPlayerInterface2.onPlayback.bind(me, async (pos) => {
        position = pos;
        Playback.onPositionChanged.dispatch(pos);

        if (Playback.isPlaying) {
            const playArea = Playback.playArea.value;
            // if (playArea.start !== undefined && position < playArea.start) {
            //     Debug.debug('jumping to in point from before', playArea, position);
            //     // await this.play(false);
            //     await Playback.setPosition(playArea.start);
            //     return;
            // }
            if (playArea.end !== undefined && position > playArea.end) {
                Debug.debug('jumping to in point from after out point', playArea, position);
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
    get isLoaded(): Readable<boolean> { return isLoaded; },
    get isPlaying() { return this.player?.isPlaying ?? false; },

    player: null as MediaPlayer2 | null,
    sampler: null as MediaSampler2 | null,

    playArea: new Overridable<PlayArea>({
        start: undefined,
        end: undefined,
        loop: false
    }),

    onLoad: new EventHost<[rawurl: string, id: number]>(),
    onLoaded: new EventHost<[]>(),
    onSetAudioStream: new EventHost<[id: number]>(),
    onClose: new EventHost<[]>(),
    onPositionChanged: new EventHost<[pos: number]>(),

    async load(rawurl: string, audio: number) {
        await this.onLoad.dispatchAndAwaitAll(rawurl, audio);
        isLoaded.set(true);
        Debug.assert(this.player !== null);
        duration = this.player.duration!;
        Playback.onLoaded.dispatch();
    },

    async setAudioStream(id: number) {
        Debug.assert(this.player !== null);
        await Promise.all([
            this.player.setAudioStream(id),
            this.sampler?.setAudioStream(id),
        ]);
    },

    async close() {
        if (!get(isLoaded)) return Debug.early('not loaded');
        
        isLoaded.set(false);
        await this.onClose.dispatchAndAwaitAll()
        duration = 0;
        await this.forceSetPosition(0);
    },

    setPosition(pos: number, opt?: SetPositionOptions) {
        if (this.player === null)
            this.forceSetPosition(pos);
        else
            this.player.requestSeekToTime(pos, opt);
    },

    async forceSetPosition(pos: number) {
        if (this.player === null) {
            position = pos;
            Playback.onPositionChanged.dispatch(pos);
        } else {
            await this.player.seekToTime(pos);
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
        isApplicable: () => get(Playback.isLoaded),
        items: () => Playback.player!.streams
            .filter((x) => x.type == 'audio')
            .map((x) => ({
                name: x.description + (
                    x.index == Playback.player?.currentAudioStream 
                    ? ' ' + $_('menu.audio-stream-current') : ''),
                isApplicable: () => x.index != Playback.player?.currentAudioStream,
                async call() {
                    await guardAsync(() => Playback.setAudioStream(x.index),
                        $_('msg.failed-to-set-audio-stream'))
                }
            })),
        emptyText: () => $_('msg.no-available-item')
    }),
    togglePlay: new UICommand(() => $_('category.media'),
        [ CommandBinding.from(['Space'], ['Table', 'Timeline']),
          CommandBinding.from(['Alt+Space']), ],
    {
        name: () => $_('action.toggle-play'),
        call: () => Playback.toggle()
    }),
    toggleInPoint: new UICommand(() => $_('category.media'),
        [ CommandBinding.from(['I'], ['Table', 'Timeline']),
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
        [ CommandBinding.from(['O'], ['Table', 'Timeline']),
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
        [ CommandBinding.from(['CmdOrCtrl+ArrowLeft'], ['Timeline']),
          CommandBinding.from(['Alt+CmdOrCtrl+ArrowLeft']), ],
    {
        name: () => $_('action.previous-frame'),
        call: () => Playback.player?.requestPreviousFrame()
    }),
    nextFrame: new UICommand(() => $_('category.media'),
        [ CommandBinding.from(['CmdOrCtrl+ArrowRight'], ['Timeline']),
          CommandBinding.from(['Alt+CmdOrCtrl+ArrowRight']), ],
    {
        name: () => $_('action.next-frame'),
        call: () => Playback.player?.requestNextFrame()
    }),
    jumpBackward: new UICommand(() => $_('category.media'),
        [ CommandBinding.from(['ArrowLeft'], ['Timeline']),
          CommandBinding.from(['Alt+ArrowLeft']), ],
    {
        name: () => $_('action.jump-backward'),
        call: () => Playback.setPosition(Playback.position - InputConfig.data.skipDuration)
    }),
    jumpForward: new UICommand(() => $_('category.media'),
        [ CommandBinding.from(['ArrowRight'], ['Timeline']),
          CommandBinding.from(['Alt+ArrowRight']), ],
    {
        name: () => $_('action.jump-forward'),
        call: () => Playback.setPosition(Playback.position + InputConfig.data.skipDuration)
    }),
}
KeybindingManager.register(PlaybackCommands);