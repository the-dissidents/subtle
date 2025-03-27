console.info('VideoPlayer loading');

import { SubtitleRenderer } from "./SubtitleRenderer";
import type { Subtitles } from "./core/Subtitles.svelte";
import type { WithCanvas } from "./CanvasKeeper";
import { MMedia, type AudioFrameData, type VideoFrameData } from "./API";
import { assert, Basic } from "./Basic";
import { DebugConfig } from "./config/Groups";

import decodedAudioLoaderUrl from './worker/DecodedAudioLoader?worker&url';
import type { AudioFeedbackData, AudioInputData } from "./worker/DecodedAudioLoader";
import { PublicConfigGroup } from "./config/PublicConfig.svelte";

import { unwrapFunctionStore, _ } from 'svelte-i18n';
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
    showDebug: {
        localizedName: () => $_('config.show-debug-info'),
        type: 'boolean',
        default: true
    }
});

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

    #opened?: {
        framerate: number;
        sampleRate: number;
        media: MMedia;
        audioCxt: AudioContext;

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
    get source() { return this.#sourceUrl; }

    #subRenderer?: SubtitleRenderer;

    get subRenderer() { return this.#subRenderer; }

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
        await this.#opened.media.waitUntilAvailable();
        await this.#opened.media.setVideoSize(nw, nh);
    }

    setSubtitles(subs: Subtitles) {
        if (!this.subRenderer) this.#subRenderer = 
            new SubtitleRenderer(this.#canvasWidth, this.#canvasHeight, subs);
        else this.#subRenderer?.changeSubtitles(subs);
        this.requestRender();
    }

    async close() {
        assert(this.#opened !== undefined && !this.#opened.media.isClosed);
        this.#requestedSetPositionTarget = -1;
        this.#requestedRender = false;
        this.#requestedPreload = false;
        await Basic.waitUntil(() => !this.isPreloading && !this.#setPositionInProgress);
        await this.#opened.media.waitUntilAvailable();
        await this.#opened.media.close();
        await this.#opened.audioCxt.close();
    }
    
    async load(rawurl: string) {
        if (this.#opened) await this.close();
        if (DebugConfig.data.disableVideo) return;
        
        let media = await MMedia.open(rawurl);
        await media.openVideo(-1);
        await media.openAudio(-1);
        console.info('VideoPlayer: opened media');

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

        this.#opened = {
            media, audioCxt, worklet,
            framerate: videoStatus.framerate,
            sampleRate: audioStatus.sampleRate,
            preloadEOF: false,
            playEOF: false,
            audioBufferLength: 0,
            audioSize: 0,
            videoCache: [],
            discardBeforeVideoPosition: -1,
        };

        await this.#updateOutputSize();
        this.#requestPreload();
        console.info('VideoPlayer: loaded media');
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

            assert(this.#opened !== undefined);
            this.#opened.onAudioFeedback = (data) => {
                assert(this.#opened !== undefined);
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
        if (!this.#opened) return;
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

    async #receiveFrame(frame: VideoFrameData | AudioFrameData | null) {
        if (!this.#opened) return false;
        if (this.#opened.preloadEOF) {
            console.log('preloadeof');
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
                console.warn('receiveFrame: abnormal audio frame ordering', 
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
                console.info('receiveFrame: first audio at', frame.position, frame.time);
            }
            await this.#postAudioMessage({ type: 'frame', frame });
        } else {
            if (video.length > 0 && frame.position < video.at(-1)!.position) {
                console.warn('receiveFrame: abnormal video frame ordering',
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
                console.info('receiveFrame: first video at', frame.position, frame.time);
                if (this.#opened.audioHead !== undefined && this.#opened.audioHead < frame.time) {
                    // shift audio buffer until current video position
                    await this.#postAudioMessage(
                        { type: 'shiftUntil', position: frame.time * this.#opened.sampleRate });
                }
                this.onVideoPositionChange();
                this.subRenderer?.setTime(frame.time);
            }
        }
        this.requestRender();
        return true;
    }

    #requestedPreload = false;
    #requestPreload() {
        if (this.#requestedPreload) return;
        this.#requestedPreload = true;
        // console.info('preloading');
        const load = async () => {
            if (await this.#populateCache())
                setTimeout(load, 0);
            else {
                // console.info('preloading ends');
                this.#requestedPreload = false;
            }
        }
        setTimeout(load, 0);
    }

    #requestedSetPositionTarget = -1;
    requestSetPosition(t: number) {
        if (!this.#opened) this.forceSetPosition(t);
        else this.requestSetPositionFrame(
            Math.ceil(t * this.#opened.framerate)); // ceil to avoid going before a subtitle entry
    }

    requestSetPositionFrame(position: number) {
        const first = this.#requestedSetPositionTarget < 0;
        this.#requestedSetPositionTarget = position;
        this.play(false);
        if (first) {
            (async () => {
                let pos = this.#requestedSetPositionTarget;
                assert(pos >= 0);

                // wait until target stops changing
                while (true) {
                    if (this.#requestedSetPositionTarget == pos 
                        && !this.#setPositionInProgress) break;
                    pos = this.#requestedSetPositionTarget;
                    assert(pos >= 0);
                    console.log('delaying forceSetPositionFrame');
                    await Basic.wait(10);
                }

                this.#requestedSetPositionTarget = -1;
                await this.forceSetPositionFrame(pos);
            })();
        }
    }

    async forceSetPosition(t: number) {
        if (t < 0) t = 0;
        if (t > this.duration!) t = this.duration!;
        if (this.#opened) {
            let position = Math.floor(t * this.#opened.framerate);
            await this.forceSetPositionFrame(position);
        } else {
            if (t == this.#fallbackTime) return;
            this.#fallbackTime = t;
            this.subRenderer?.setTime(t);
            this.requestRender();
        }
    }

    #setPositionInProgress = false;
    async forceSetPositionFrame(position: number) {
        if (position < 0) position = 0;

        assert(this.#opened !== undefined);
        await Basic.waitUntil(() => !this.#setPositionInProgress);
        this.#setPositionInProgress = true;
        
        this.#requestedPreload = false;
        await Basic.waitUntil(() => !this.#populatingInProgress);

        position = Math.max(0, Math.floor(position));
        this.#fallbackTime = position / this.#opened.framerate;
        this.#opened.discardBeforeVideoPosition = position;
        this.#opened.preloadEOF = false;
        this.#opened.playEOF = false;
        this.play(false);

        const video = this.#opened.videoCache;

        // check if target position is within cache
        if (video.length > 0) {
            if (position >= video[0].position && position <= video.at(-1)!.position) {
                console.info('setPositionFrame: shifting', 
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
        console.info(`setPositionFrame: seeking [${position}]`);
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
        if (!this.#opened || this.#opened.playEOF) return;
        const pos = this.currentPosition;
        if (pos === null) {
            console.warn('requestNextFrame: invalid position');
            return;
        }
        this.requestSetPositionFrame(pos + 1);
    }

    async requestPreviousFrame() {
        if (!this.#opened) return;
        const pos = this.currentPosition;
        if (pos === null) {
            console.warn('requestPreviousFrame: invalid position');
            return;
        }
        this.requestSetPositionFrame(pos - 1);
    }

    #drawFrame(frame: VideoFrameData) {
        assert(this.#opened !== undefined);
        this.subRenderer?.setTime(frame.time);

        let [nw, nh] = this.#opened.media.videoOutputSize;
        let imgData = new ImageData(frame.content, frame.stride);

        this.#ctxbuf.clearRect(0, 0, this.#canvasWidth, this.#canvasHeight);
        this.#ctxbuf.putImageData(imgData, 
            this.#outOffsetX, this.#outOffsetY, 0, 0, nw, nh);
        if (this.subRenderer)
            this.#ctxbuf.drawImage(this.subRenderer.getCanvas(), 0, 0);

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

        this.#ctxbuf.fillText(
            `fr: ${this.#opened.framerate}; sp: ${this.#opened.sampleRate}`, 0, 0);
        this.#ctxbuf.fillText(
            `at: ${audioTime}`, 0, 20);
        this.#ctxbuf.fillText(
            `vt: ${frame.time.toFixed(3)}`, 0, 40);
        this.#ctxbuf.fillText(
            `la:${latency}`, 0, 60);
        this.#ctxbuf.fillText(
            `ps: ${frame.position}`, 0, 80);
        this.#ctxbuf.fillText(
            `vb: ${this.#opened.videoCache.length}`.padEnd(10)
            + `(${(videoSize / 1024 / 1024).toFixed(2)}MB)`, 0, 100);
        this.#ctxbuf.fillText(
            `ab: ${this.#opened.audioBufferLength}`.padEnd(10) 
            + `(${(audioSize / 1024 / 1024).toFixed(2)}MB)`, 0, 120);
    }

    async #render() {
        this.#ctx.globalCompositeOperation = 'copy';

        if (!this.#opened) {
            requestAnimationFrame(() => 
                this.#ctx.drawImage(this.subRenderer!.getCanvas(), 0, 0));
            this.#requestedRender = false;
            return;
        }

        if (this.#opened.playEOF) {
            // display last frame
            console.log('playeof has been true');
            assert(this.#opened.lastFrame !== undefined);
            this.onVideoPositionChange();
            this.#drawFrame(this.#opened.lastFrame);
            requestAnimationFrame(() => 
                this.#ctx.drawImage(this.#canvas, 0, 0));
            this.#requestedRender = false;
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
                        this.#render();
                    }, Math.max(0, frame.time - position) * 1000);
                } else {
                    this.#requestedRender = false;
                }
                requestAnimationFrame(() => 
                    this.#ctx.drawImage(this.#canvas, 0, 0));
                return;
            } else {
                // discard missed frame
                console.log('render: discarding frame at', video[0].position, video[0].time, position);
                video.shift();
            }
        }
        // videoCache is empty
        if (this.#opened.preloadEOF) {
            this.#opened.playEOF = true;
            this.play(false);
        } else {
            this.#requestPreload();
        }
        this.#requestedRender = false;
    }

    requestRender() {
        if (this.#requestedRender) return;
        this.#requestedRender = true;
        requestAnimationFrame(() => {
            this.#render();
        });
    }

    async play(state = true) {
        if (!this.#opened) return;
        
        if (!state && this.#playing) {
            // console.log('playing -> false');
            this.#playing = false;
            await this.#postAudioMessage({type: 'suspend'});
            this.onPlayStateChange();
        } else if (state && !this.#playing && !this.#opened.playEOF) {
            // console.log('playing -> true');
            this.#playing = true;
            await this.#postAudioMessage({type: 'play'});
            this.onPlayStateChange();
            this.#requestPreload();
            this.requestRender();
        } else {
            // console.log('requested play ->', state, 'but done nothing');
        }
    }
}