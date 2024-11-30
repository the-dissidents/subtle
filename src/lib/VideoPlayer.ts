import { SubtitleRenderer } from "./SubtitleRenderer";
import type { Subtitles } from "./Subtitles";
import type { WithCanvas } from "./CanvasKeeper";
import { MMedia, type VideoFrameData } from "./API";
import { assert } from "./Basic";

import decodedAudioLoaderUrl from './worker/DecodedAudioLoader?worker&url';
import type { AudioFeedbackData } from "./worker/DecodedAudioLoader";

const LATENCY_DAMPING = 10;

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

    #requestedTime = 0;
    #lastRenderTime = 0;
    #retrieveTime = 0;
    #frameTime = 0;
    #latency = 0;
    #waitTimeCorrection = 0;
    #waitTime = 0;
    #audioFullness = 0;

    #opened?: {
        framerate: number;
        sampleRate: number;
        pos: number;
        audioPos: number;
        video: MMedia;
        audio: MMedia;
        audioCxt: AudioContext;
        worklet: AudioWorkletNode;
        onAudioFeedback?: (data: AudioFeedbackData) => void;
    };

    // position used when no media opened
    #fallbackPosition: number = 0;

    get duration() { return this.#opened?.video.duration; }
    get framerate() { return this.#opened?.framerate; }
    get currentPosition() {
        if (!this.#opened) return this.#fallbackPosition;
        return this.#opened.pos / this.#opened.framerate;
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
        let [width, height] = this.#opened.video.videoSize!;
        let ratio = width / height;
        let nw: number, nh: number;
        if (w / h < ratio)
            [nw, nh] = [w, w / ratio];
        else
            [nw, nh] = [h * ratio, h];
        this.#outOffsetX = (w - nw) / 2;
        this.#outOffsetY = (h - nh) / 2;
        await this.#opened.video.setVideoSize(nw, nh);
    }

    setSubtitles(subs: Subtitles) {
        if (!this.subRenderer) this.#subRenderer = 
            new SubtitleRenderer(this.#canvasWidth, this.#canvasHeight, subs);
        else this.#subRenderer?.changeSubtitles(subs);
        this.requestRender();
    }

    _testGetMedia() {
        return this.#opened?.video;
    }
    
    async load(rawurl: string) {
        console.log('VideoPlayer: url=', rawurl);

        if (this.#opened && !this.#opened.video.isClosed) {
            await this.#opened.video.close();
            await this.#opened.audio.close();
            await this.#opened.audioCxt.close();
        }
        let media = await MMedia.open(rawurl);
        await media.openVideo(-1);
        console.log('VideoPlayer: opened video');

        let audio = await MMedia.open(rawurl);
        await audio.openAudio(-1);
        console.log('VideoPlayer: opened audio');

        const audioStatus = await audio.audioStatus();
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
                if (feedback.averageFullness >= 0)
                    this.#audioFullness = feedback.averageFullness;
                if (this.#opened?.onAudioFeedback)
                    this.#opened.onAudioFeedback(feedback);
            }
        }
        worklet.connect(audioCxt.destination);
        audioCxt.suspend();

        this.#opened = {
            video: media, audio, audioCxt, worklet,
            framerate: videoStatus.framerate,
            sampleRate: audioStatus.sampleRate,
            pos: 0, audioPos: 0
        };

        await this.#updateOutputSize();
        this.requestRender();
        console.log('VideoPlayer: loaded media');
    }

    async fillAudioBuffer() {
        assert(this.#opened !== undefined);
        while (await this.#sendNextAudioFrame()) {};
    }

    async #sendNextAudioFrame() {
        assert(this.#opened !== undefined);
        await this.#opened.audio.moveToNextAudioFrame();
        return await new Promise<boolean>((resolve) => {
            assert(this.#opened !== undefined);
            this.#opened.onAudioFeedback = (data) => {
                if (data.type == 'received') {
                    this.#opened!.audioPos = data.headPosition!;
                    resolve(data.bufferLength < data.bufferCapacity);
                }
            };
            this.#opened.audio.readCurrentAudioFrame().then((data) => {
                this.#opened!.worklet.port.postMessage(data)
            });
        });
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
        if (position == this.#opened.pos) return;
        await this.#opened.video.seekVideo(position);
        await this.#opened.audio.seekAudio(Math.floor(
            position / this.#opened.framerate * this.#opened.sampleRate!));
        this.#opened.pos = await this.#opened.video.videoPosition();
        this.#opened.audioPos = await this.#opened.audio.audioPosition();
        this.onVideoPositionChange();
    }

    async nextFrame() {
        if (!this.#opened) return;
        await this.#opened.video.moveToNextVideoFrame();
        await this.#opened.video.readCurrentVideoFrame();
    }

    async previousFrame() {
        if (!this.#opened) return;
        await this.setPositionFrame(this.#opened.pos - 1);
        await this.#opened.video.readCurrentVideoFrame();
    }

    calculateWaitTime(t0: number) {
        assert(this.#opened !== undefined);
        const K = Math.exp(-LATENCY_DAMPING * (t0 - this.#lastRenderTime) / 1000);
        this.#retrieveTime = 
            this.#retrieveTime * K + (t0 - this.#requestedTime) * (1-K);
        this.#frameTime = 
            this.#frameTime * K + (t0 - this.#lastRenderTime) * (1-K);
        this.#lastRenderTime = t0;

        /**
         * assume: 
         *  vpos0 + 1 / framerate = vpos1
         *  apos0 + frame_time = apos1
         *  retreive + wait + O(1) = frame_time
         * goal: vpos1 = apos1
         * solution:
         *  O(1) = frame_time - retreive - wait
         *  wait = vpos0 - apos0 + 1 / framerate - retreive - O(1)
         */
        let targetTime = 1000 / this.#opened.framerate!;
        this.#waitTimeCorrection += targetTime - this.#frameTime;
        this.#waitTimeCorrection = Math.min(10, Math.max(-20, this.#waitTimeCorrection));
        this.#latency = 
            (this.#opened.pos / this.#opened.framerate 
                - this.#opened.audioPos / this.#opened.sampleRate) * 1000;
        this.#waitTime = this.#waitTime * K +
            (1-K) * Math.min(50, Math.max(0, this.#latency 
                + targetTime - this.#retrieveTime + this.#waitTimeCorrection));

        // return;
        // for debug
        this.#ctxbuf.fillStyle = 'yellow';
        this.#ctxbuf.font='20px monospace';
        this.#ctxbuf.fillText(`fps=${(1000 / this.#frameTime).toFixed(1)} [${this.framerate!.toFixed(1)}]`, 0, 20);
        this.#ctxbuf.fillText(
            `fra=${this.#frameTime.toFixed(1)}`.padEnd(10) + 
            `ret=${this.#retrieveTime.toFixed(1)}`, 0, 40);
        this.#ctxbuf.fillText(
            `wai=${this.#waitTime.toFixed(1)}`.padEnd(10) + 
            `cor=${this.#waitTimeCorrection.toFixed(1)}`, 0, 60);
        this.#ctxbuf.fillText(`audio buffer: ${this.#audioFullness.toFixed(1)}%`, 0, 110);
        this.#ctxbuf.fillText(`latency:      ${Math.floor(this.#latency)}ms`, 0, 130);
    }

    async #render() {
        this.#requestedRender = false;
        this.#ctx.globalCompositeOperation = 'copy';

        if (this.#opened) {
            if (this.isPlaying) {
                this.#requestedTime = performance.now();
                await this.fillAudioBuffer();
                await this.#opened.video.moveToNextVideoFrame();
            }
            let data = await this.#opened.video.readCurrentVideoFrame();
            this.#opened.pos = data.position;
            this.onVideoPositionChange();
            this.subRenderer?.setTime(data.time);

            let [nw, nh] = this.#opened.video.videoOutputSize;
            let imgData = new ImageData(data.content, data.stride);

            this.#ctxbuf.clearRect(0, 0, this.#canvasWidth, this.#canvasHeight);
            this.#ctxbuf.putImageData(imgData, 
                this.#outOffsetX, this.#outOffsetY, 0, 0, nw, nh);
            if (this.subRenderer)
                this.#ctxbuf.drawImage(this.subRenderer.getCanvas(), 0, 0);
            if (this.#playing) {
                this.calculateWaitTime(performance.now());
                setTimeout(() => this.#render(), Math.max(0, this.#waitTime));
            }
            requestAnimationFrame(() => 
                this.#ctx.drawImage(this.#canvas, 0, 0));
        } else if (this.subRenderer) {
            requestAnimationFrame(() => 
                this.#ctx.drawImage(this.subRenderer!.getCanvas(), 0, 0));
        }
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
            this.#requestedTime = performance.now();
            this.requestRender();
        }
    }
}