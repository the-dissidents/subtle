console.info('VideoPlayer loading');

import { MMedia, type AudioFrameData, type AudioStatus, type VideoFrameData, type VideoStatus } from "../../API";
import { Basic } from "../../Basic";
import { CanvasManager } from "../../CanvasManager";

import type { AudioFeedbackData, AudioInputData } from "./worker/DecodedAudioLoader";
import decodedAudioLoaderUrl from './worker/DecodedAudioLoader?worker&url';
import { Debug } from "../../Debug";
import { EventHost } from "../../details/EventHost";
import { MediaConfig } from "./Config";

import { _, unwrapFunctionStore } from 'svelte-i18n';
import { InterfaceConfig } from "../../config/Groups";
import { Frontend } from "../../frontend/Frontend";
const $_ = unwrapFunctionStore(_);

export const MediaPlayerInterface = {
    onPlayback: new EventHost<[pos: number]>(),
    onPlayStateChanged: new EventHost<[]>(),
};

function sum(a: number[]) {
    return a.reduce((p, c) => p + c, 0);
}

export type SetPositionOptions = {
    imprecise?: boolean;
};

const DAMPING = 0.5;

export class MediaPlayer {
    #canvas: OffscreenCanvas;
    #ctxbuf: OffscreenCanvasRenderingContext2D;
    #playing = false;

    #outOffsetX = 0; #outOffsetY = 0;
    #outDisplayW = 0; #outDisplayH = 0;
    #requestedOutW = 0; #requestedOutH = 0;

    #worklet: AudioWorkletNode;
    #onAudioFeedback?: (data: AudioFeedbackData) => void;
    #audioHead?: number | undefined;
    #audioTail?: number | undefined;
    #audioBufferLength = 0;
    #audioSize = 0;

    #preloadEOF = false;
    #playEOF = false;
    #videoCache: VideoFrameData[] = []
    #lastFrame?: VideoFrameData;

