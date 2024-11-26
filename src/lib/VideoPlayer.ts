import { SubtitleRenderer } from "./SubtitleRenderer";
import type { Subtitles } from "./Subtitles";
import type { WithCanvas } from "./CanvasKeeper";
import { convertFileSrc } from "@tauri-apps/api/core";
import { IPCClient, MAPI } from "./API";

export class VideoPlayer implements WithCanvas {
    #video: HTMLVideoElement;
    #ctx: CanvasRenderingContext2D;

    #sourceUrl: string | undefined = undefined;
    #loaded = false;
    #playing = false;
    #position = 0;
    #requestedRender = false;

    get duration() {return this.#video.duration;}
    get width() {return this.#video.videoWidth;}
    get height() {return this.#video.videoHeight;}
    get ratio() {return this.width / this.height;}
    get currentPosition() {return this.#position;}
    get isLoaded() {return this.#loaded;}
    get isPlaying() {return this.#playing;}
    get source() {return this.#sourceUrl;}

    #displayWidth = 1920;
    #displayHeight = 1080;
    #subRenderer?: SubtitleRenderer;
    #ipc?: IPCClient;

    get subRenderer() {return this.#subRenderer;}

    onPositionChange = () => {};
    onPlayStateChange = () => {};

    constructor(ctx: CanvasRenderingContext2D) {
        this.#video = document.createElement('video');
        this.#ctx = ctx;

        IPCClient.create().then((x) => {
            this.#ipc = x;
            MAPI.testSocket();
        });
    }

    setDisplaySize(w: number, h: number) {
        let factor = window.devicePixelRatio;
        this.#displayWidth = Math.floor(w * factor);
        this.#displayHeight = Math.floor(h * factor);
        this.subRenderer?.changeResolution(
            this.#displayWidth, this.#displayHeight);
        this.requestRender();
    }

    setSubtitles(subs: Subtitles) {
        if (!this.subRenderer) this.#subRenderer = 
            new SubtitleRenderer(this.#displayWidth, this.#displayHeight, subs);
        else this.#subRenderer?.changeSubtitles(subs);
        this.requestRender();
    }

    async load(rawurl: string) {
        const url = convertFileSrc(rawurl);
        return new Promise<void>((resolve, reject) => {
            let handler1 = () => {
                this.#video.removeEventListener('loadeddata', handler1);
                this.#playing = false;
                this.#loaded = true;
                this.#sourceUrl = url;
                this.onPlayStateChange();
                this.setPosition(0);
                resolve();
            };
            let handler2 = (ev: ErrorEvent) => {
                this.#video.removeEventListener('error', handler2);
                reject('error loading video: ' + ev.message);
            }
            this.#video.addEventListener('loadeddata', handler1);
            this.#video.addEventListener('error', handler2);
            this.#video.src = url;
            this.#video.load();
        });
    }

    async setPosition(t: number) {
        if (t < 0) t = 0;
        if (t > this.duration) t = this.duration;
        return new Promise<void>((resolve) => {
            let handler = () => {
                this.#video.removeEventListener('seeked', handler);
                this.#position = t;
                this.onPositionChange();
                this.requestRender();
                resolve();
            };
            this.subRenderer?.setTime(t);
            if (!this.#loaded) {
                this.#position = t;
                this.requestRender();
                resolve();
                return;
            }
            this.#playing = false;
            //this.#video.pause();
            this.#video.addEventListener('seeked', handler);
            this.#video.currentTime = t;
        });
    }

    #render(metadata?: VideoFrameCallbackMetadata) {
        this.#requestedRender = false;
        let w = this.#displayWidth, h = this.#displayHeight;
        this.#ctx.clearRect(0, 0, w, h);
        //console.log('render');
        if (this.#loaded) {
            let nw: number, nh: number;
            let ratio = this.ratio;
            if (w / h < ratio)
                [nw, nh] = [w, w / ratio];
            else
                [nw, nh] = [h * ratio, h];
            let x = (w - nw) / 2, y = (h - nh) / 2;
            this.#ctx.drawImage(this.#video, x, y, nw, nh);
            //this.#position = metadata.mediaTime;
            this.#position = this.#video.currentTime;
            this.subRenderer?.setTime(this.#position);
            this.onPositionChange();
        }
        if (this.subRenderer)
            this.#ctx.drawImage(this.subRenderer.getCanvas(), 0, 0);
        if (this.#loaded && this.#playing)
            this.requestRender();
    }

    requestRender() {
        if (this.#requestedRender) return;
        //this.#requestedRender = true;
        if (this.#playing) 
            this.#video.requestVideoFrameCallback(
                (_, m) => this.#render(m));
        else requestAnimationFrame((_) => this.#render());
    }

    play(state = true) {
        return new Promise<void>((resolve, reject) => {
            if (this.#video.readyState < 2)
                reject('not ready');
            else if (!state && this.#playing) {
                this.#video.pause();
                this.#playing = false;
                this.onPlayStateChange();
                resolve();
            } else if (state && !this.#playing) {
                this.#video.play().then((x) => {
                    this.#playing = true;
                    this.onPlayStateChange();
                    this.requestRender();
                    resolve();
                });
            } else resolve();
        });
    }
}