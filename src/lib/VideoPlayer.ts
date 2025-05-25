console.info('VideoPlayer loading');

import { MMedia, type AudioFrameData, type StreamInfo, type VideoFrameData } from "./API";
import { Basic } from "./Basic";
import { CanvasManager } from "./CanvasManager";
import { SubtitleRenderer } from "./SubtitleRenderer";
import { DebugConfig } from "./config/Groups";
import type { Subtitles } from "./core/Subtitles.svelte";

import { PublicConfigGroup } from "./config/PublicConfig.svelte";
import type { AudioFeedbackData, AudioInputData } from "./worker/DecodedAudioLoader";
import decodedAudioLoaderUrl from './worker/DecodedAudioLoader?worker&url';

import { _, unwrapFunctionStore } from 'svelte-i18n';
import { Debug } from "./Debug";
const $_ = unwrapFunctionStore(_);

export const MediaConfig = new PublicConfigGroup(
    () => $_('config.media'),
    null, 1,
{
    preloadAmount: {
        localizedName: () => $_('config.preload-amount'),
        type: 'number',
        description: () => $_('config.preload-amount-d'),
        bounds: [0.1, 10],
        default: 1
    },
    maxZoom: {
      localizedName: () => $_('config.maximum-zoom'),
      type: 'number',
      description: () => $_('config.maximum-zoom-d'),
      bounds: [1, 6],
      default: 3
    },
    showDebug: {
        localizedName: () => $_('config.show-debug-info'),
        type: 'boolean',
        default: true
    }
});

function sum(a: number[]) {
    return a.reduce((p, c) => p + c, 0);
}

export type SetPositionOptions = {
    imprecise?: boolean;
};

export class VideoPlayer {
    #canvas: OffscreenCanvas;
    #ctxbuf: OffscreenCanvasRenderingContext2D;
    #playing = false;

    #opened?: {
        url: string | undefined;
        framerate: number;
        sampleRate: number;
        media: MMedia;
        audioCxt: AudioContext;

        streams: readonly StreamInfo[];
        currentAudioStream: number;

        outOffsetX: number;
        outOffsetY: number;
        outW: number;
        outH: number;

        // manages audio cache and is used as the position reference
        worklet: AudioWorkletNode;
        onAudioFeedback?: (data: AudioFeedbackData) => void;
        audioHead?: number | undefined;
        audioTail?: number | undefined;
        audioBufferLength: number;
        audioSize: number;

