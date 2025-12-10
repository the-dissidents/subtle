import { MMedia, type AudioFrameData, type AudioStatus, type DecodeResult, type VideoFrameData, type VideoStatus } from "../../API";
import { Basic } from "../../Basic";
import type { CanvasManager } from "../../CanvasManager";
import { InterfaceConfig } from "../../config/Groups";
import { Debug } from "../../Debug";
import { EventHost } from "../../details/EventHost";
import { Mutex } from "../../details/Mutex";
import { RestartableTask } from "../../details/RestartableTask";
import { Playback } from "../../frontend/Playback";
import { Audio } from "./Audio";
import { MediaConfig } from "./Config";

const DAMPING = 0.5;
const FETCH_TIME_N = 30;

export type SetPositionOptions = {
    imprecise?: boolean;
    force?: boolean;
};

export const MediaPlayerInterface = {
    onPlayback: new EventHost<[pos: number]>(),
    onPlayStateChanged: new EventHost<[]>(),
};

export class MediaPlayer {
    #closed = false;
    #playing = false;
    #mutex = new Mutex(1000, 'MediaPlayer');

    /**
     * Current timestamp. This value serves to preserve the progress when the buffers are emptied due to seeking operations. If the buffers are not empty, it must be equal to `videoBuffer[0].time`.
     */
    #timestamp = 0;

    // TODO: what's this?
    #internalTimestamp?: number;

    #videoBuffer: VideoFrameData[] = [];
    #lastFrame?: VideoFrameData;
    #preloadEOF = false;
    #playEOF = false;

