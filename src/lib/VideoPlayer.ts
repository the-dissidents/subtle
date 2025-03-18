import { SubtitleRenderer } from "./SubtitleRenderer";
import type { Subtitles } from "./core/Subtitles.svelte";
import type { WithCanvas } from "./CanvasKeeper";
import { MMedia, type AudioFrameData, type VideoFrameData } from "./API";
import { assert } from "./Basic";

import decodedAudioLoaderUrl from './worker/DecodedAudioLoader?worker&url';
import type { AudioFeedbackData, AudioInputData } from "./worker/DecodedAudioLoader";
import { Interface } from "./frontend/Interface";

function sum(a: number[]) {
    return a.reduce((p, c) => p + c, 0);
}

export class VideoPlayer implements WithCanvas {
    #ctx: CanvasRenderingContext2D;
    #canvas: OffscreenCanvas;
    #ctxbuf: OffscreenCanvasRenderingContext2D;

    #sourceUrl: string | undefined = undefined;
    #playing = false;
    #requestedRender = false;

    #canvasWidth = 640;
    #canvasHeight = 480;
    #outOffsetX = 0;
    #outOffsetY = 0;

    // #requestedTime = 0;
    // #lastRenderTime = 0;
    // #processingTime = 0;
    // #frameTime = 0;
    // #waitTimeCorrection = 0;
    // #waitTime = 0;
    // #audioFullness = 0;

    #opened?: {
        framerate: number;
        sampleRate: number;
        media: MMedia;
        audioCxt: AudioContext;

        // manages audio cache and is used as the position reference
        worklet: AudioWorkletNode;
        onAudioFeedback?: (data: AudioFeedbackData) => void;
        audioHead: number;
        audioTail: number;
        audioBufferLength: number;
        audioSize: number;

