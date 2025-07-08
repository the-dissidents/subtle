import { MMedia, type AudioFrameData, type AudioStatus, type VideoFrameData, type VideoStatus } from "../../API";
import { Basic } from "../../Basic";
import type { CanvasManager } from "../../CanvasManager";
import { InterfaceConfig } from "../../config/Groups";
import { Debug } from "../../Debug";
import { EventHost } from "../../details/EventHost";
import { Mutex } from "../../details/Mutex";
import { Audio } from "./Audio";
import { MediaConfig } from "./Config";

const DAMPING = 0.5;

export type SetPositionOptions = {
    imprecise?: boolean;
};

export const MediaPlayerInterface2 = {
    onPlayback: new EventHost<[pos: number]>(),
    onPlayStateChanged: new EventHost<[]>(),
};

export class MediaPlayer2 {
    #closed = false;
    #playing = false;
    #mutex = new Mutex(1000);

    /**
     * Current position in video frames. This value serves to preserve the progress when the buffers are emptied due to seeking operations. If the buffers are not empty, it must be equal to `videoBuffer[0].position`.
     */
    #position = 0;

    #videoBuffer: VideoFrameData[] = [];
    #lastFrame?: VideoFrameData;
    #seekTarget = -1;
    #preloadEOF = false;
    #playEOF = false;

    #bufCanvas: OffscreenCanvas;
    #bufCtx: OffscreenCanvasRenderingContext2D;
    #displayOffset: [number, number] = [0, 0];
    #displaySize: [number, number] = [1, 1];

