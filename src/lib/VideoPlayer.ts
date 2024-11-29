import { SubtitleRenderer } from "./SubtitleRenderer";
import type { Subtitles } from "./Subtitles";
import type { WithCanvas } from "./CanvasKeeper";
import { MMedia, type VideoFrameData } from "./API";
import { assert } from "./Basic";

const LATENCY_DAMPING = 10;

export class VideoPlayer implements WithCanvas {
    #ctx: CanvasRenderingContext2D;
    #media?: MMedia;
    #sourceUrl: string | undefined = undefined;
    #playing = false;
    #requestedRender = false;

    #canvasWidth = 640;
    #canvasHeight = 480;
    #outOffsetX = 0;
    #outOffsetY = 0;

    #requestedTime = 0;
    #lastRenderTime = 0;
    #retrieveTime = 0;
    #frameTime = 0;
    #waitTimeCorrection = 0;

    #framerate: number | undefined = undefined;
    #position: number | undefined = undefined;
    #targetPosition: number | undefined = undefined;

    get duration() {return this.#media?.duration;}
    get framerate() {return this.#framerate;}
    get currentPosition() {return this.#position;}

    get isLoaded() {return this.#media !== undefined;}
    get isPlaying() {return this.#playing;}
    get source() {return this.#sourceUrl;}

    get size() {return this.#media?.videoSize;}
    get ratio() {
        if (!this.#media) return undefined;
        let [width, height] = this.size!;
        return width / height;
    }

    #subRenderer?: SubtitleRenderer;

    get subRenderer() {return this.#subRenderer;}

    onPositionChange = () => {};
    onPlayStateChange = () => {};

    constructor(ctx: CanvasRenderingContext2D) {
        this.#ctx = ctx;
    }

    async setDisplaySize(w: number, h: number) {
        let factor = window.devicePixelRatio;
        this.#canvasWidth = Math.floor(w * factor);
        this.#canvasHeight = Math.floor(h * factor);
        this.subRenderer?.changeResolution(this.#canvasWidth, this.#canvasHeight);
        if (this.#media) await this.#updateOutputSize();
        this.requestRender();
    }

    async #updateOutputSize() {
        assert(this.#media !== undefined);
        let [w, h] = [this.#canvasWidth, this.#canvasHeight];
        let nw: number, nh: number;
        let ratio = this.ratio!;
        if (w / h < ratio)
            [nw, nh] = [w, w / ratio];
        else
            [nw, nh] = [h * ratio, h];
        this.#outOffsetX = (w - nw) / 2;
        this.#outOffsetY = (h - nh) / 2;
        await this.#media.setVideoSize(nw, nh);
    }

    setSubtitles(subs: Subtitles) {
        if (!this.subRenderer) this.#subRenderer = 
            new SubtitleRenderer(this.#canvasWidth, this.#canvasHeight, subs);
        else this.#subRenderer?.changeSubtitles(subs);
        this.requestRender();
    }

    _testGetMedia() {
        return this.#media;
    }
    
    async load(rawurl: string) {
        if (this.#media !== undefined && !this.#media.isClosed) {
            this.#media.close();
        }
        this.#media = await MMedia.open(rawurl);
        await this.#media.openVideo(-1);
        await this.#updateOutputSize();

        const status = await this.#media.videoStatus();
        assert(status !== null);
        this.#framerate = status.framerate;
        this.#position = 0;
        console.log('framerate=', this.#framerate);

        this.#media.onReceiveVideoFrame = (data) => this.#render(data);
        this.requestRender();
    }

    async setPosition(t: number) {
        assert(this.#media !== undefined);
        if (t == this.#position) return;

        if (t < 0) t = 0;
        if (t > this.duration!) t = this.duration!;
        await this.#media.seekVideo(Math.floor(t * this.#framerate!));
        this.#position = (await this.#media.videoPosition()) / this.#framerate!;
        this.onPositionChange();
        this.requestRender();
    }

    async #render(data?: VideoFrameData) {
        this.#requestedRender = false;
        let t0 = performance.now();

        this.#ctx.clearRect(0, 0, this.#canvasWidth, this.#canvasHeight);
        if (data) {
            assert(this.#media !== undefined);
            this.#position = data.time;

            let [nw, nh] = this.#media?.videoOutputSize;
            let imgData = new ImageData(data.content, data.stride);
            this.#ctx.putImageData(imgData, 
                this.#outOffsetX, this.#outOffsetY, 0, 0, nw, nh);
            this.subRenderer?.setTime(this.#position);

            if (this.#playing) {
                const K = Math.exp(-LATENCY_DAMPING * (t0 - this.#lastRenderTime) / 1000);
                this.#retrieveTime = 
                    this.#retrieveTime * K + (t0 - this.#requestedTime) * (1-K);
                this.#frameTime = 
                    this.#frameTime * K + (t0 - this.#lastRenderTime) * (1-K);
                this.#lastRenderTime = t0;

                let waitTime = (1000 / this.#framerate!) - this.#retrieveTime;
                this.#ctx.fillStyle = 'red';
                this.#ctx.font='20px sans-serif';
                this.#ctx.fillText(`tar=${(1000 / this.#framerate!).toFixed(1)}`, 0, 10);
                this.#ctx.fillText(`fra=${this.#frameTime.toFixed(1)}`, 0, 30);
                this.#ctx.fillText(`ret=${this.#retrieveTime.toFixed(1)}`, 0, 50);
                this.#ctx.fillText(`wai=${waitTime.toFixed(1)}`, 0, 70);
                this.#ctx.fillText(`cor=${this.#waitTimeCorrection.toFixed(1)}`, 0, 90);
            }
        }
        if (this.subRenderer)
            this.#ctx.drawImage(this.subRenderer.getCanvas(), 0, 0);

        if (data && this.#playing) {
            await this.#media!.moveToNextVideoFrame();
            this.onPositionChange();

            let targetTime = 1000 / this.#framerate!;
            this.#waitTimeCorrection += targetTime - this.#frameTime;
            this.#waitTimeCorrection = Math.min(10, Math.max(-20, this.#waitTimeCorrection));

            let waitTime = targetTime - this.#retrieveTime + this.#waitTimeCorrection;
            if (waitTime > 0) setTimeout(() => this.requestRender(), waitTime)
            else this.requestRender();
        }
    }

    requestRender() {
        if (this.#requestedRender) return;
        this.#requestedRender = true;
        this.#requestedTime = performance.now();
        if (this.#media == undefined) {
            requestAnimationFrame((_) => this.#render());
        } else {
            this.#media.readCurrentVideoFrame();
        }
    }

    play(state = true) {
        assert(this.#media !== undefined);
        if (!state && this.#playing) {
            this.#playing = false;
            this.onPlayStateChange();
        } else if (state && !this.#playing) {
            this.#playing = true;
            this.onPlayStateChange();
            this.requestRender();
        }
    }
}