        preloadEOF: boolean;
        playEOF: boolean;
        videoCache: VideoFrameData[];
        lastFrame?: VideoFrameData;
        discardBeforeVideoPosition: number;
    };

    // position used when no media opened
    #fallbackTime: number = 0;

    get duration() { return this.#opened?.media.duration; }
    get videoSize() { return this.#opened?.media.videoSize; }
    get sampleAspectRatio() { return this.#opened?.media.sampleAspectRatio; }

    get currentPosition() {
        if (!this.#opened) return null;
        if (this.#opened.playEOF) return this.#opened.lastFrame?.position ?? null;
        if (this.#opened.videoCache.length == 0) return null;
        return this.#opened.videoCache[0].position;
    }
    get currentTimestamp() {
        const pos = this.currentPosition;
        if (pos !== null) return pos / this.#opened!.framerate;
        return this.#fallbackTime;
    }

    get isLoaded() { return this.#opened !== undefined; }
    get isPlaying() { return this.#playing; }
    get isPreloading() { return this.#requestedPreload; }
    get source() { return this.#opened?.url; }

    get streams() {
        return this.#opened?.streams ?? [];
    }
    get currentAudioStream() {
        return this.#opened?.currentAudioStream;
    }

    #subRenderer?: SubtitleRenderer;
    #manager: CanvasManager;

    get subRenderer() { return this.#subRenderer; }

    onVideoPositionChange = () => {};
    onPlayStateChange = () => {};

    constructor(canvas: HTMLCanvasElement) {
        this.#manager = new CanvasManager(canvas);
        this.#manager.doNotPrescaleHighDPI = true;
        // this.#manager.showScrollers = false;
        this.#manager.setMaxZoom(MediaConfig.data.maxZoom);
        this.#manager.onDisplaySizeChanged.bind(this, 
            (w, h, rw, rh) => this.#setDisplaySize(w, h, rw, rh));
        this.#manager.onUserZoom.bind(this, () => {
            this.#manager.setMaxZoom(MediaConfig.data.maxZoom);
            this.#updateContentRect();
        });
        this.#manager.renderer = (ctx) => this.#renderSimple(ctx);
        this.#manager.requestRender();

        canvas.ondblclick = () => {
            this.#manager.setScroll({x: 0, y: 0});
            this.#manager.setScale(1);
        };

        let [w, h] = this.#manager.physicalSize;
        this.#canvas = new OffscreenCanvas(w, h);
        let bufcxt = this.#canvas.getContext('2d', { alpha: true });
        if (!bufcxt) throw new Error("VideoPlayer: cannot create offscreen context");
        this.#ctxbuf = bufcxt;
    }

    #updateContentRect() {
        const [w, h] = this.#manager.size;
        const scale = this.#manager.scale;
        const wmargin = w / scale / 2;
        const hmargin = h / scale / 2;
        this.#manager.setContentRect({
            l: -wmargin, t: -hmargin, r: w + wmargin, b: h + hmargin
        });
    }

    async #setDisplaySize(w: number, h: number, rw: number, rh: number) {
        this.#canvas.width = rw;
        this.#canvas.height = rh;
        this.subRenderer?.changeResolution(rw, rh);
        if (this.#opened) await this.#updateOutputSize();
        this.#updateContentRect();
        this.requestRender();
    }

    async #updateOutputSize() {
        Debug.assert(this.#opened !== undefined);
        const [w, h] = this.#manager.physicalSize;
        const width = this.#opened.media.videoSize[0] * this.#opened.media.sampleAspectRatio;
        const height = this.#opened.media.videoSize[1];
        const ratio = width / height;

        let oh: number, ow: number;
        if (w / h < ratio)
            [ow, oh] = [w, w / ratio];
        else
            [ow, oh] = [h * ratio, h];
        this.#opened.outOffsetX = (w - ow) / 2;
        this.#opened.outOffsetY = (h - oh) / 2;
        if (ow == this.#opened.outW && oh == this.#opened.outH) return;

        [this.#opened.outW, this.#opened.outH] = [ow, oh];
        await this.#opened.media.waitUntilAvailable();
        await this.#opened.media.setVideoSize(ow, oh);
        Debug.trace('video size ->', ow, oh);

        const pos = this.currentPosition;
        await this.#clearCache();
        if (pos !== null) this.requestSetPositionFrame(pos);
    }

    setSubtitles(subs: Subtitles) {
        let [w, h] = this.#manager.physicalSize;
        if (!this.subRenderer)
            this.#subRenderer = new SubtitleRenderer(w, h, subs);
        else this.#subRenderer?.changeSubtitles(subs);
        this.requestRender();
    }

    async close() {
        if (this.#opened == undefined)
            return Debug.early('already closed');
        Debug.assert(!this.#opened.media.isClosed);
        await Debug.info('closing video');
        this.#requestedSetPositionTarget = -1;
        this.#requestedPreload = false;
        await Basic.waitUntil(() => !this.isPreloading && !this.#setPositionInProgress);
        await this.#opened.media.waitUntilAvailable();
        await this.#opened.media.close();
        await this.#opened.audioCxt.close();
        this.#opened = undefined;
        await this.forceSetPosition(0);
        this.#manager.requestRender();
        await Debug.info('closed video');
    }
    
    async load(rawurl: string, audio: number) {
        if (this.#opened) await this.close();
        if (DebugConfig.data.disableVideo) return;
        
        let media = await MMedia.open(rawurl);
        
        await media.openVideo(-1);
        await media.openAudio(audio);
        await Debug.debug('VideoPlayer: opened media');

        const audioStatus = await media.audioStatus();
        const videoStatus = await media.videoStatus();
        const status = await media.status();
        Debug.assert(audioStatus !== null);
        Debug.assert(videoStatus !== null);

        let audioCxt = new AudioContext({ sampleRate: audioStatus.sampleRate });
        await audioCxt.audioWorklet.addModule(decodedAudioLoaderUrl);
        const worklet = new AudioWorkletNode(audioCxt, "decoded-audio-loader");
        worklet.port.onmessage = (ev) => {
            if (Array.isArray(ev.data)) {
                // log
                Debug.info.apply(console, ev.data);
            } else {
                let feedback = ev.data as AudioFeedbackData;
                if (this.#opened?.onAudioFeedback)
                    this.#opened.onAudioFeedback(feedback);
            }
        }
        worklet.connect(audioCxt.destination);

        this.#opened = {
            url: rawurl,
            media, audioCxt, worklet,
            framerate: videoStatus.framerate,
            sampleRate: audioStatus.sampleRate,
            currentAudioStream: status.audioIndex,
            streams: media.streams,

            outOffsetX: 0,
            outOffsetY: 0,
            outH: 0, outW: 0,

            preloadEOF: false,
            playEOF: false,
            audioBufferLength: 0,
            audioSize: 0,
            videoCache: [],
            discardBeforeVideoPosition: -1,
        };
        this.#populatingInProgress = false;
        this.#requestedSetPositionTarget = -1;
        this.#setPositionInProgress = false;

        await this.#updateOutputSize();
        this.#requestPreload();
        await Debug.debug('VideoPlayer: loaded media');
    }

    async setAudioStream(id: number) {
        Debug.assert(this.#opened !== undefined);
        if (id == this.#opened.currentAudioStream) return Debug.early('setAudioStream');

        if (this.#playing) await this.stop();
        const pos = this.currentPosition ?? 0;
        await this.#opened.media.openAudio(id);
        const status = await this.#opened.media.status();
        this.#opened.currentAudioStream = status.audioIndex;
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
                reject(new Error('postAudioMessage timed out'));
            }, 1000);

            Debug.assert(this.#opened !== undefined);
            this.#opened.onAudioFeedback = (data) => {
                Debug.assert(this.#opened !== undefined);
                this.#playing = data.isPlaying;
                this.#opened.audioSize = data.bufferSize;
                this.#opened.audioBufferLength = data.bufferLength;
                if (data.headPosition !== undefined)
                    this.#opened.audioHead = data.headPosition / this.#opened!.sampleRate;
                if (data.tailPosition !== undefined)
                    this.#opened.audioTail = data.tailPosition / this.#opened!.sampleRate;
                this.#waitingWorklet = false;
                resolve();
            };
            this.#opened.worklet.port.postMessage(msg);
        });
    }

    async #clearCache() {
        if (!this.#opened) return Debug.early();
        this.#opened.videoCache = [];
        this.#opened.preloadEOF = false;
        this.#opened.playEOF = false;
        this.#opened.audioHead = -1;
        this.#opened.audioTail = -1;
        await this.#postAudioMessage({ type: 'clearBuffer' });
    }

    #populatingInProgress = false;
    async #populateCache() {
        if (!this.#opened || this.#opened.preloadEOF || !this.#requestedPreload) {
            this.#populatingInProgress = false;
            return false;
        }
        const preloadAmount = MediaConfig.data.preloadAmount;
        const video = this.#opened.videoCache;
        if (video.length > 1 && video.at(-1)!.time - video[0].time > preloadAmount
         && this.#opened.audioHead !== undefined
         && this.#opened.audioTail !== undefined
         && this.#opened.audioTail - this.#opened.audioHead > preloadAmount)
        {
            this.#populatingInProgress = false;
            return false;
        }

        this.#populatingInProgress = true;
        await this.#opened.media.waitUntilAvailable();
        const frame = await this.#opened.media.readNextFrame();
        const result = await this.#receiveFrame(frame);
        this.#populatingInProgress = false;
        return result;
    }

    async #tryStartPlaying() {
        Debug.assert(this.#opened !== undefined);
        if (this.#requestedStartPlay && this.#opened.videoCache.length > 0) {
            Debug.debug('starting playback');
            this.#requestedStartPlay = false;
            this.#playing = true;
            await this.#postAudioMessage({ type: 'play' });
            this.onPlayStateChange();
            this.requestRender();
            return true;
        }
        return false;
    }

    async #receiveFrame(frame: VideoFrameData | AudioFrameData | null) {
        if (!this.#opened) return false;
        if (this.#opened.preloadEOF) {
            await Debug.debug('preloadeof');
            return false;
        }
        if (!frame) {
            this.#opened.preloadEOF = true;
            if (this.#opened.videoCache.length == 0 && !this.#opened.playEOF) {
                this.#opened.playEOF = true;
                this.requestRender();
            }
            return false;
        }

        const video = this.#opened.videoCache;
        if (frame.type == 'audio') {
            if (this.#opened.audioTail !== undefined && frame.time < this.#opened.audioTail) {
                await Debug.warn('receiveFrame: abnormal audio frame ordering', 
                    frame.time, this.#opened.audioTail);
                await this.#clearCache();
                return true;
            }
            if (this.#opened.audioBufferLength == 0) {
                if (frame.time < this.#opened.discardBeforeVideoPosition / this.#opened.framerate 
                || (video.length > 0 && video[0].time > frame.time))
                {
                    // skip audio before current video position or before seek target
                    return true;
                }
                await Debug.trace('receiveFrame: first audio at', frame.position, frame.time);
            }
            await this.#postAudioMessage({ type: 'frame', frame });
            await this.#tryStartPlaying();
        } else {
            if (video.length > 0 && frame.position < video.at(-1)!.position) {
                await Debug.warn('receiveFrame: abnormal video frame ordering',
                    frame.position, video.at(-1)!.position);
                await this.#clearCache();
                return true;
            }
            this.#opened.lastFrame = frame;
            if (video.length == 0 && frame.position < this.#opened.discardBeforeVideoPosition) {
                // skip frames before seek target
                return true;
            }
            video.push(frame);
            if (video.length == 1) {
                await Debug.trace('receiveFrame: first video at', frame.position, frame.time);
                if (this.#opened.audioHead !== undefined && this.#opened.audioHead < frame.time) {
                    // shift audio buffer until current video position
                    await this.#postAudioMessage(
                        { type: 'shiftUntil', position: frame.time * this.#opened.sampleRate });
                }
                this.onVideoPositionChange();
                this.subRenderer?.setTime(frame.time);
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
        Debug.trace('preloading');
        const load = async () => {
            if (await this.#populateCache())
                setTimeout(load, 0);
            else {
                Debug.trace('preloading ends');
                this.#requestedPreload = false;
            }
        }
        setTimeout(load, 0);
    }

    #requestedSetPositionTarget = -1;
    requestSetPosition(t: number, opt?: SetPositionOptions) {
        if (!this.#opened) this.forceSetPosition(t);
        else this.requestSetPositionFrame(
            Math.ceil(t * this.#opened.framerate), opt);
        // ceil to avoid going before a subtitle entry
    }

    requestSetPositionFrame(position: number, opt?: SetPositionOptions) {
        Debug.trace('requestSetPositionFrame', position);
        const first = this.#requestedSetPositionTarget < 0;
        this.#requestedSetPositionTarget = position;
        if (first) {
            (async () => {
                let pos = this.#requestedSetPositionTarget;
                Debug.assert(pos >= 0);
                if (this.#playing) await this.stop();

                // wait until target stops changing
                while (true) {
                    if (this.#requestedSetPositionTarget == pos 
                        && !this.#setPositionInProgress) break;
                    pos = this.#requestedSetPositionTarget;
                    Debug.assert(pos >= 0);
                    Debug.trace('delaying forceSetPositionFrame;', 
                        this.#setPositionInProgress, pos);
                    await Basic.wait(10);
                }

                this.#requestedSetPositionTarget = -1;
                await this.forceSetPositionFrame(pos, opt);
            })();
        }
    }

    async forceSetPosition(t: number, opt?: SetPositionOptions) {
        if (t < 0) t = 0;
        if (t > this.duration!) t = this.duration!;
        if (this.#opened) {
            let position = Math.floor(t * this.#opened.framerate);
            await this.forceSetPositionFrame(position, opt);
        } else {
            if (t == this.#fallbackTime) return;
            this.#fallbackTime = t;
            this.subRenderer?.setTime(t);
            this.requestRender();
        }
        this.onVideoPositionChange();
    }

    #setPositionInProgress = false;
    async forceSetPositionFrame(position: number, opt?: SetPositionOptions) {
        Debug.trace('forceSetPositionFrame', position);
        if (position < 0) position = 0;

        Debug.assert(this.#opened !== undefined);
        await Basic.waitUntil(() => !this.#setPositionInProgress);
        this.#setPositionInProgress = true;
        
        this.#requestedPreload = false;
        await Basic.waitUntil(() => !this.#populatingInProgress);

        position = Math.max(0, Math.floor(position));
        this.#fallbackTime = position / this.#opened.framerate;
        this.#opened.preloadEOF = false;
        this.#opened.playEOF = false;
        this.#opened.discardBeforeVideoPosition = (opt?.imprecise) ? -1 : position;
        if (this.#playing) await this.stop();

        const video = this.#opened.videoCache;
        // check if target position is within cache
        if (video.length > 0) {
            if (position >= video[0].position && position <= video.at(-1)!.position) {
                Debug.trace('forceSetPositionFrame: shifting', 
                    position, video[0].position, video.at(-1)!.position);
                while (position > video[0].position)
                    video.shift();
                await this.#postAudioMessage({ type: 'shiftUntil', 
                    position: position / this.#opened.framerate * this.#opened.sampleRate });
                this.#subRenderer?.setTime(video[0].time);
                this.onVideoPositionChange();
                this.requestRender();
                this.#requestPreload();
                this.#setPositionInProgress = false;
                return;
            }
        }
        // else, do the seeking and rebuild cache
        await this.#opened.media.waitUntilAvailable();
        await this.#opened.media.seekVideo(position);
        Debug.trace(`setPositionFrame: seeking [${position}]`);
        await this.#clearCache();
        this.#requestPreload();
        // const frame = await this.#opened.media.seekVideoPrecise(position);
        // console.info(`setPositionFrame: seeking [${position}], got frame`, 
        //     frame?.position, frame?.time);
        // await this.#clearCache();
        // if (await this.#receiveFrame(frame))
        //     this.#requestPreload();
        this.#setPositionInProgress = false;
    }

    async requestNextFrame() {
        if (!this.#opened) return Debug.early('not opened');
        if (this.#opened.playEOF) return;
        const pos = this.currentPosition;
        if (pos === null) {
            await Debug.warn('requestNextFrame: invalid position');
            return;
        }
        this.requestSetPositionFrame(pos + 1);
    }

    async requestPreviousFrame() {
        if (!this.#opened) return Debug.early('not opened');
        const pos = this.currentPosition;
        if (pos === null) {
            await Debug.warn('requestPreviousFrame: invalid position');
            return;
        }
        this.requestSetPositionFrame(pos - 1);
    }

    #drawFrame(frame: VideoFrameData) {
        Debug.assert(this.#opened !== undefined);
        this.subRenderer?.setTime(frame.time);

        let [nw, nh] = this.#opened.media.videoOutputSize;
        let imgData = new ImageData(frame.content, frame.stride);

        let [w, h] = this.#manager.physicalSize;
        this.#ctxbuf.clearRect(0, 0, w, h);
        this.#ctxbuf.putImageData(imgData, 
            this.#opened.outOffsetX, this.#opened.outOffsetY, 0, 0, nw, nh);

        if (!MediaConfig.data.showDebug) return;
        
        const videoSize = sum(this.#opened.videoCache.map((x) => x.content.length));
        const audioSize = this.#opened.audioSize;

        let audioTime = this.#opened.audioHead !== undefined
            ? this.#opened.audioHead.toFixed(3) : 'n/a';
        let latency = this.#opened.audioHead !== undefined
            ? (frame.time - this.#opened.audioHead).toFixed(3) : 'n/a';
        if (!latency.startsWith('-')) latency = ' ' + latency;

        this.#ctxbuf.fillStyle = 'red';
        this.#ctxbuf.font = `${window.devicePixelRatio * 10}px Courier`;
        this.#ctxbuf.textBaseline = 'top';

        const x = this.#opened.outOffsetX;
        this.#ctxbuf.fillText(
            `fr: ${this.#opened.framerate}; sp: ${this.#opened.sampleRate}`, x, 0);
        this.#ctxbuf.fillText(
            `at: ${audioTime}`, x, 20);
        this.#ctxbuf.fillText(
            `vt: ${frame.time.toFixed(3)}`, x, 40);
        this.#ctxbuf.fillText(
            `la:${latency}`, x, 60);
        this.#ctxbuf.fillText(
            `ps: ${frame.position}`, x, 80);
        this.#ctxbuf.fillText(
            `vb: ${this.#opened.videoCache.length}`.padEnd(10)
            + `(${(videoSize / 1024 / 1024).toFixed(2)}MB)`, x, 100);
        this.#ctxbuf.fillText(
            `ab: ${this.#opened.audioBufferLength}`.padEnd(10) 
            + `(${(audioSize / 1024 / 1024).toFixed(2)}MB)`, x, 120);
    }

    async #renderSimple(cxt: CanvasRenderingContext2D) {
        if (this.#opened) {
            cxt.drawImage(this.#canvas, 0, 0);
        }
        this.#subRenderer!.render(cxt);
    }

    #requestedRenderNext = false;

    async #renderNext() {
        if (!this.#opened) {
            this.#manager.requestRender();
            this.#requestedRenderNext = false;
            return;
        }

        if (this.#opened.playEOF) {
            // display last frame
            await Debug.debug('playeof has been true');
            Debug.assert(this.#opened.lastFrame !== undefined);
            this.onVideoPositionChange();
            this.#drawFrame(this.#opened.lastFrame);
            this.#manager.requestRender();
            this.#requestedRenderNext = false;
            return;
        }

        const video = this.#opened.videoCache;
        // should make more sense once we implement a better scheduling
        const tolerance = 1 / this.#opened.framerate;

        const position = this.#opened.audioHead;
        while (position !== undefined) {
            if (this.#opened.preloadEOF 
                ? video.length == 0 
                : video.length <= 1) break;
            if (video[0].time > position - tolerance) {
                // consume frame
                const frame = video[0];
                this.#drawFrame(frame);

                if (this.#playing) {
                    this.onVideoPositionChange();
                    video.shift();
                    this.#requestPreload();
                    // FIXME: this means we essentially display video one frame ahead of its time
                    setTimeout(() => {
                        this.#renderNext();
                    }, Math.max(0, frame.time - position) * 1000);
                } else {
                    this.#requestedRenderNext = false;
                }
                this.#manager.requestRender();
                return;
            } else {
                // discard missed frame
                await Debug.debug('render: discarding frame at', video[0].position, video[0].time, position);
                video.shift();
            }
        }
        // videoCache is empty
        if (this.#opened.preloadEOF) {
            this.#opened.playEOF = true;
            if (this.#playing) await this.stop();
        } else {
            this.#requestPreload();
        }
        this.#requestedRenderNext = false;
    }

    requestRender() {
        if (this.#requestedRenderNext) return;
        this.#requestedRenderNext = true;
        requestAnimationFrame(() => this.#renderNext());
    }

    async stop() {
        if (!this.#opened) return Debug.early('not opened');
        if (!this.#playing) return Debug.early('already stopped');
        
        await Debug.debug('stopping playback');
        this.#playing = false;
        await this.#postAudioMessage({ type: 'suspend' });
        this.onPlayStateChange();
    }

    #requestedStartPlay = false;
    async requestStartPlay() {
        if (!this.#opened) return Debug.early('not opened');
        if (this.#playing) return Debug.early('already playing');

        if (this.#requestedStartPlay) return;
        this.#requestedStartPlay = true;
        if (!await this.#tryStartPlaying()) {
            await Debug.debug('request start play');
            this.#requestPreload();
        }
    }
}