console.info('Playback loading');

import { tick } from "svelte";
import { get, writable, type Readable } from "svelte/store";
import { Debug } from "../Debug";
import { MediaPlayerInterface, MediaPlayer, type SetPositionOptions } from "../component/preview/MediaPlayer";
import { EventHost } from "../details/EventHost";
import { Overridable } from "../details/Overridable.svelte";
import type { MediaSampler2 } from "../component/timeline/MediaSampler2";

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
    MediaPlayerInterface.onPlayback.bind(me, async (pos) => {
        position = pos;
        Playback.onPositionChanged.dispatch(pos);
        Playback.onRefreshPlaybackControl.dispatch();

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

    player: null as MediaPlayer | null,
    sampler: null as MediaSampler2 | null,

    playArea: new Overridable<PlayArea>({
        start: undefined,
        end: undefined,
        loop: false
    }),

    onLoad: new EventHost<[rawurl: string, id: number]>(),
    onSetAudioStream: new EventHost<[id: number]>(),
    onClose: new EventHost<[]>(),
    
    onPositionChanged: new EventHost<[pos: number]>(),
    onRefreshPlaybackControl: new EventHost<[]>(),

    async load(rawurl: string, audio: number) {
        await this.onLoad.dispatchAndAwaitAll(rawurl, audio);
        isLoaded.set(true);
        Debug.assert(this.player !== null);
        duration = this.player.duration!;
        Playback.onRefreshPlaybackControl.dispatch();
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
        // this.forceSetPosition(0);
        Playback.onRefreshPlaybackControl.dispatch();
    },

    setPosition(pos: number, opt?: SetPositionOptions) {
        if (this.player === null)
            this.forceSetPosition(pos);
        else
            this.player.requestSetPosition(pos, opt);
    },

    async forceSetPosition(pos: number) {
        if (this.player === null) {
            position = pos;
            Playback.onPositionChanged.dispatch(pos);
        } else {
            await this.player.forceSetPosition(pos);
        }
    },

    async play(state = true) {
        Debug.assert(this.player !== null);
        await (state ? this.player.requestStartPlay() : this.player.stop());
    },

    async toggle() {
        Debug.assert(this.player !== null);
        await this.play(!this.player.isPlaying);
    }
}
