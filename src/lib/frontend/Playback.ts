import { assert } from "../Basic";
import { Subtitles } from "../core/Subtitles.svelte";
import { VideoPlayer } from "../VideoPlayer";
import { Timeline } from "../Timeline";
import { ChangeType, Source } from "./Source";
import { tick } from "svelte";

export type PlayArea = {
    start: number | undefined,
    end: number | undefined,
    loop: boolean
}

let isLoaded = false,
    isPlaying = false,
    position = 0,
    duration = 0;

const me = {};

tick().then(() => {
    Source.onSubtitlesChanged.bind(me, (times) => {
        if (!Playback.video?.subRenderer) return;
        if (times == ChangeType.Times || times == ChangeType.General)
            Playback.video.subRenderer.updateTimes();
        Playback.video.subRenderer.requireRerender();
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
    // FIXME: media set position is still buggy, and if it jumps not to the precise
    // position but slight before it, this will fail miserably. So commented out
    // for now

    // if (playArea.start !== undefined && this.position < playArea.start) {
    //     console.log('jumping to in point from before', playArea, this.position);
    //     // await this.play(false);
    //     await this.setPosition(playArea.start);
    //     return;
    // }
    if (playArea.end !== undefined && position > playArea.end) {
        console.log('jumping to in point from after out point', playArea, position);
        Playback.playAreaOverride = undefined;
        if (!playArea.loop) await Playback.play(false);
        await Playback.setPosition(playArea.start ?? 0);
        return;
    }
}

export const Playback = {
    get position() { return position; },
    get duration() { return duration; },
    get isLoaded() { return isLoaded; },
    get isPlaying() { return isPlaying; },

    video: null as VideoPlayer | null,
    timeline: null as Timeline | null,

    playArea: {
        start: undefined,
        end: undefined,
        loop: false
    } as PlayArea,

    playAreaOverride: undefined as PlayArea | undefined,

    onRefreshPlaybackControl: () => { },

    createVideo(cxt: CanvasRenderingContext2D) {
        assert(this.video == null);
        this.video = new VideoPlayer(cxt);
        this.video.setSubtitles(Source.subs);
        this.video.onVideoPositionChange = () => {
            assert(this.video != null);
            if (isPlaying) {
                updateProgress(this.video.currentPosition!);
                handlePlayArea();
            }
            this.onRefreshPlaybackControl();
        };
        this.video.onPlayStateChange = () => {
            assert(this.video != null);
            isPlaying = this.video.isPlaying;
            this.onRefreshPlaybackControl();
        };
        return this.video;
    },

    createTimeline(cxt: CanvasRenderingContext2D) {
        assert(this.timeline == null);
        this.timeline = new Timeline(cxt);
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

    async setPosition(pos: number) {
        updateProgress(pos);
        await this.video?.setPosition(pos);
    },

    async play(state = true) {
        assert(this.video !== null);
        this.video.play(state);
    },

    async toggle() {
        await this.play(!isPlaying);
    }
}
