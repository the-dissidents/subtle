console.info('Playback loading');

import { tick } from "svelte";
import { get, writable, type Readable } from "svelte/store";
import { Debug } from "../Debug";
import { VideoPlayer, type SetPositionOptions } from "../VideoPlayer";
import { ChangeType, Source } from "./Source";
import { EventHost } from "../details/EventHost";
import { Overridable } from "../details/Overridable.svelte";

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
    Source.onSubtitlesChanged.bind(me, (type) => {
        if (!Playback.video?.subRenderer) return Debug.early('no subRenderer');
        if (type == ChangeType.Times || type == ChangeType.General)
            Playback.video.subRenderer.updateTimes();
        Playback.video.requestRender();
    });
    
    Source.onSubtitleObjectReload.bind(me, () => {
        Playback.video?.setSubtitles(Source.subs);
    });
});

function updateProgress(pos: number) {
    position = pos;
    Playback.onPositionChanged.dispatch(pos);
    Playback.onRefreshPlaybackControl.dispatch();
};

async function handlePlayArea() {
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

export const Playback = {
    get position() { return position; },
    get duration() { return duration; },
    get isLoaded(): Readable<boolean> { return isLoaded; },
    get isPlaying() { return this.video?.isPlaying ?? false; },

    video: null as VideoPlayer | null,

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

    createVideo(canvas: HTMLCanvasElement) {
        Debug.assert(this.video == null);
        this.video = new VideoPlayer(canvas);
        this.video.setSubtitles(Source.subs);
        this.video.onVideoPositionChange = () => {
            Debug.assert(this.video != null);
            updateProgress(this.video.currentTimestamp);
            handlePlayArea();
        };
        this.video.onPlayStateChange = () => {
            Playback.onRefreshPlaybackControl.dispatch();
        };
        return this.video;
    },

    async load(rawurl: string, audio: number) {
        Debug.assert(this.video !== null);
        await Promise.all([
            this.video.load(rawurl, audio),
            this.onLoad.dispatchAndAwaitAll(rawurl, audio)
        ]);
        isLoaded.set(true);
        duration = this.video.duration!;
        Playback.onRefreshPlaybackControl.dispatch();
    },

    async setAudioStream(id: number) {
        Debug.assert(this.video !== null);
        await Promise.all([
            this.video.setAudioStream(id),
            this.onSetAudioStream.dispatchAndAwaitAll(id)
        ]);
    },

    async close() {
        if (!get(isLoaded)) return Debug.early('not loaded');
        
        Debug.assert(this.video !== null);
        isLoaded.set(false);
        await Promise.all([
            this.video.close(),
            this.onClose.dispatchAndAwaitAll()
        ]);
        duration = 0;
        Playback.onRefreshPlaybackControl.dispatch();
    },

    setPosition(pos: number, opt?: SetPositionOptions) {
        Debug.assert(this.video !== null);
        this.video.requestSetPosition(pos, opt);
    },

    async forceSetPosition(pos: number) {
        Debug.assert(this.video !== null);
        await this.video.forceSetPosition(pos);
    },

    async play(state = true) {
        Debug.assert(this.video !== null);
        await (state ? this.video.requestStartPlay() : this.video.stop());
    },

    async toggle() {
        Debug.assert(this.video !== null);
        await this.play(!this.video.isPlaying);
    }
}
