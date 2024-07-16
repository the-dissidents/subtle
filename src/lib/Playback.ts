import { assert } from "./Basic";
import { Subtitles } from "./Subtitles";
import { VideoPlayer } from "./VideoPlayer";
import { Timeline } from "./Timeline";
import { Frontend } from "./Frontend";

export class Playback {
    #isLoaded = false;
    #isPlaying = false;
    #position = 0;
    #duration = 0;
    get position() { return this.#position; }
    get duration() { return this.#duration; }
    get isLoaded() { return this.#isLoaded; }
    get isPlaying() { return this.#isPlaying; }

    video: VideoPlayer | null = null;
    timeline: Timeline | null = null;

    onRefreshPlaybackControl = () => { };

    constructor(private readonly frontend: Frontend) {
        frontend.onSubtitlesChanged.bind((times, cause) => {
            if (!this.video?.subRenderer) return;
            if (times)
                this.video.subRenderer.updateTimes();
            this.video.subRenderer.requireRerender();
        });
        frontend.onSubtitleObjectReload.bind(() => {
            this.video?.setSubtitles(frontend.subs);
        })
    }

    createVideo(cxt: CanvasRenderingContext2D, subs: Subtitles) {
        assert(this.video == null);
        this.video = new VideoPlayer(cxt);
        this.video.setSubtitles(subs);
        this.video.onPositionChange = () => {
            assert(this.video != null);
            if (this.#isPlaying)
                this.#reportProgress(this.video.currentPosition);
            this.onRefreshPlaybackControl();
        };
        this.video.onPlayStateChange = () => {
            assert(this.video != null);
            this.#isPlaying = this.video.isPlaying;
            this.onRefreshPlaybackControl();
        };
        return this.video;
    }

    createTimeline(cxt: CanvasRenderingContext2D, frontend: Frontend) {
        assert(this.timeline == null);
        this.timeline = new Timeline(cxt, frontend);
        this.timeline.onPositionChange = (passive) => {
            assert(this.timeline != null);
            if (passive) return;
            this.#position = this.timeline.cursorPos;
            if (this.video) this.video.setPosition(this.#position);
            this.onRefreshPlaybackControl();
        }
        return this.timeline;
    }

    async load(url: string) {
        assert(this.video !== null);
        assert(this.timeline !== null);
        await Promise.allSettled([
            this.video.load(url),
            this.timeline.load(url)
        ]);
        this.#isLoaded = true;
        this.#duration = this.video.duration;
        this.onRefreshPlaybackControl();
    }

    #reportProgress(pos: number) {
        this.#position = pos;
        this.timeline?.setCursorPos(pos, true);
        this.onRefreshPlaybackControl();
    }

    async setPosition(pos: number) {
        if (!this.video) {
            this.#position = pos;
            this.timeline?.setCursorPos(pos, true);
        } else {
            assert(this.timeline !== null);
            await this.video.setPosition(pos);
            this.#position = pos;
            this.timeline?.setCursorPos(pos, true);
        }
    }

    async play(state = true) {
        assert(this.video !== null);
        await this.video.play(state);
    }

    async toggle() {
        await this.play(!this.#isPlaying);
    }
}
