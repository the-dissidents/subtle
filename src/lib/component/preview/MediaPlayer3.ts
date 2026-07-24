import { MMedia, type AudioStatus, type ReadonlyVideoFrameData } from "../../API";
import { Basic } from "../../Basic";
import type { CanvasManager } from "../../CanvasManager";
import { InterfaceConfig } from "../../config/Groups";
import { Debug } from "../../Debug";
import { Mutex } from "../../details/Mutex";
import { Playback } from "../../frontend/Playback";
import { Audio } from "./Audio";
import { MediaConfig } from "./Config";
import { AsyncEventHost, EventHost } from "@the_dissidents/svelte-ui";
import { PlayerBuffer, type SeekOptions } from "./PlayerBuffer";

const DAMPING = 0.5;

export const MediaPlayerInterface = {
    onPlayback: new EventHost<[pos: number]>(),
    onPlayStateChanged: new EventHost<[]>(),
};

export class MediaPlayer3 {
    readonly #buffer: PlayerBuffer;

    #intent: 'playing' | 'paused' | 'closed' = 'paused';
    #mutex = new Mutex(1000, 'MediaPlayer');

    #bufCanvas: OffscreenCanvas;
    #bufCtx: OffscreenCanvasRenderingContext2D;
    #displayOffset: [number, number] = [0, 0];
    #displaySize: [number, number] = [1, 1];