    #diag = {
        fetchVideoTime: 0,
        fetchAudioTime: 0
    }

    #vpos2apos(i: number) {
        return i * this.media.audio!.sampleRate / this.media.video!.framerate;
    }

    get source() { return this.rawurl; }
    get isPlaying() { return this.#playing; }
    get duration() { return this.media.duration; }
    get streams() { return this.media.streams; }
    get currentAudioStream() { return this.media.audio!.index; }
    get frameRate() { return this.media.video!.framerate; }
    get videoSize() { return this.media.video?.size; }
    get sampleAspectRatio() { return this.media.video?.sampleAspectRatio; }

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
        Debug.assert(!this.#closed && this.media.video !== undefined);

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
        this.#resize(ow, oh);
    }

    static async create(manager: CanvasManager, rawurl: string, audioId: number) {
        const media = await MMedia.open(rawurl);
        let videoStatus: VideoStatus;
        let audioStatus: AudioStatus;
        try {
            videoStatus = await media.openVideo(-1, InterfaceConfig.data.useHwaccel);
            audioStatus = await media.openAudio(audioId);
            await Debug.debug('VideoPlayer: opened media');
        } catch (e) {
            media.close();
            Debug.error(e);
            throw e;
        }
        const audio = await Audio.create(audioStatus.sampleRate);
        const player = new MediaPlayer2(media, manager, rawurl, audio);
        return player;
    }

    async close() {
        await this.#mutex.use(async () => {
            if (this.#closed) return;
            this.#closed = true;
            await Debug.info('closing media player');
            await this.audio.close();
            await this.media.close();
        });
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
        this.#seekTarget = -1;
        Debug.debug(`seeked to ${frame.position} [${frame.time.toFixed(3)}]`);
    }

    // Must be called while locked
    async #receiveAudioFrame(frame: AudioFrameData) {
        if (this.audio.tail !== undefined && this.audio.tail > frame.position) {
            await Debug.warn(`receiveFrame: abnormal audio frame ordering: ${frame.position} < ${this.audio.tail}`);
            await this.#clearCache();
            return;
        }
        if (this.#seekTarget >= 0) {
            if (frame.position < this.#vpos2apos(this.#seekTarget))
                return;
            else if (this.#videoBuffer.length > 0)
                this.#seekDone();
        }
        if (this.audio.bufferLength == 0)
            await Debug.trace('receiveFrame: first audio at', frame.position, frame.time);
        await this.audio.pushFrame(frame);
    }

    // Must be called while locked
    async #receiveVideoFrame(frame: VideoFrameData) {
        if (this.#videoBuffer.length > 0 && this.#videoBuffer.at(-1)!.position > frame.position) {
            await Debug.warn(`receiveFrame: abnormal video frame ordering: ${frame.position} < ${this.#videoBuffer.at(-1)!.position}`);
            await this.#clearCache();
            return;
        }
        if (this.#seekTarget > 0 && frame.position < this.#seekTarget)
            return;
        this.#videoBuffer.push(frame);
        this.#lastFrame = frame;
        if (this.#seekTarget > 0 && this.audio.bufferLength > 0)
            this.#seekDone();
        if (this.#videoBuffer.length == 1) {
            this.#position = frame.position;
            MediaPlayerInterface2.onPlayback.dispatch(frame.time);
            await Debug.trace('receiveFrame: first video at', frame.position, frame.time);
            if (!this.#presenting) this.#present();
        }
    }

    // Must be called while locked
    async #receiveFrame(frame: AudioFrameData | VideoFrameData | null, elapsed: number) {
        if (!frame) {
            this.#preloadEOF = true;
            return false;
        }
        Debug.assert(!this.#preloadEOF);
        if (frame.type == 'audio') {
            this.#diag.fetchAudioTime = 
                this.#diag.fetchAudioTime * DAMPING + elapsed * (1 - DAMPING);
            await this.#receiveAudioFrame(frame);
        } else {
            this.#diag.fetchVideoTime = 
                this.#diag.fetchVideoTime * DAMPING + elapsed * (1 - DAMPING);
            await this.#receiveVideoFrame(frame);
        }
        return true;
    }

    async #receiveNextFrame() {
        if (this.#preloadEOF || this.#closed)
            return false;

        const preloadAmount = MediaConfig.data.preloadAmount;
        const sampleRate = this.media.audio!.sampleRate;
        if (this.audio.tail !== undefined
         && this.audio.tail! - this.audio.head! > preloadAmount * sampleRate
         && this.#videoBuffer.length > 1
         && this.#videoBuffer.at(-1)!.time - this.#videoBuffer[0].time > preloadAmount)
        {
            // enough frames preloaded
            // update the debug info about buffer lengths
            if (!this.#presenting) this.#present();
            return false;
        }

        if (this.#mutex.acquireIfIdle()) {
            try {
                const start = performance.now();
                const frame = await this.media.readNextFrame();
                const elapsed = performance.now() - start;
                return await this.#receiveFrame(frame, elapsed);
            } finally {
                this.#mutex.release();
                return true;
            }
        } else {
            // busy: skip this iteration
            return true;
        }
    }

    #populateBufferRunning = false;
    async #populateBuffer() {
        Debug.assert(!this.#populateBufferRunning);
        this.#populateBufferRunning = true;
        while (await this.#receiveNextFrame())
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
            rescaled = true;
        } else {
            ctx.putImageData(imgData, dx, dy, 0, 0, ow, oh);
        }

        if (!MediaConfig.data.showDebug) return;
        const videoSize = this.#videoBuffer
            .map((x) => x.content.length)
            .reduce((a, b) => a + b, 0);
        const audioSize = this.audio.bufferSize;
        const sampleRate = this.media.audio!.sampleRate;

        let audioTime = this.audio.head !== undefined
            ? (this.audio.head / sampleRate).toFixed(3) : 'n/a';
        let latency = this.audio.head !== undefined
            ? (frame.time - this.audio.head / sampleRate).toFixed(3) : 'n/a';
        if (!latency.startsWith('-')) latency = ' ' + latency;
        
        ctx.fillStyle = 'red';
        ctx.font = `${window.devicePixelRatio * 10}px Courier`;
        ctx.textBaseline = 'top';

        const x = dx;
        ctx.fillText(
            `FPS ${this.media.video!.framerate.toFixed(3)} SPR ${this.media.audio!.sampleRate}`, x, 0);
        ctx.fillText(
            `ATi ${audioTime.padEnd(9)}[${frame.position}]`, x, 20);
        ctx.fillText(
            `VTi ${frame.time.toFixed(3)}`, x, 40);
        ctx.fillText(
            `LAT${latency}`, x, 60);
        ctx.fillText(
            `DRW ${(performance.now() - start).toFixed(1)}`, x, 80);
        ctx.fillText(
            `FVT ${this.#diag.fetchVideoTime.toFixed(2)}`.padEnd(10) 
          + `FAT ${this.#diag.fetchAudioTime.toFixed(2)}`, x, 100);
        ctx.fillText(
            `VBL ${this.#videoBuffer.length}`.padEnd(9)
            + `(${(videoSize / 1024 / 1024).toFixed(2)}MB)`, x, 120);
        ctx.fillText(
            `ABL ${this.audio.bufferLength}`.padEnd(9) 
            + `(${(audioSize / 1024).toFixed(0)}KB)`, x, 140);
        if (rescaled)
            ctx.fillText(`RES ${ow}x${oh} -> ${dw}x${dh}`, x, 160);
        else
            ctx.fillText(`RES ${ow}x${oh}`, x, 160);
    }

    async #presentNext() {
        if (this.#closed) return -1;

        if (!this.#playing) {
            let frame = this.#videoBuffer.at(0);
            if (this.#playEOF) {
                Debug.assert(this.#lastFrame !== undefined);
                frame = this.#lastFrame;
            }
            if (!frame) return 0;
            if (frame.position !== this.#position) {
                await Debug.warn(`position=${this.#position}, frame=${frame.position}`);
                // return 0;
            }
            await this.#drawFrame(frame);
            this.manager.requestRender();
            return -1;
        }

        // playing
        if (this.#videoBuffer.length == 0) {
            if (this.#preloadEOF) {
                this.#playEOF = true;
                await this.stop();
                return 0; // render one more time
            }
            // ensure preloading
            if (!this.#populateBufferRunning)
                this.#populateBuffer();
            return 0;
        }
    
        if (this.audio.head === undefined)
            return 0;

        // TODO: currently we never discard any video frames even when decoding is slow; also the synchronization can be better (currently latency is about 50ms)
        const frame = this.#videoBuffer.shift()!;
        this.#position = frame.position;
        MediaPlayerInterface2.onPlayback.dispatch(frame.time);
        await this.#drawFrame(frame);
        this.manager.requestRender();

        if (!this.#populateBufferRunning)
            this.#populateBuffer();

        const clock = this.audio.head / this.media.audio!.sampleRate;
        return Math.max(0, Math.min(frame.time - clock, 2 / this.media.video!.framerate));
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
        MediaPlayerInterface2.onPlayStateChanged.dispatch();
    }

    async stop() {
        await this.#mutex.use(async () => {
            if (!this.isPlaying || this.#closed) return;
            this.#playing = false;
            await Debug.debug('stopping playback');
            await this.audio.stop();
        });
        MediaPlayerInterface2.onPlayStateChanged.dispatch();
    }

    requestNextFrame() {
        Debug.assert(!this.media.isClosed);
        if (this.#playEOF) return;
        this.requestSeekToFrame(this.#position + 1);
    }

    requestPreviousFrame() {
        Debug.assert(!this.media.isClosed);
        if (this.#position == 0) return;
        this.requestSeekToFrame(this.#position - 1);
    }

    requestSeekToTime(t: number, opt?: SetPositionOptions) {
        // todo
        this.seekToTime(t, opt);
    }

    async seekToTime(t: number, opt?: SetPositionOptions) {
        if (t < 0) t = 0;
        if (t > this.duration) t = this.duration;
        const index = Math.ceil(t * this.media.video!.framerate);
        await this.seekToFrame(index, opt)
    }

    requestSeekToFrame(index: number, opt?: SetPositionOptions) {
        // todo
        this.seekToFrame(index, opt);
    }

    #seekFrameVersion = 0;
    async seekToFrame(index: number, opt?: SetPositionOptions) {
        this.#seekFrameVersion += 1;
        const myVersion = this.#seekFrameVersion;
        if (this.#playing) await this.stop();

        await this.#mutex.use(async () => {
            if (this.#closed 
             || this.#seekFrameVersion != myVersion
             || this.#seekTarget == index
             || this.#position == index) return;

            Debug.debug(`seek: ${index} [${index / this.media.video!.framerate}]`);
            await this.#clearCache();
            if (!(opt?.imprecise))
                this.#seekTarget = index;
            await this.media.seekVideo(Math.max(0, index - 2));
            if (this.#seekFrameVersion != myVersion) return;

            if (!(opt?.imprecise)) {
                const audioIndex = Math.floor(this.#vpos2apos(index));
                const frame = await this.media.skipUntil(index, audioIndex);
                await this.#receiveFrame(frame, 0);
            }
            if (!this.#populateBufferRunning)
                this.#populateBuffer();
        });
        
        if (!this.#presenting) this.#present();
    }

    #resizeVersion = 0;
    async #resize(ow: number, oh: number) {
        this.#resizeVersion += 1;
        const myVersion = this.#resizeVersion;

        await this.#mutex.use(async () => {
            if (this.#closed || this.#resizeVersion != myVersion) return;
            const [cw, ch] = this.media.outputSize;
            if (ow === cw && oh === ch) return;

            await Debug.debug(`resize: ${ow}x${oh}`);
            await this.media.setVideoSize(ow, oh);
            await this.#clearCache();
            this.seekToFrame(this.#position);
        });
        
        if (!this.#presenting) this.#present();
    }

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
            this.seekToFrame(this.#position);
        });
    }
}