    #seeking?: {
        target: number,
        nSkippedAudio: number,
        nSkippedVideo: number
    };

    #fetchVideoTime = 0;
    #fetchAudioTime = 0;

    // position used when no frames are loaded
    // TODO: is this necessary?
    #fallbackTime: number = 0;

    get duration() { return this.media.duration; }
    get videoSize() { return this.media.video?.size; }
    get sampleAspectRatio() { return this.media.video?.sampleAspectRatio; }

    get currentPosition() {
        if (this.#playEOF) return this.#lastFrame?.position ?? null;
        if (this.#videoCache.length == 0) return null;
        return this.#videoCache[0].position;
    }
    get currentTimestamp() {
        const pos = this.currentPosition;
        if (pos !== null) return pos / this.media.video!.framerate;
        return this.#fallbackTime;
    }

    get isPlaying() { return this.#playing; }
    get isPreloading() { return this.#requestedPreload; }

    get streams() {
        return this.media.streams;
    }

    get currentAudioStream() {
        return this.media.audio!.index;
    }

    static async create(manager: CanvasManager, rawurl: string, audio: number) {
        const media = await MMedia.open(rawurl);
        let videoStatus: VideoStatus;
        let audioStatus: AudioStatus;
        try {
            videoStatus = await media.openVideo(-1, InterfaceConfig.data.useHwaccel);
            audioStatus = await media.openAudio(audio);
            await Debug.debug('VideoPlayer: opened media');
        } catch (e) {
            media.close();
            throw e;
        }
        const audioCxt = new AudioContext({ sampleRate: audioStatus.sampleRate });
        await audioCxt.audioWorklet.addModule(decodedAudioLoaderUrl);

        return new MediaPlayer(manager, media, audioCxt, rawurl);
    }

    #createWorklet() {
        const worklet = new AudioWorkletNode(this.audioCxt, "decoded-audio-loader");
        worklet.connect(this.audioCxt.destination);
        worklet.port.onmessage = (ev) => {
            if (Array.isArray(ev.data)) {
                Debug.info.apply(console, ev.data);
            } else {
                let feedback = ev.data as AudioFeedbackData;
                if (this.#onAudioFeedback)
                    this.#onAudioFeedback(feedback);
            }
        };
        return worklet;
    }

    private constructor(
        private readonly manager: CanvasManager,
        private readonly media: MMedia,
        private audioCxt: AudioContext,
        public readonly source: string,
    ) {
        let [w, h] = manager.physicalSize;
        this.#canvas = new OffscreenCanvas(w, h);
        let bufcxt = this.#canvas.getContext('2d', { alpha: true });
        if (!bufcxt) throw new Error("VideoPlayer: cannot create offscreen context");
        this.#ctxbuf = bufcxt;

        manager.onDisplaySizeChanged.bind(this, 
            (w, h, rw, rh) => this.#setDisplaySize(w, h, rw, rh));

        this.#worklet = this.#createWorklet();

        this.#populatingInProgress = false;
        this.#requestedSetPositionTarget = -1;
        this.#setPositionInProgress = false;

        this.#updateOutputSize();
        this.#requestPreload();
    }

    async #setDisplaySize(w: number, h: number, rw: number, rh: number) {
        this.#canvas.width = rw;
        this.#canvas.height = rh;
        await this.#updateOutputSize();
        this.requestRender();
    }

    async #updateOutputSize() {
        Debug.assert(!this.media.isClosed && this.media.video !== undefined);
        const [w, h] = this.manager.physicalSize;
        const width = this.media.video.size[0] * this.media.video.sampleAspectRatio;
        const height = this.media.video.size[1];
        Debug.assert(height !== 0);
        const ratio = width / height;

        let oh: number, ow: number;
        if (w / h < ratio)
            [ow, oh] = [w, w / ratio];
        else
            [ow, oh] = [h * ratio, h];
        
        this.#outOffsetX = Math.round((w - ow) / 2);
        this.#outOffsetY = Math.round((h - oh) / 2);
        ow = Math.max(1, Math.round(ow));
        oh = Math.max(1, Math.round(oh));
        [this.#outDisplayW, this.#outDisplayH] = [ow, oh];

        if (MediaConfig.data.limitFrameSize > 0.5 
         && ow * oh * 4 > MediaConfig.data.limitFrameSize * 1024 * 1024)
        {
            oh = Math.sqrt(MediaConfig.data.limitFrameSize / 4 / ratio) * 1024;
            ow = oh * ratio;
            ow = Math.max(1, Math.round(ow));
            oh = Math.max(1, Math.round(oh));
        }
        
        const [cw, ch] = this.media.outputSize;
        if (ow == cw && oh == ch) return;
        const pos = this.currentPosition;
        await Debug.debug(`updateOutputSize: ${ow}x${oh} -> ${pos}`);
        if (pos === null) {
            await this.media.waitUntilAvailable();
            await this.media.setVideoSize(ow, oh);
        } else {
            // to rebuild the cache we must go back to its start
            // this.requestSetPositionFrame(pos);
            await this.#clearCache();
            await this.media.waitUntilAvailable();
            await this.media.setVideoSize(ow, oh);
            await this.forceSetPositionFrame(pos);
        }
    }

    async close() {
        Debug.assert(!this.media.isClosed);
        await Debug.info('closing video');
        this.#requestedSetPositionTarget = -1;
        this.#requestedPreload = false;
        await Basic.waitUntil(() => !this.isPreloading && !this.#setPositionInProgress);
        await this.media.waitUntilAvailable();
        await this.media.close();
        await this.audioCxt.close();
        this.manager.requestRender();
        await Debug.info('closed video');
    }

    async setAudioStream(id: number) {
        Debug.assert(!this.media.isClosed);
        if (id == this.media.audio!.index) return;

        if (this.#playing) await this.stop();
        const oldrate = this.media.audio!.sampleRate;
        const pos = this.currentPosition ?? 0;
        const status = await this.media.openAudio(id);
        // to change the sample rate we must create a new context
        if (status.sampleRate !== oldrate) {
            await this.audioCxt.close();
            this.audioCxt = new AudioContext({ sampleRate: status.sampleRate });
            await this.audioCxt.audioWorklet.addModule(decodedAudioLoaderUrl);
            this.#worklet = this.#createWorklet();
        }
        await this.#clearCache();
        this.requestSetPositionFrame(pos);
    }

    #waitingWorklet = false;
    async #postAudioMessage(msg: AudioInputData) {
        await Basic.waitUntil(() => !this.#waitingWorklet);

        this.#waitingWorklet = true;
        return await new Promise<void>((resolve, reject) => {
            setTimeout(() => {
                this.#waitingWorklet = false;
                reject(new Error(`postAudioMessage: timed out (${msg.type})`));
            }, 1000);

            this.#onAudioFeedback = (data) => {
                this.#playing = data.isPlaying;
                this.#audioSize = data.bufferSize;
                this.#audioBufferLength = data.bufferLength;
                if (data.headPosition !== undefined)
                    this.#audioHead = data.headPosition / this.media.audio!.sampleRate;
                if (data.tailPosition !== undefined)
                    this.#audioTail = data.tailPosition / this.media.audio!.sampleRate;
                this.#waitingWorklet = false;
                resolve();
            };
            this.#worklet.port.postMessage(msg);
        });
    }

    async #clearCache() {
        Debug.assert(!this.media.isClosed);
        this.#videoCache = [];
        this.#preloadEOF = false;
        this.#playEOF = false;
        this.#audioHead = undefined;
        this.#audioTail = undefined;
        await this.#postAudioMessage({ type: 'clearBuffer' });
    }

    #populatingInProgress = false;
    async #populateCache() {
        Debug.assert(!this.media.isClosed);
        if (this.#preloadEOF || !this.#requestedPreload) {
            this.#populatingInProgress = false;
            return false;
        }
        const preloadAmount = MediaConfig.data.preloadAmount;
        const video = this.#videoCache;
        if (video.length > 1 && video.at(-1)!.time - video[0].time > preloadAmount
         && this.#audioHead !== undefined
         && this.#audioTail !== undefined
         && this.#audioTail - this.#audioHead > preloadAmount)
        {
            this.#populatingInProgress = false;
            return false;
        }

        this.#populatingInProgress = true;
        await this.media.waitUntilAvailable();
        const start = performance.now();
        const frame = await this.media.readNextFrame();
        const result = await this.#receiveFrame(frame, performance.now() - start);
        this.#populatingInProgress = false;
        return result;
    }

    async #receiveFrame(frame: VideoFrameData | AudioFrameData | null, time: number) {
        Debug.assert(!this.media.isClosed);
        if (this.#preloadEOF) {
            Debug.assert(!frame);
            Debug.debug('preloadeof');
            return false;
        }
        if (!frame) {
            this.#preloadEOF = true;
            if (this.#videoCache.length == 0 && !this.#playEOF) {
                this.#playEOF = true;
                this.requestRender();
            }
            return false;
        }

        const video = this.#videoCache;
        if (frame.type == 'audio') {
            this.#fetchAudioTime = time * DAMPING + this.#fetchAudioTime * (1 - DAMPING);
            if (this.#audioTail !== undefined && frame.time < this.#audioTail) {
                Debug.warn('receiveFrame: abnormal audio frame ordering', 
                    frame.time, this.#audioTail);
                await this.#clearCache();
                return true;
            }
            if (this.#audioBufferLength == 0) {
                if (this.#seeking 
                 && frame.time < this.#seeking.target / this.media.video!.framerate)
                {
                    // skip audio before seek target
                    this.#seeking.nSkippedAudio++;
                    return true;
                }
                Debug.debug('receiveFrame: first audio at', frame.position, frame.time);
            }
            await this.#postAudioMessage({ type: 'frame', frame });
            await this.#tryStartPlaying();
        } else {
            this.#fetchVideoTime = time * DAMPING + this.#fetchVideoTime * (1 - DAMPING);
            if (video.length > 0 && frame.position < video.at(-1)!.position) {
                Debug.warn('receiveFrame: abnormal video frame ordering',
                    frame.position, video.at(-1)!.position);
                await this.#clearCache();
                return true;
            }
            this.#lastFrame = frame;
            if (video.length == 0 && this.#seeking 
             && frame.position < this.#seeking.target) {
                // skip frames before seek target
                this.#seeking.nSkippedVideo++;
                return true;
            }
            video.push(frame);
            if (video.length == 1) {
                Debug.debug('receiveFrame: first video at', frame.position, frame.time);
                if (this.#audioHead !== undefined && this.#audioHead < frame.time) {
                    // shift audio buffer until current video position
                    Debug.debug(`receiveFrame: shifting audio until ${frame.time} [${frame.position}]`);
                    await this.#postAudioMessage({ 
                        type: 'shiftUntil', 
                        position: frame.time * this.media.audio!.sampleRate 
                    });
                }
                if (this.#seeking) {
                    Frontend.setStatus($_('msg.seeked-to-frame', { values: {
                        time: frame.time.toFixed(3), 
                        pos: frame.position, 
                        naudio: this.#seeking.nSkippedAudio, 
                        nvideo: this.#seeking.nSkippedVideo
                    } }));
                    this.#seeking = undefined;
                }
            } else {
                // Debug.trace('receiveFrame: received video at', frame.position, frame.time);
            }
            await this.#tryStartPlaying();
        }
        this.requestRender();
        return true;
    }

    #requestedPreload = false;
    #requestPreload() {
        if (this.#requestedPreload) return;
        this.#requestedPreload = true;
        // Debug.trace('preloading');
        const load = async () => {
            if (await this.#populateCache())
                setTimeout(load, 0);
            else {
                // Debug.trace('preloading ends');
                this.#requestedPreload = false;
            }
        }
        setTimeout(load, 0);
    }

    #requestedSetPositionTarget = -1;
    
    requestSetPosition(t: number, opt?: SetPositionOptions) {
        // ceil to avoid going before a subtitle entry
        this.requestSetPositionFrame(Math.ceil(t * this.media.video!.framerate), opt);
    }

    requestSetPositionFrame(position: number, opt?: SetPositionOptions) {
        const video = this.#videoCache;
        if (video.length > 0 && video[0].position == position)
            return;
            
        Debug.trace('requestSetPositionFrame', position);
        const first = this.#requestedSetPositionTarget < 0;
        this.#requestedSetPositionTarget = position;
        if (first) {
            (async () => {
                if (this.#playing) await this.stop();
                await Basic.waitUntil(() => !this.#setPositionInProgress);
                const pos = this.#requestedSetPositionTarget;
                if (pos < 0) return;
                this.#requestedSetPositionTarget = -1;
                await this.forceSetPositionFrame(pos, opt);
            })();
        }
    }

    async forceSetPosition(t: number, opt?: SetPositionOptions) {
        if (t < 0) t = 0;
        if (t > this.duration!) t = this.duration!;
        const position = Math.floor(t * this.media.video!.framerate);
        await this.forceSetPositionFrame(position, opt);
    }

    #setPositionInProgress = false;
    async forceSetPositionFrame(position: number, opt?: SetPositionOptions) {
        Debug.assert(!this.media.isClosed);
        const video = this.#videoCache;

        await Debug.debug(`forceSetPositionFrame: ${(position * this.media.video!.framerate).toFixed(3)} [${position}]`);
        if (position < 0) position = 0;
        if (video.length > 0 && video[0].position == position) {
            return Debug.early('forceSetPositionFrame');
        }

        if (this.#setPositionInProgress) {
            await Debug.trace('forceSetPositionFrame: waiting for previous seek to finish');
            await Basic.waitUntil(() => !this.#setPositionInProgress);
        }
        this.#setPositionInProgress = true;
        this.#requestedPreload = false;
        
        try {
            if (this.#populatingInProgress) {
                await Debug.trace('forceSetPositionFrame: waiting for cache population to finish');
                await Basic.waitUntil(() => !this.#populatingInProgress);
            }

            position = Math.max(0, Math.floor(position));
            const framerate = this.media.video!.framerate;
            const samplerate = this.media.audio!.sampleRate;
            this.#fallbackTime = position / framerate;
            this.#preloadEOF = false;
            this.#playEOF = false;
            if (opt?.imprecise)
                this.#seeking = undefined;
            else
                this.#seeking = { target: position, nSkippedAudio: 0, nSkippedVideo: 0 };
            if (this.#playing) await this.stop();

            // check if target position is within cache
            if (video.length > 0 
             && position >= video[0].position && position <= video.at(-1)!.position
            ) {
                if (position == video[0].position) return;
                await Debug.trace('forceSetPositionFrame: shifting', 
                    position, video[0].position, video.at(-1)!.position);
                while (position > video[0].position)
                    video.shift();
                await this.#postAudioMessage({ type: 'shiftUntil', 
                    position: position / framerate * samplerate });

                this.requestRender();
                this.#requestPreload();
                MediaPlayerInterface.onPlayback.dispatch(video[0].time);
                Frontend.setStatus($_('msg.seeked-to-frame-cached', { values: {
                    time: video[0].time.toFixed(3), 
                    pos: video[0].position
                } }));
            } else {
                // else, do the seeking and rebuild cache
                await this.media.waitUntilAvailable();
                await this.media.seekVideo(position);
                await this.#clearCache();
                await this.media.waitUntilAvailable();
                const frame = await this.media.skipUntil(
                    position, Math.floor(position / framerate * samplerate));
                this.#receiveFrame(frame, 0);
                this.#requestPreload();
            }
        } finally {
            this.#setPositionInProgress = false;
        }
    }

    async requestNextFrame() {
        Debug.assert(!this.media.isClosed);
        if (this.#playEOF) return;
        const pos = this.currentPosition;
        if (pos === null) {
            await Debug.warn('requestNextFrame: currentPosition is null');
            return;
        }
        this.requestSetPositionFrame(pos + 1);
    }

    async requestPreviousFrame() {
        Debug.assert(!this.media.isClosed);
        const pos = this.currentPosition;
        if (pos === null) {
            await Debug.warn('requestPreviousFrame: currentPosition is null');
            return;
        }
        this.requestSetPositionFrame(pos - 1);
    }

    async #drawFrame(frame: VideoFrameData) {
        Debug.assert(!this.media.isClosed);
        Debug.assert(this.media.video !== undefined);
        const start = performance.now();
        
        const [w, h] = this.manager.physicalSize;
        this.#ctxbuf.clearRect(0, 0, w, h);

        const [ow, oh] = this.media.outputSize;
        const imgData = new ImageData(frame.content, frame.stride);
        let rescaled = false;
        if (ow !== this.#outDisplayW || oh !== this.#outDisplayH) {
            const bitmap = await createImageBitmap(imgData);
            this.#ctxbuf.drawImage(bitmap, 
                this.#outOffsetX, this.#outOffsetY, 
                this.#outDisplayW, this.#outDisplayH);
            rescaled = true;
        } else {
            this.#ctxbuf.putImageData(imgData, 
                this.#outOffsetX, this.#outOffsetY, 0, 0, ow, oh);
        }

        if (!MediaConfig.data.showDebug) return;
        
        const videoSize = sum(this.#videoCache.map((x) => x.content.length));
        const audioSize = this.#audioSize;

        let audioTime = this.#audioHead !== undefined
            ? this.#audioHead.toFixed(3) : 'n/a';
        let latency = this.#audioHead !== undefined
            ? (frame.time - this.#audioHead).toFixed(3) : 'n/a';
        if (!latency.startsWith('-')) latency = ' ' + latency;

        this.#ctxbuf.fillStyle = 'red';
        this.#ctxbuf.font = `${window.devicePixelRatio * 10}px Courier`;
        this.#ctxbuf.textBaseline = 'top';

        const x = this.#outOffsetX;
        this.#ctxbuf.fillText(
            `FPS ${this.media.video!.framerate} SPR ${this.media.audio!.sampleRate}`, x, 0);
        this.#ctxbuf.fillText(
            `ATi ${audioTime.padEnd(9)}[${frame.position}]`, x, 20);
        this.#ctxbuf.fillText(
            `VTi ${frame.time.toFixed(3)}`, x, 40);
        this.#ctxbuf.fillText(
            `LAT${latency}`, x, 60);
        this.#ctxbuf.fillText(
            `DRW ${(performance.now() - start).toFixed(1)}`, x, 80);
        this.#ctxbuf.fillText(
            `FVT ${this.#fetchVideoTime.toFixed(2)}`.padEnd(10) + `FAT ${this.#fetchAudioTime.toFixed(2)}`, x, 100);
        this.#ctxbuf.fillText(
            `VBL ${this.#videoCache.length}`.padEnd(9)
            + `(${(videoSize / 1024 / 1024).toFixed(2)}MB)`, x, 120);
        this.#ctxbuf.fillText(
            `ABL ${this.#audioBufferLength}`.padEnd(9) 
            + `(${(audioSize / 1024).toFixed(0)}KB)`, x, 140);
        if (rescaled)
            this.#ctxbuf.fillText(`RES ${ow}x${oh} -> ${this.#outDisplayW}x${this.#outDisplayH}`, x, 160);
        else
            this.#ctxbuf.fillText(`RES ${ow}x${oh}`, x, 160);
    }

    render(ctx: CanvasRenderingContext2D) {
        ctx.drawImage(this.#canvas, 0, 0);
    }

    #requestedRenderNext = false;

    async #renderNext() {
        const video = this.#videoCache;
        // should make more sense once we implement a better scheduling
        const tolerance = 2 / this.media.video!.framerate;
        const position = this.#audioHead;

        if (position !== undefined 
         && video.length > 0 && video[0].time < position - tolerance) 
        {
            await Debug.debug(`render: discarding video: ${video[0].time.toFixed(3)} [${video[0].position}] ~ ${position}`);
            while (video.length > 0 && video[0].time < position - tolerance)
                video.shift();
        }

        if (this.#preloadEOF ? video.length == 0 : video.length <= 1) {
            // videoCache is empty
            if (this.#preloadEOF) {
                this.#playEOF = true;
                if (this.#playing) await this.stop();
            } else if (!this.#requestedPreload) {
                await Debug.debug('render: video cache empty, reloading');
                this.#requestPreload();
            }
            this.#requestedRenderNext = false;
            return;
        }

        // display last frame if not playing
        if (!this.#playing) {
            if (this.#playEOF) {
                await Debug.debug('render: playeof has been true');
                Debug.assert(this.#lastFrame !== undefined);
            }
            const frame = video.length > 0 ? video[0] : this.#lastFrame;
            if (!frame) return;
            MediaPlayerInterface.onPlayback.dispatch(frame.time);
            await this.#drawFrame(frame);
            this.manager.requestRender();
            this.#requestedRenderNext = false;
            return;
        }

        // consume frame if playing
        if (position === undefined) {
            await Debug.debug('render: position is undefined!');
            return;
        }
        const frame = video[0];
        await this.#drawFrame(frame);

        MediaPlayerInterface.onPlayback.dispatch(frame.time);
        video.shift();
        this.#requestPreload();
        // FIXME: this means we essentially display video one frame ahead of its time
        setTimeout(() => {
            this.#renderNext();
        }, Math.max(0, frame.time - position) * 1000);
        this.manager.requestRender();
    }

    requestRender() {
        if (this.#requestedRenderNext) return;
        this.#requestedRenderNext = true;
        requestAnimationFrame(() => this.#renderNext());
    }

    async #tryStartPlaying() {
        Debug.assert(!this.media.isClosed);
        if (this.#requestedStartPlay && this.#videoCache.length > 0) {
            Debug.debug('starting playback');
            this.#requestedStartPlay = false;
            this.#playing = true;
            MediaPlayerInterface.onPlayStateChanged.dispatch();
            await this.#postAudioMessage({ type: 'play' });
            this.requestRender();
            return true;
        }
        return false;
    }

    async stop() {
        Debug.assert(!this.media.isClosed);
        if (!this.#playing) return Debug.early('already stopped');
        
        await Debug.debug('stopping playback');
        this.#playing = false;
        MediaPlayerInterface.onPlayStateChanged.dispatch();
        await this.#postAudioMessage({ type: 'suspend' });
    }

    #requestedStartPlay = false;
    async requestStartPlay() {
        Debug.assert(!this.media.isClosed);
        if (this.#playing) return Debug.early('already playing');

        if (this.#requestedStartPlay) return;
        this.#requestedStartPlay = true;
        if (!await this.#tryStartPlaying()) {
            await Debug.debug('request start play');
            this.#requestPreload();
        }
    }
}