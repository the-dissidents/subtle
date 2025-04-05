console.info('Playback loading');

import { tick } from "svelte";
import { get, writable, type Readable } from "svelte/store";
import { Debug } from "../Debug";
import { Timeline } from "../Timeline.svelte";
import { VideoPlayer } from "../VideoPlayer";
import { ChangeType, Source } from "./Source";

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
    Playback.timeline?.setCursorPosPassive(pos);
    Playback.onRefreshPlaybackControl();
};

async function handlePlayArea() {
    const playArea = Playback.playAreaOverride ?? Playback.playArea;
    // if (playArea.start !== undefined && position < playArea.start) {
    //     Debug.debug('jumping to in point from before', playArea, position);
    //     // await this.play(false);
    //     await Playback.setPosition(playArea.start);
    //     return;
    // }
    if (playArea.end !== undefined && position > playArea.end) {
        Debug.debug('jumping to in point from after out point', playArea, position);
        Playback.playAreaOverride = undefined;
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
    timeline: null as Timeline | null,

    playArea: {
        start: undefined,
        end: undefined,
        loop: false
    } as PlayArea,

    playAreaOverride: undefined as PlayArea | undefined,

    onRefreshPlaybackControl: () => { },

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
            Debug.assert(this.video != null);
            this.onRefreshPlaybackControl();
        };
        return this.video;
    },

    createTimeline(canvas: HTMLCanvasElement) {
        Debug.assert(this.timeline == null);
        this.timeline = new Timeline(canvas);
        return this.timeline;
    },

    async load(rawurl: string) {
        Debug.assert(this.video !== null);
        Debug.assert(this.timeline !== null);
        await Promise.all([
            this.video.load(rawurl),
            this.timeline.load(rawurl)
        ]);
        isLoaded.set(true);
        duration = this.video.duration!;
        this.onRefreshPlaybackControl();
    },

    async close() {
        if (!get(isLoaded)) return Debug.early('not loaded');
        
        Debug.assert(this.video !== null);
        Debug.assert(this.timeline !== null);
        isLoaded.set(false);
        await Promise.all([
            this.video.close(),
            this.timeline.close()
        ]);
        duration = 0;
        this.onRefreshPlaybackControl();
    },

    setPosition(pos: number) {
        if (this.video) {
            this.video.requestSetPosition(pos);
        } else {
            updateProgress(pos);
        }
    },

    async forceSetPosition(pos: number) {
        Debug.assert(this.video !== null);
        await this.video.forceSetPosition(pos);
    },

    async play(state = true) {
        Debug.assert(this.video !== null);
        await this.video.play(state);
    },

    async toggle() {
        Debug.assert(this.video !== null);
        await this.video.play(!this.video.isPlaying);
    }
}