    #diag = {
        latencySquared: 0,
        fetchTimes: [] as number[]
    }

    get source() { return this.rawurl; }
    get isPlaying() { return this.#intent == 'playing'; }

    get duration() { return this.#buffer.media.duration; }
    get streams() { return this.#buffer.media.streams; }
    get currentAudioStream() { return this.#buffer.media.audio!.index; }
    get frameRate() { return this.#buffer.media.video!.framerate; }
    get isVfr() { return this.#buffer.media.video!.isVfr; }
    get videoSize() { return this.#buffer.media.video?.size; }
    get sampleAspectRatio() { return this.#buffer.media.video?.sampleAspectRatio; }

    get startTime() {
        return this.#buffer.startTime;
    }

    get endTime() {
        return this.#buffer.media.video!.startTime + this.#buffer.media.duration;
    }

    private constructor(
        media: MMedia, audio: Audio,
        private readonly manager: CanvasManager,
        private rawurl: string,
    ) {
        const [w, h] = manager.physicalSize;
        this.#bufCanvas = new OffscreenCanvas(w, h);
        const ctx = this.#bufCanvas.getContext('2d', { alpha: true });
        if (!ctx) throw new Error("VideoPlayer: cannot create offscreen context");
        this.#bufCtx = ctx;

        manager.onDisplaySizeChanged.bind(this, (_, __, w, h) => {
            this.#bufCanvas.width = w;
            this.#bufCanvas.height = h;
            void this.#updateOutputSize();
        });

        this.#buffer = new PlayerBuffer(media, audio);
        this.#buffer.onArrive.bind(this, (t) => {
            void Debug.trace('arrive', t);
            if (!this.#presenting) void this.#startPresenting();
            MediaPlayerInterface.onPlayback.dispatch(t);
        });
        void this.#updateOutputSize();
        void this.#startPresenting();
    }

    #updateOutputSize() {
        Debug.assert(this.#intent !== 'closed');
        Debug.assert(this.#buffer.media.video !== undefined);

        const video = this.#buffer.media.video;
        const [w, h] = this.manager.physicalSize;
        const width = video.size[0] * video.sampleAspectRatio;
        const height = video.size[1];

        Debug.assert(height !== 0);
        const ratio = width / height;

        let [ow, oh] = w / h < ratio ? [w, w / ratio] : [h * ratio, h];
        this.#displayOffset = [Math.round((w - ow) / 2), Math.round((h - oh) / 2)];

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
        return this.#buffer.resize(ow, oh);
    }

    static async create(manager: CanvasManager, rawurl: string, audioId: number) {
        const media = await MMedia.open(rawurl);
        let audioStatus: AudioStatus;
        try {
            await media.openVideo(-1, InterfaceConfig.data.useHwaccel);
            audioStatus = await media.openAudio(audioId);
            await Debug.debug('VideoPlayer: opened media');
        } catch (e) {
            if (!media.isClosed) await media.close();
            await Debug.error(e);
            throw e;
        }
        const audio = await Audio.create(audioStatus.sampleRate);
        const player = new MediaPlayer3(media, audio, manager, rawurl);
        return player;
    }

    async close() {
        EventHost.unbind(this);
        AsyncEventHost.unbind(this);

        await this.#mutex.use(async () => {
            if (this.#intent == 'closed') return Debug.early();
            this.#intent = 'closed';
            await Debug.info('closing media player');
            await this.#buffer.close();
        });
    }

    get volume() {
        return this.#buffer.audio.volume;
    }

    async setVolume(value: number) {
        await this.#buffer.audio.setVolume(value);
    }

    async #drawFrame(frame: ReadonlyVideoFrameData) {
        const ctx = this.#bufCtx;
        const start = performance.now();

        const [w, h] = this.manager.physicalSize;
        const [ow, oh] = frame.size;
        const [dw, dh] = this.#displaySize;
        const [dx, dy] = this.#displayOffset;

        ctx.clearRect(0, 0, w, h);
        const imgData = new ImageData(frame.content.data, frame.stride);
        let rescaled = false;
        if (ow !== dw || oh !== dh) {
            const bitmap = await createImageBitmap(imgData, 0, 0, ow, oh);
            ctx.drawImage(bitmap, dx, dy, dw, dh);
            bitmap.close();
            rescaled = true;
        } else {
            ctx.putImageData(imgData, dx, dy, 0, 0, ow, oh);
        }

        if (!MediaConfig.data.showDebug) return;
        const videoSize = this.#buffer.videoBufferSize
        const audioSize = this.#buffer.audio.bufferSize;
        const audioHead = this.#buffer.audio.head;

        let audioTime: string, latencyStr: string;
        if (audioHead !== undefined) {
            const latency = (audioHead - frame.time) * 1000;
            this.#diag.latencySquared = this.#diag.latencySquared * DAMPING
                + (latency * latency * (1 - DAMPING));

            audioTime = audioHead.toFixed(3);
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
        ctx.fillText(`FPS ${this.frameRate.toFixed(3)}`
                   + `SPR ${this.#buffer.media.audio!.sampleRate}`, x, 0);
        ctx.fillText(`ATi ${audioTime} s`, x, 20);
        ctx.fillText(`VTi ${frame.time.toFixed(3)} s`, x, 40);
        ctx.fillText(`LAT${latencyStr.padStart(5)}`.padEnd(10)
                   + `STS ${Math.sqrt(this.#diag.latencySquared).toFixed(1).padStart(4)}`, x, 60);
        ctx.fillText(`DRW ${(performance.now() - start).toFixed(1)}`, x, 80);
        ctx.fillText(`VBL ${this.#buffer.videoBufferLength}`.padEnd(9)
                   + `(${(videoSize / 1024 / 1024).toFixed(2)}MB)`, x, 100);
        ctx.fillText(`ABL ${this.#buffer.audio.bufferLength}`.padEnd(9)
                   + `(${(audioSize / 1024).toFixed(0)}KB)`, x, 120);
        ctx.fillText(rescaled
            ? `RES ${ow}x${oh} -> ${dw}x${dh}`
            : `RES ${ow}x${oh}`, x, 140);

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

    async #presentNextLocked() {
        if (this.#intent === 'closed') return -1;

        // if not playing, just display the current frame
        if (!this.isPlaying) {
            const frame = this.#buffer.peekVideoFrame();
            if (!frame) return 0;

            MediaPlayerInterface.onPlayback.dispatch(frame.time);
            await this.#drawFrame(frame);
            this.manager.requestRender();
            return -1;
        }

        // if there's no audio, we can't synchronize and must wait for it
        const clock = this.#buffer.audio.head;
        if (clock === undefined) return 0;

        // consume a frame
        return await this.#buffer.consumeVideoFrame(async (data) => {
            switch (data.type) {
                case "buffering":
                    await Debug.warn('presentNextLocked: buffer is empty');
                    return 0;
                case "eof":
                    await Debug.debug('presentNextLocked: at EOF');
                    void this.stop();
                    return -1;
                case "waiting_for_clock":
                    return data.earliest - clock;
                case "ok": {
                    const frame = data.frame;
                    MediaPlayerInterface.onPlayback.dispatch(frame.time);
                    await this.#drawFrame(frame);
                    this.manager.requestRender();

                    const targetTime = (this.#buffer.peekVideoFrame() ?? frame).time;
                    const framerate = this.#buffer.media.video!.framerate;
                    let delay = Math.max(0, targetTime - clock);
                    if (delay > 2 / framerate) {
                        await Debug.warn(`presentNext: delay too long:`, delay);
                        delay = 2 / framerate;
                    }
                    return delay;
                }
            }
        }, { clock: clock });
    }

    #presenting = false;
    async #startPresenting() {
        Debug.assert(!this.#presenting);
        this.#presenting = true;
        while (true) {
            const delay = await this.#mutex.use(() => this.#presentNextLocked());
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
            if (this.isPlaying || this.#intent == 'closed') return;
            this.#intent = 'playing';
            await Debug.trace('starting playback');
            await this.#buffer.audio.play();
            if (!this.#presenting) void this.#startPresenting();
        });
        MediaPlayerInterface.onPlayStateChanged.dispatch();
    }

    async stop() {
        await this.#mutex.use(async () => {
            if (!this.isPlaying || this.#intent == 'closed') return;
            this.#intent = 'paused';
            await Debug.trace('stopping playback');
            await this.#buffer.audio.stop();
        });
        MediaPlayerInterface.onPlayStateChanged.dispatch();
    }

    async requestNextFrame() {
        Debug.assert(this.#intent !== 'closed');
        if (this.#buffer.state === 'eof') return;
        const pos = await this.#buffer.waitForPlayPosition();
        void this.seek(pos + 0.001);
    }

    async requestPreviousFrame() {
        Debug.assert(this.#intent !== 'closed');
        const pos = await this.#buffer.waitForPlayPosition();
        const result = await Playback.sampler?.getFrameBefore(pos);
        if (!result) {
            void Debug.warn('cannot find previous frame');
            return;
        }
        void this.seek(result.time);
    }

    async seek(t: number, opt?: SeekOptions) {
        if (t < this.startTime) t = this.startTime;
        if (t > this.endTime) t = this.endTime;
        await this.stop();
        return this.#buffer.seek(t, opt);
    }

    async setAudioStream(id: number) {
        return this.#buffer.setAudioStream(id);
    }
}