        EOF: boolean;
        videoCache: VideoFrameData[];
        videoPosition: number;
    };

    // position used when no media opened
    #fallbackPosition: number = 0;

    get duration() { return this.#opened?.media.duration; }
    get framerate() { return this.#opened?.framerate; }
    get currentPosition() {
        if (!this.#opened || this.#opened.audioHead < 0)
            return this.#fallbackPosition;
        return this.#opened.audioHead;
    }

    get isLoaded() { return this.#opened !== undefined; }
    get isPlaying() { return this.#playing; }
    get source() { return this.#sourceUrl; }

    #subRenderer?: SubtitleRenderer;

    get subRenderer() {return this.#subRenderer;}

    onVideoPositionChange = () => {};
    onPlayStateChange = () => {};

    constructor(ctx: CanvasRenderingContext2D) {
        this.#ctx = ctx;
        this.#canvas = new OffscreenCanvas(this.#canvasWidth, this.#canvasHeight);
        let bufcxt = this.#canvas.getContext('2d', { alpha: false });
        if (!bufcxt) throw new Error("VideoPlayer: cannot create offscreen context");
        this.#ctxbuf = bufcxt;
    }

    async setDisplaySize(w: number, h: number) {
        let factor = window.devicePixelRatio;
        this.#canvasWidth = Math.floor(w * factor);
        this.#canvasHeight = Math.floor(h * factor);
        this.#canvas.width = this.#canvasWidth;
        this.#canvas.height = this.#canvasHeight;
        this.subRenderer?.changeResolution(this.#canvasWidth, this.#canvasHeight);
        if (this.#opened) await this.#updateOutputSize();
        this.requestRender();
    }

    async #updateOutputSize() {
        assert(this.#opened !== undefined);
        let [w, h] = [this.#canvasWidth, this.#canvasHeight];
        let [width, height] = this.#opened.media.videoSize!;
        let ratio = width / height;
        let nw: number, nh: number;
        if (w / h < ratio)
            [nw, nh] = [w, w / ratio];
        else
            [nw, nh] = [h * ratio, h];
        this.#outOffsetX = (w - nw) / 2;
        this.#outOffsetY = (h - nh) / 2;
        await this.#opened.media.setVideoSize(nw, nh);
    }

    setSubtitles(subs: Subtitles) {
        if (!this.subRenderer) this.#subRenderer = 
            new SubtitleRenderer(this.#canvasWidth, this.#canvasHeight, subs);
        else this.#subRenderer?.changeSubtitles(subs);
        this.requestRender();
    }

    _testGetMedia() {
        return this.#opened?.media;
    }
    
    async load(rawurl: string) {
        console.log('VideoPlayer: url=', rawurl);

        if (this.#opened && !this.#opened.media.isClosed) {
            await this.#opened.media.close();
            await this.#opened.audioCxt.close();
        }
        let media = await MMedia.open(rawurl);
        await media.openVideo(-1);
        await media.openAudio(-1);
        console.log('VideoPlayer: opened media');

        const audioStatus = await media.audioStatus();
        const videoStatus = await media.videoStatus();
        assert(audioStatus !== null);
        assert(videoStatus !== null);

        let audioCxt = new AudioContext({ sampleRate: audioStatus.sampleRate });
        await audioCxt.audioWorklet.addModule(decodedAudioLoaderUrl);
        const worklet = new AudioWorkletNode(audioCxt, "decoded-audio-loader");
        worklet.port.onmessage = (ev) => {
            if (Array.isArray(ev.data)) {
                // log
                console.log.apply(console, ev.data);
            } else {
                let feedback = ev.data as AudioFeedbackData;
                if (this.#opened?.onAudioFeedback)
                    this.#opened.onAudioFeedback(feedback);
            }
        }
        worklet.connect(audioCxt.destination);
        audioCxt.suspend();

        this.#opened = {
            media, audioCxt, worklet,
            framerate: videoStatus.framerate,
            sampleRate: audioStatus.sampleRate,
            EOF: false,
            audioHead: -1,
            audioTail: -1,
            audioBufferLength: 0,
            audioSize: 0,
            videoCache: [],
            videoPosition: 0,
        };

        await this.#updateOutputSize();
        this.requestPreload();
        this.requestRender();
        console.log('VideoPlayer: loaded media');
    }

    async postAudioMessage(msg: AudioInputData) {
        // TODO: add timeout?
        return await new Promise<void>((resolve, reject) => {
            assert(this.#opened !== undefined);
            this.#opened.onAudioFeedback = (data) => {
                assert(this.#opened !== undefined);
                if (data.headPosition) {
                    this.#opened.audioHead = data.headPosition / this.#opened!.sampleRate;
                }
                if (data.tailPosition)
                    this.#opened.audioTail = data.tailPosition / this.#opened!.sampleRate;
                this.#opened.audioSize = data.bufferSize;
                this.#opened.audioBufferLength = data.bufferLength;
                resolve();
            };
            this.#opened.worklet.port.postMessage(msg);
        });
    }

    async #clearCache() {
        if (!this.#opened) return;
        this.#opened.videoCache = [];
        this.#opened.EOF = false;
        this.#opened.audioHead = -1;
        this.#opened.audioTail = -1;
        await this.postAudioMessage({ type: 'clearBuffer' });
    }

    async #populateCache() {
        const PreloadAmount = 0.5; // in seconds

        if (!this.#opened || this.#opened.EOF) return false;
        const video = this.#opened.videoCache;
        const videoSize = sum(video.map((x) => x.content.length));
        
        if (video.length > 1 && video.at(-1)!.time - video[0].time > PreloadAmount
         && this.#opened.audioTail - this.#opened.audioHead > PreloadAmount) return false;

        const frame = await this.#opened.media.readNextFrame();
        if (!frame) {
            this.#opened.EOF = true;
            return false;
        }
        if (frame.type == 'audio') {
            if (this.#opened.audioTail > 0 && frame.time < this.#opened.audioTail) {
                await this.#clearCache();
                return true;
            }
            await this.postAudioMessage({ type: 'frame', frame });
        } else {
            if (video.length > 0 && frame.time < video.at(-1)!.time) {
                await this.#clearCache();
                return true;
            }
            video.push(frame);
        }
        // Interface.status.set(`${this.#opened.audioBufferLength}, ${this.#opened.videoCache.length}`);
        return true;
    }

    #requestedPreload = false;
    requestPreload() {
        if (this.#requestedPreload) return;
        this.#requestedPreload = true;
        const load = async () => {
            if (await this.#populateCache()) {
                setTimeout(load, 0);
            } else {
                this.#requestedPreload = false;
            }
        }
        // requestAnimationFrame(load);
        setTimeout(load, 0);
    }

    async setPosition(t: number) {
        if (t < 0) t = 0;
        if (t > this.duration!) t = this.duration!;
        if (this.#opened) {
            let position = Math.floor(t * this.#opened.framerate);
            await this.setPositionFrame(position);
        } else {
            if (t == this.#fallbackPosition) return;
            this.#fallbackPosition = t;
        }
        this.subRenderer?.setTime(t);
        this.requestRender();
    }

    async setPositionFrame(position: number) {
        assert(this.#opened !== undefined);
        position = Math.max(0, Math.floor(position));

        this.play(false);

        const video = this.#opened.videoCache;
        if (this.#opened.videoCache.length > 0) {
            if (position >= video[0].position && position <= video.at(-1)!.position) {
                while (position > video[0].position)
                    video.shift();
                await this.postAudioMessage({ type: 'shiftUntil', 
                    position: position / this.#opened.framerate * this.#opened.sampleRate });
                this.#fallbackPosition = position;
                this.requestPreload();
                this.onVideoPositionChange();
                Interface.status.set(`shifted to: (${position})`);
                return;
            }
        }

        await this.#clearCache();
        const frame = await this.#opened.media.seekVideoAndGetFrame(position);
        if (frame) this.#opened.videoCache.push(frame);
        Interface.status.set(`seeked to: ${frame?.position} (${position})`);
        this.#fallbackPosition = frame?.position ?? position;
        this.requestPreload();
        this.onVideoPositionChange();
    }

    async nextFrame() {
        if (!this.#opened) return;
        // await this.#opened.video.moveToNextVideoFrame();
        // await this.#opened.video.readCurrentVideoFrame();
    }

    async previousFrame() {
        if (!this.#opened) return;
        // await this.setPositionFrame(this.#opened.pos - 1);
        // await this.#opened.video.readCurrentVideoFrame();
    }

    #drawFrame(frame: VideoFrameData) {
        assert(this.#opened !== undefined);
        this.onVideoPositionChange();
        this.subRenderer?.setTime(frame.time);

        let [nw, nh] = this.#opened.media.videoOutputSize;
        let imgData = new ImageData(frame.content, frame.stride);

        this.#ctxbuf.clearRect(0, 0, this.#canvasWidth, this.#canvasHeight);
        this.#ctxbuf.putImageData(imgData, 
            this.#outOffsetX, this.#outOffsetY, 0, 0, nw, nh);
        if (this.subRenderer)
            this.#ctxbuf.drawImage(this.subRenderer.getCanvas(), 0, 0);

        this.#ctxbuf.fillStyle = 'red';
        this.#ctxbuf.font= `${window.devicePixelRatio * 10}px Courier`;
        this.#ctxbuf.fillText(
            `vt:${frame.time}`, 0, 20);
        this.#ctxbuf.fillText(
            `at:${this.#opened.audioHead}`, 0, 40);
        this.#ctxbuf.fillText(
            `vb:${this.#opened.videoCache.length}`, 0, 60);
        this.#ctxbuf.fillText(
            `ab:${this.#opened.audioBufferLength}`, 0, 80);
        this.#ctxbuf.fillText(
            `ps:${frame.position}`, 0, 100);
    }

    async #render() {
        this.#requestedRender = false;
        this.#ctx.globalCompositeOperation = 'copy';

        if (!this.#opened) {
            requestAnimationFrame(() => 
                this.#ctx.drawImage(this.subRenderer!.getCanvas(), 0, 0));
            return;
        }

        const video = this.#opened.videoCache;
        const tolerance = 1 / this.#opened.framerate;
        while (video.length > 0) {
            if (video[0].time < this.currentPosition - tolerance) {
                // discard missed frame
                video.shift();
            } else {
                // consume frame
                const frame = video.shift()!;
                console.log('consumed video frame', frame.position, video.length);
                this.#opened.videoPosition = frame.position;
                this.#drawFrame(frame);
                this.onVideoPositionChange();
                this.requestPreload();

                if (this.#playing) {
                    setTimeout(() => {
                        this.#render();
                    }, Math.max(0, frame.time - this.currentPosition) * 1000);
                }

                requestAnimationFrame(() => 
                    this.#ctx.drawImage(this.#canvas, 0, 0));
                return;
            }
        }
        this.requestPreload();
        requestAnimationFrame(() => this.#render());
    }

    requestRender() {
        if (this.#requestedRender) return;
        this.#requestedRender = true;
        requestAnimationFrame(() => this.#render());
    }

    play(state = true) {
        if (!this.#opened) return;
        
        if (!state && this.#playing) {
            this.#playing = false;
            this.#opened.audioCxt.suspend();
            this.onPlayStateChange();
        } else if (state && !this.#playing) {
            this.#playing = true;
            this.#opened.audioCxt?.resume();
            this.onPlayStateChange();
            // this.#requestedTime = performance.now();
            // this.#lastRenderTime = this.#requestedTime;
            this.requestPreload();
            this.requestRender();
        }
    }
}