console.info('Playback loading');

import { assert } from "../Basic";
import { VideoPlayer } from "../VideoPlayer";
import { Timeline } from "../Timeline.svelte";
import { ChangeType, Source } from "./Source";
import { tick } from "svelte";

export type PlayArea = {
    start: number | undefined,
    end: number | undefined,
    loop: boolean
}

let isLoaded = false,
    position = 0,
    duration = 0;

const me = {};

tick().then(() => {
    Source.onSubtitlesChanged.bind(me, (times) => {
        if (!Playback.video?.subRenderer) return;
        if (times == ChangeType.Times || times == ChangeType.General)
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
    //     console.log('jumping to in point from before', playArea, position);
    //     // await this.play(false);
    //     await Playback.setPosition(playArea.start);
    //     return;
    // }
    if (playArea.end !== undefined && position > playArea.end) {
        console.log('jumping to in point from after out point', playArea, position);
        Playback.playAreaOverride = undefined;
        if (!playArea.loop) await Playback.play(false);
        await Playback.forceSetPosition(playArea.start ?? 0);
        return;
    }
}

export const Playback = {
    get position() { return position; },
    get duration() { return duration; },
    get isLoaded() { return isLoaded; },
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
        assert(this.video == null);
        this.video = new VideoPlayer(canvas);
        this.video.setSubtitles(Source.subs);
        this.video.onVideoPositionChange = () => {
            assert(this.video != null);
            updateProgress(this.video.currentTimestamp);
            handlePlayArea();
        };
        this.video.onPlayStateChange = () => {
            assert(this.video != null);
            this.onRefreshPlaybackControl();
        };
        return this.video;
    },

    createTimeline(canvas: HTMLCanvasElement) {
        assert(this.timeline == null);
        this.timeline = new Timeline(canvas);
        return this.timeline;
    },

    async load(rawurl: string) {
        assert(this.video !== null);
        assert(this.timeline !== null);
        await Promise.all([
            this.video.load(rawurl),
            this.timeline.load(rawurl)
        ]);
        isLoaded = true;
        duration = this.video.duration!;
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
        assert(this.video !== null);
        await this.video.forceSetPosition(pos);
    },

    async play(state = true) {
        assert(this.video !== null);
        await this.video.play(state);
    },

    async toggle() {
        assert(this.video !== null);
        await this.video.play(!this.video.isPlaying);
    }
}
