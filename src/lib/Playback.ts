import { assert } from "./Basic";
import { Subtitles } from "./Subtitles";
import { VideoPlayer } from "./VideoPlayer";
import { Timeline } from "./Timeline";
import { ChangeType, Frontend } from "./Frontend";

export type PlayArea = {
    start: number | undefined,
    end: number | undefined,
    loop: boolean
}

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

    playArea: PlayArea = {
        start: undefined,
        end: undefined,
        loop: false
    };

    playAreaOverride: PlayArea | undefined = undefined;

    onRefreshPlaybackControl = () => { };

    constructor(private readonly frontend: Frontend) {
        frontend.onSubtitlesChanged.bind((times, cause) => {
            if (!this.video?.subRenderer) return;
            if (times == ChangeType.Times || times == ChangeType.General)
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
        this.video.onVideoPositionChange = () => {
            assert(this.video != null);
            if (this.#isPlaying) {
                this.#updateProgress(this.video.currentPosition!);
                this.#handlePlayArea();
            }
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
        return this.timeline;
    }

    async load(rawurl: string) {
        assert(this.video !== null);
        assert(this.timeline !== null);
        await Promise.all([
            this.video.load(rawurl),
            this.timeline.load(rawurl)
        ]);
        this.#isLoaded = true;
        this.#duration = this.video.duration!;
        this.onRefreshPlaybackControl();
    }

    #updateProgress(pos: number) {
        this.#position = pos;
        this.timeline?.setCursorPosPassive(pos);
        this.onRefreshPlaybackControl();
    }

    async setPosition(pos: number) {
        this.#updateProgress(pos);
        await this.video?.setPosition(pos);
    }

    async #handlePlayArea() {
        const playArea = this.playAreaOverride ?? this.playArea;
        if (playArea.start !== undefined && this.position < playArea.start) {
            await this.play(false);
            await this.setPosition(playArea.start);
            return;
        }
        if (playArea.end !== undefined && this.position > playArea.end) {
            if (!playArea.loop) await this.play(false);
            await this.setPosition(playArea.start ?? 0);
            return;
        }
    }

    async play(state = true) {
        assert(this.video !== null);
        this.video.play(state);
    }

    async toggle() {
        await this.play(!this.#isPlaying);
    }
}