    #seeking?: {
        target: number;
        skippedVideo: number;
        skippedAudio: number;
    };

    #bufCanvas: OffscreenCanvas;
    #bufCtx: OffscreenCanvasRenderingContext2D;
    #displayOffset: [number, number] = [0, 0];
    #displaySize: [number, number] = [1, 1];

    #diag = {
        latencySquared: 0,
        fetchTimes: [] as number[]
    }

    get source() { return this.rawurl; }
    get isPlaying() { return this.#playing; }
    get duration() { return this.media.duration; }
    get streams() { return this.media.streams; }
    get currentAudioStream() { return this.media.audio!.index; }
    get frameRate() { return this.media.video!.framerate; }
    get isVfr() { return this.media.video!.isVfr; }
    get videoSize() { return this.media.video?.size; }
    get sampleAspectRatio() { return this.media.video?.sampleAspectRatio; }

    get startTime() {
        return Math.min(
            this.media.video!.startTime, 
            this.media.audio?.startTime ?? Infinity);
    }

    get endTime() {
        return this.media.video!.startTime + this.media.duration;
    }

    private constructor(
        private readonly media: MMedia, 
        private readonly manager: CanvasManager, 
        private rawurl: string,
        private audio: Audio
    ) {
        const [w, h] = manager.physicalSize;
        this.#bufCanvas = new OffscreenCanvas(w, h);
        const ctx = this.#bufCanvas.getContext('2d', { alpha: true });
        if (!ctx) throw new Error("VideoPlayer: cannot create offscreen context");
        this.#bufCtx = ctx;

        manager.onDisplaySizeChanged.bind(this, (_, __, w, h) => {
            this.#bufCanvas.width = w;
            this.#bufCanvas.height = h;
            this.#updateOutputSize();
        });
        
        this.#updateOutputSize();
        this.#populateBuffer();
    }

    #updateOutputSize() {
        Debug.assert(!this.#closed);
        Debug.assert(this.media.video !== undefined);

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
        this.#displayOffset = 
            [Math.round((w - ow) / 2), Math.round((h - oh) / 2)];

        ow = Math.max(1, Math.round(ow));
        oh = Math.max(1, Math.round(oh));
        this.#displaySize = [ow, oh];

        if (MediaConfig.data.limitFrameSize > 0.5 
         && ow * oh * 4 > MediaConfig.data.limitFrameSize * 1024 * 1024)
        {
            oh = Math.sqrt(MediaConfig.data.limitFrameSize / 4 / ratio) * 1024;
            ow = oh * ratio;
            ow = Math.max(1, Math.round(ow));
            oh = Math.max(1, Math.round(oh));
        }
        this.#resizeTask.request(ow, oh);
    }

    static async create(manager: CanvasManager, rawurl: string, audioId: number) {
        const media = await MMedia.open(rawurl);
        let _videoStatus: VideoStatus;
        let audioStatus: AudioStatus;
        try {
            _videoStatus = await media.openVideo(-1, InterfaceConfig.data.useHwaccel);
            audioStatus = await media.openAudio(audioId);
            await Debug.debug('VideoPlayer: opened media');
        } catch (e) {
            media.close();
            Debug.error(e);
            throw e;
        }
        const audio = await Audio.create(audioStatus.sampleRate);
        const player = new MediaPlayer(media, manager, rawurl, audio);
        return player;
    }

    async close() {
        EventHost.unbind(this);
        
        await this.#mutex.use(async () => {
            if (this.#closed) return;
            this.#closed = true;
            await Debug.info('closing media player');
            await this.audio.close();
            await this.media.close();
        });
    }

    get volume() {
        return this.audio.volume;
    }

    async setVolume(value: number) {
        await this.#mutex.use(() => this.audio.setVolume(value));
    }

    // Must be called while locked
    async #clearCache() {
        Debug.assert(!this.#closed);
        this.#preloadEOF = false;
        this.#playEOF = false;
        this.#videoBuffer = [];
        await this.audio.clearBuffer();
    }

    #seekDone() {
        const frame = this.#videoBuffer[0];
        this.#seeking = undefined;
        Debug.debug(`seekDone: seeked to [${frame.time.toFixed(3)}]`);
    }

    // Must be called while locked
    async #receiveAudioFrame(frame: AudioFrameData) {
        if (this.audio.tail !== undefined && this.audio.tail > frame.time) {
            await Debug.warn(`receiveFrame: abnormal audio frame ordering: ${frame.time} < ${this.audio.tail}`);
            await this.#clearCache();
            return;
        }
        if (this.#seeking !== undefined) {
            if (frame.time < this.#seeking.target) {
                await Debug.trace(`skipped audio frame at ${frame.time}`);
                this.#seeking.skippedAudio++;
                return;
            } else if (this.#videoBuffer.length > 0)
                this.#seekDone();
        }
        if (this.audio.bufferLength == 0)
            await Debug.trace('receiveFrame: first audio at', frame.time, frame.content.length, frame.pktpos);
        await this.audio.pushFrame(frame);
    }

    // Must be called while locked
    async #receiveVideoFrame(frame: VideoFrameData) {
        if (this.#videoBuffer.length > 0 && this.#videoBuffer.at(-1)!.time > frame.time) {
            await Debug.warn(`receiveFrame: abnormal video frame ordering: ${frame.time} < ${this.#videoBuffer.at(-1)!.time}`);
            await this.#clearCache();
            return;
        }
        if (this.#seeking !== undefined && frame.time < this.#seeking.target) {
            await Debug.trace(`skipped video frame at ${frame.time}`);
            this.#seeking.skippedVideo++;
            return;
        }
        this.#videoBuffer.push(frame);
        this.#lastFrame = frame;
        this.#internalTimestamp = frame.time;
        if (this.#seeking !== undefined && this.audio.bufferLength > 0)
            this.#seekDone();
        if (this.#videoBuffer.length == 1) {
            this.#timestamp = frame.time;
            MediaPlayerInterface.onPlayback.dispatch(frame.time);
            await Debug.trace('receiveFrame: first video at', frame.time);
            if (!this.#presenting) this.#present();
        }
    }

    // Must be called while locked
    async #receiveFrames(result: DecodeResult) {
        if (result.audio.length == 0 && result.video.length == 0) {
            this.#preloadEOF = true;
            return false;
        }
        Debug.assert(!this.#preloadEOF);
        for (const frame of result.audio)
            await this.#receiveAudioFrame(frame);
        for (const frame of result.video)
            await this.#receiveVideoFrame(frame);
        return true;
    }

    async #doDecode() {
        if (this.#preloadEOF || this.#closed)
            return false;

        const preloadAmount = MediaConfig.data.preloadAmount;
        if (this.audio.tail !== undefined
         && this.audio.tail! - this.audio.head! > preloadAmount
         && this.#videoBuffer.length > 1
         && this.#videoBuffer.at(-1)!.time - this.#videoBuffer[0].time > preloadAmount)
        {
            // enough frames preloaded
            // update the debug info about buffer lengths
            if (!this.#presenting) this.#present();
            return false;
        }

        return await this.#mutex.use(async () => {
            const start = performance.now();
            const targetTime = MediaConfig.data.preloadWorkTime;
            const frames = await this.media.decodeAutomatic(targetTime);
            const time = performance.now() - start;
            this.#diag.fetchTimes.push(time);
            if (this.#diag.fetchTimes.length > FETCH_TIME_N)
                this.#diag.fetchTimes.shift();
            return await this.#receiveFrames(frames);
        }) ?? true;
    }

    #populateBufferRunning = false;
    async #populateBuffer() {
        Debug.assert(!this.#populateBufferRunning);
        this.#populateBufferRunning = true;
        while (await this.#doDecode())
            await Basic.wait(0);
        this.#populateBufferRunning = false;
    }

    async #drawFrame(frame: VideoFrameData) {
        const ctx = this.#bufCtx;
        const start = performance.now();
        
        const [w, h] = this.manager.physicalSize;
        const [ow, oh] = frame.size;
        const [dw, dh] = this.#displaySize;
        const [dx, dy] = this.#displayOffset;

        ctx.clearRect(0, 0, w, h);
        const imgData = new ImageData(frame.content, frame.stride);
        let rescaled = false;
        if (ow !== dw || oh !== dh) {
            const bitmap = await createImageBitmap(imgData);
            ctx.drawImage(bitmap, dx, dy, dw, dh);
            bitmap.close();
            rescaled = true;
        } else {
            ctx.putImageData(imgData, dx, dy, 0, 0, ow, oh);
        }

        if (!MediaConfig.data.showDebug) return;
        const videoSize = this.#videoBuffer
            .map((x) => x.content.length)
            .reduce((a, b) => a + b, 0);
        const audioSize = this.audio.bufferSize;

        let audioTime: string, latencyStr: string;
        if (this.audio.head !== undefined) {
            const latency = (frame.time - this.audio.head) * 1000;
            this.#diag.latencySquared = this.#diag.latencySquared * DAMPING 
                + (latency * latency * (1 - DAMPING));

            audioTime = this.audio.head.toFixed(3);
            latencyStr = latency.toFixed(1);
        } else {
            audioTime = 'n/a!';
            latencyStr = 'n/a!';
        }
        
        ctx.fillStyle = 'green';
        ctx.font = `${window.devicePixelRatio * 10}px Courier`;
        ctx.textBaseline = 'top';
        ctx.textAlign = 'left'

        const x = dx;
        ctx.fillText(
            `FPS ${this.frameRate.toFixed(3)} SPR ${this.media.audio!.sampleRate}`, x, 0);
        ctx.fillText(
            `ATi ${audioTime} s`, x, 20);
        ctx.fillText(
            `VTi ${frame.time.toFixed(3)} s`, x, 40);
        ctx.fillText(
            `LAT${latencyStr.padStart(5)}`.padEnd(10)
          + `STS ${Math.sqrt(this.#diag.latencySquared).toFixed(1).padStart(4)}`, x, 60);
        ctx.fillText(
            `DRW ${(performance.now() - start).toFixed(1)}`, x, 80);
        ctx.fillText(
            `VBL ${this.#videoBuffer.length}`.padEnd(9)
            + `(${(videoSize / 1024 / 1024).toFixed(2)}MB)`, x, 100);
        ctx.fillText(
            `ABL ${this.audio.bufferLength}`.padEnd(9) 
            + `(${(audioSize / 1024).toFixed(0)}KB)`, x, 120);
        if (rescaled)
            ctx.fillText(`RES ${ow}x${oh} -> ${dw}x${dh}`, x, 140);
        else
            ctx.fillText(`RES ${ow}x${oh}`, x, 140);

        const lo = Math.floor(MediaConfig.data.preloadWorkTime);
        const hi = lo + 25;
        const bins: number[] = [];
        let _small = 0, big = 0;
        this.#diag.fetchTimes.forEach((x) => {
            const i = Math.floor(x);
            if (i < lo) _small++;
            else if (i > hi) big++;
            else bins[i] = (bins[i] ?? 0) + 1;
        });
        const max = Math.max(...bins.filter(isFinite), big);

        const W = 200, H = 100, 
              X = w - W,
              Y = h - 20;

        for (let i = lo; i <= hi; i++) {
            const value = H * (bins[i] ?? 0) / max;
            const x = X + W / (hi - lo + 1) * (i - lo);
            ctx.fillRect(x - 1, Y - value, 2, value);
            ctx.fillRect(x - 2, Y - 2, 4, 4);
        }
        const value = H * big / max;
        ctx.fillRect(X + W - 2, Y - value, 2, value);

        ctx.textAlign = 'right';
        ctx.fillText(max.toFixed(0), X, Y - H);
        ctx.fillText(lo.toFixed(0), X, Y);
        ctx.fillText(hi.toFixed(0), w, Y);
    }

    async #presentNext() {
        if (this.#closed) return -1;

        // if not playing, just display the current frame
        if (!this.#playing) {
            let frame = this.#videoBuffer.at(0);
            if (this.#playEOF) {
                Debug.assert(this.#lastFrame !== undefined);
                frame = this.#lastFrame;
            }
            // if no frames in buffer, wait for it to get populated
            if (!frame) return 0;
            
            if (frame.time !== this.#timestamp) {
                await Debug.warn(`presentNext: ts=${this.#timestamp} but fts=${frame.time}`);
            }
            await this.#drawFrame(frame);
            this.manager.requestRender();
            return -1;
        }

        // if there's no video
        if (this.#videoBuffer.length == 0) {
            // either it's EOF
            if (this.#preloadEOF) {
                this.#playEOF = true;
                await this.stop();
                return 0; // render one more time
            }
            // or the buffer is empty
            if (!this.#populateBufferRunning)
                this.#populateBuffer();
            return 0;
        }
    
        // if there's no audio, we can't synchronize and must wait for it
        if (this.audio.head === undefined)
            return 0;

        // currently we never discard any video frames even when decoding is slow
        const frame = this.#videoBuffer.shift()!;
        this.#timestamp = frame.time;
        MediaPlayerInterface.onPlayback.dispatch(frame.time);
        await this.#drawFrame(frame);
        this.manager.requestRender();

        // ensure the buffer is refilling since we're consuming frames
        if (!this.#populateBufferRunning)
            this.#populateBuffer();

        // get next frame's time as target or fall back to this frame
        const targetTime = (this.#videoBuffer.at(0) ?? frame).time;
        const clock = this.audio.head;
        return Math.max(0, Math.min(targetTime - clock, 2 / this.media.video!.framerate));
    }

    #presenting = false;
    async #present() {
        Debug.assert(!this.#presenting);
        this.#presenting = true;
        while (true) {
            const delay = await this.#presentNext();
            if (delay < 0) break;
            await Basic.wait(delay * 1000);
        }
        this.#presenting = false;
    }

    renderTo(ctx: CanvasRenderingContext2D) {
        ctx.drawImage(this.#bufCanvas, 0, 0);
    }

    async play() {
        await this.#mutex.use(async () => {
            if (this.isPlaying || this.#closed) return;
            this.#playing = true;
            await Debug.debug('starting playback');
            await this.audio.play();
        });
        if (!this.#presenting) this.#present();
        MediaPlayerInterface.onPlayStateChanged.dispatch();
    }

    async stop() {
        await this.#mutex.use(async () => {
            if (!this.isPlaying || this.#closed) return;
            this.#playing = false;
            await Debug.debug('stopping playback');
            await this.audio.stop();
        });
        MediaPlayerInterface.onPlayStateChanged.dispatch();
    }

    async requestNextFrame() {
        Debug.assert(!this.#closed);
        if (this.#playEOF) return;
        this.#seekTask.request(this.#timestamp + 0.001);
    }

    async requestPreviousFrame() {
        Debug.assert(!this.#closed);
        if (this.#timestamp == 0) return;
        const result = await Playback.sampler?.getFrameBefore(this.#timestamp);
        if (!result) {
            Debug.warn('cannot find previous frame');
            return;
        }
        this.#seekTask.request(result.time);
    }

    async seek(t: number, opt?: SetPositionOptions) {
        if (t < this.startTime) t = this.startTime;
        if (t > this.endTime) t = this.endTime;
        return await this.#seekTask.request(t, opt);
    }

    #seekTask = 
    new RestartableTask<[target: number, opt?: SetPositionOptions]>(
        async ([target, opt], tok) => await this.#mutex.use(async () => {
            if (this.#closed
             || (!opt?.force && (this.#seeking?.target === target || this.#timestamp == target)))
            {
                await Debug.debug(`seek: aborted`);
                return;
            }
            if (tok.isCancelled) return;

            if (this.#videoBuffer.length > 2
             && target >= this.#videoBuffer[0].time
             && target <= this.#videoBuffer.at(-1)!.time)
            {
                // inside cache
                while (this.#videoBuffer[0].time < target)
                    this.#videoBuffer.shift();
                await this.audio.shiftUntil(target);
                const frame = this.#videoBuffer[0];
                this.#internalTimestamp = frame.time;
                this.#timestamp = frame.time;
                MediaPlayerInterface.onPlayback.dispatch(frame.time);
                await Debug.debug(`seek: [${frame.time.toFixed(3)}] inside cache`);
            } else {
                await this.#clearCache();
                if (tok.isCancelled) return;

                const realTarget = Math.max(target, this.startTime);
                const lastKeyframe = await Playback.sampler?.getKeyframeBefore(realTarget);
                if (this.#internalTimestamp === undefined
                 || target <= this.#internalTimestamp
                 || !lastKeyframe
                 || lastKeyframe.time > this.#internalTimestamp)
                {
                    // must seek
                    if (!(opt?.imprecise))
                        this.#seeking = {target, skippedAudio: 0, skippedVideo: 0};
                    this.#internalTimestamp = undefined;

                    await this.media.seekVideo(realTarget);
                    await Debug.debug(`seek: [${target.toFixed(3)}] by time`);
                    if (lastKeyframe)
                        await Debug.debug(`seek: info: last keyframe is`, lastKeyframe);

                    // if (!lastKeyframe || lastKeyframe.bytePos < 0) {
                    // } else {
                    //     await this.media.seekByte(lastKeyframe.bytePos);
                    //     await Debug.debug(`seek: [${target.toFixed(3)}] by file position`);
                    // }
                } else {
                    // no need to seek
                    this.#seeking = {target, skippedAudio: 0, skippedVideo: 0};
                    await Debug.debug(`seek: [${target.toFixed(3)}] not seeked`);
                }

                if (!(opt?.imprecise)) {
                    const frames = await this.media.skipUntil(target);
                    await this.#receiveFrames(frames);
                }
            }
            if (!this.#populateBufferRunning) this.#populateBuffer();
            if (!this.#presenting) this.#present();
        }),
        { deduplicator: ([a, b], [c, d]) => a === c && b === d }
    )

    #resizeTask = 
    new RestartableTask<[ow: number, oh: number]>(
        async ([ow, oh], _tok) => {
            if (this.#closed) return;
            const [cw, ch] = this.media.outputSize;
            if (ow === cw && oh === ch) {
                if (!this.#presenting) this.#present();
                return;
            }
            if (this.#playing) await this.stop();

            await this.#mutex.use(async () => {
                await Debug.trace(`resize: ${ow}x${oh}`);
                await this.media.setVideoSize(ow, oh);
                this.#seekTask.request(this.#timestamp, { force: true });
            })
        },
        { deduplicator: ([a, b], [c, d]) => a == c && b == d }
    );

    async setAudioStream(id: number) {
        Debug.assert(!this.#closed);
        if (id == this.media.audio!.index) return;
        if (this.#playing) await this.stop();

        await this.#mutex.use(async () => {
            if (this.#closed) return;
            const oldrate = this.media.audio!.sampleRate;
            const status = await this.media.openAudio(id);
            // to change the sample rate we must create a new context
            if (status.sampleRate !== oldrate) {
                await this.audio.close();
                this.audio = await Audio.create(status.sampleRate);
            }

            await this.#clearCache();
            this.#seekTask.request(this.#timestamp);
        });
    }
}