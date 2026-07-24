import type { AudioFrameData, DecodeResult, MMedia, ReadonlyVideoFrameData, VideoFrameData } from "$lib/API";
import { Basic } from "$lib/Basic";
import { Debug } from "$lib/Debug";
import { Mutex } from "$lib/details/Mutex";
import { RestartableTask } from "$lib/details/RestartableTask";
import { SlabBuffer } from "$lib/details/SlabBuffer";
import { Playback } from "$lib/frontend/Playback";
import { EventHost } from "@the_dissidents/svelte-ui";
import { Audio } from "./Audio";
import { MediaConfig } from "./Config";
import { type SetPositionOptions } from "./MediaPlayer";

export const FETCH_TIME_N = 20;

export type SeekOptions = {
    imprecise?: boolean;
};

type State = 'buffering' | 'buffer_full' | 'eof' | 'buffer_eof' | 'closed' | 'suspended';

export type ConsumedFrame = {
    type: 'ok',
    frame: ReadonlyVideoFrameData
} | {
    type: 'buffering' | 'eof'
} | {
    type: 'waiting_for_clock',
    earliest: number
};

export class PlayerBuffer {
    #state: State = 'buffering';
    #mutex = new Mutex(1000, 'PlayerBuffer');
    #audio: Audio;

    // read position of the internal media API
    #readVideoPosition?: number;

    // eslint-disable-next-line no-unused-private-class-members
    #readAudioPosition?: number;

    #playPosition?: number;

    #pool: SlabBuffer<ImageDataArray>;
    #videoBuffer: VideoFrameData[] = [];

    #diag = {
        fetchTimes: [] as number[]
    }

    onArrive = new EventHost<[time: number]>();

    constructor(
        readonly media: MMedia,
        audio: Audio,
    ) {
        this.#audio = audio;
        this.#pool = this.#reallocatePool();
        void this.#startBuffering();
    }

    get fetchTimes() {
        return this.#diag.fetchTimes as readonly number[];
    }

    get videoBufferLength() {
        return this.#videoBuffer.length;
    }

    get videoBufferSize() {
        return this.#videoBuffer.reduce((p, c) => p + c.content.data.length, 0);
    }

    get startTime() {
        return Math.min(
            this.media.video?.startTime ?? Infinity,
            this.media.audio?.startTime ?? Infinity);
    }

    get audio() {
        return this.#audio;
    }

    get state() {
        return this.#state;
    }

    #setState(s: State) {
        if (s !== this.#state) {
            this.#state = s;
            // void Debug.trace('state ->', s);
        }
    }

    async setAudioStream(id: number) {
        if (this.state === 'closed') return Debug.early();
        if (id == this.media.audio!.index) return Debug.early();

        const pos = await this.waitForPlayPosition();
        await this.#mutex.use(async () => {
            if (this.state === 'closed') return Debug.early();
            const oldrate = this.media.audio!.sampleRate;
            const status = await this.media.openAudio(id);

            if (status.sampleRate !== oldrate) {
                await this.audio.close();
                this.#audio = await Audio.create(status.sampleRate);
            }

            await this.#clearBufferLocked();
            void this.#seek.request(pos);
        });
    }

    async close() {
        await this.#mutex.use(async () => {
            if (this.state === 'closed') return Debug.early();
            await this.#clearBufferLocked();
            this.#setState('closed');
            await this.media.close();
            await this.audio.close();
        });
    }

    peekVideoFrame() {
        return this.#videoBuffer.at(0) as
            ReadonlyVideoFrameData | undefined;
    }

    async consumeVideoFrame<T>(
        fn: (frame: ConsumedFrame) => T | Promise<T>,
        opt?: { clock?: number }
    ): Promise<T> {
        const frame: ConsumedFrame = await this.#mutex.use(() => {
            if (this.#state == 'eof') return { type: 'eof' };

            if (this.#videoBuffer.length == 0) {
                // no buffer
                void this.#startBuffering();
                return { type: 'buffering' };
            }

            // find last frame whose timestamp is before the clock
            const index = opt?.clock
                ? this.#videoBuffer.findLastIndex((v) => v.time <= opt.clock!)
                : 0;
            if (index < 0) {
                // if not found, all frames are after the clock timestamp
                return { type: 'waiting_for_clock', earliest: this.#videoBuffer[0].time };
            }

            // found the frame to consume
            const f = this.#videoBuffer[index];
            Debug.assert(!!f);
            this.#playPosition = f.time;

            // free earlier frames
            if (index > 0) void Debug.trace(`skipping ${index} frames`);
            for (let i = 0; i < index; i++)
                this.#videoBuffer.shift()!.content.delete();
            // remove this frame from buffer but delete only later
            this.#videoBuffer.shift();

            if (this.#videoBuffer.length === 0 && this.#state == 'buffer_eof')
                this.#setState('eof');
            if (this.needBuffering())
                void this.#startBuffering();
            return { type: 'ok', frame: f };
        });

        try {
            return await fn(frame);
        } catch (e) {
            await Debug.forwardError(e);
            throw e;
        } finally {
            if (frame.type == 'ok')
                (frame.frame as VideoFrameData).content.delete();
        }
    }

    async seek(target: number, opt?: SetPositionOptions) {
        return this.#seek.request(target, opt);
    }

    async resize(w: number, h: number) {
        return this.#resize.request(w, h);
    }

    #resize = new RestartableTask<[w: number, h: number]>(async ([w, h], tok) => {
        const pos = await this.waitForPlayPosition();
        await this.#mutex.use(async () => {
            if (this.state === 'closed') return;
            if (tok.isCancelled) return;
            await this.media.setVideoSize(w, h);
            if (tok.isCancelled) return;
            await this.#clearBufferLocked();
            if (tok.isCancelled) return;
            void this.#seek.request(pos)
        });
    }, { deduplicator: ([a, b], [c, d]) => a == c && b == d })

    async waitForPlayPosition() {
        while (true) {
            const pos = await this.#mutex.use(() => this.#playPosition);
            if (pos !== undefined) return pos;
            if (this.#state == 'closed') return -1;
            await Debug.trace('waiting for play position');
            Debug.assert(this.#state == 'buffering');
        }
    }

    async #clearBufferLocked() {
        this.#setState('suspended');
        this.#videoBuffer.forEach((x) => x.content.delete());
        this.#videoBuffer = [];
        await this.audio.clearBuffer();
        await Debug.trace('cache cleared');
    }

    #reallocatePool() {
        const [w, h] = this.media.video!.size;
        const len = Math.ceil(MediaConfig.data.videoCacheSize * 1.5);
        const size = Math.ceil((w * h * 4 + 24) * 1.5);
        if (!this.#pool) {
            this.#pool = new SlabBuffer(Uint8ClampedArray, len, size);
            return this.#pool;
        }
        this.#pool = this.#pool.resize(
            Math.max(this.#pool.maxCapacity, len),
            Math.max(this.#pool.maxItemSize, size)
        );
        return this.#pool;
    }

    async #receiveAudioFrameLocked(frame: AudioFrameData) {
        if (this.audio.tail !== undefined && this.audio.tail > frame.time) {
            await Debug.warn(
                `receiveAudioFrameLocked: abnormal ordering: ${frame.time} < ${this.audio.tail}`);
            return;
        }
        await this.audio.pushFrame(frame);
        this.#readAudioPosition = frame.time;
    }

    async #receiveVideoFrameLocked(frame: VideoFrameData) {
        if (this.#videoBuffer.length > 0 && this.#videoBuffer.at(-1)!.time > frame.time) {
            await Debug.warn(`receiveVideoFrame: abnormal ordering: `
                + `${frame.time} < ${this.#videoBuffer.at(-1)!.time}`);
            return;
        }
        this.#videoBuffer.push(frame);
        this.#readVideoPosition = frame.time;
        if (this.#videoBuffer.length == 1) {
            this.#playPosition = frame.time;
            this.onArrive.dispatch(frame.time);
        }
    }

    async #receiveLocked(result: DecodeResult) {
        if (result.audio.length == 0 && result.video.length == 0) {
            this.#setState('buffer_eof');
        } else {
            for (const frame of result.audio)
                await this.#receiveAudioFrameLocked(frame);
            for (const frame of result.video)
                await this.#receiveVideoFrameLocked(frame);
        }
    }

    needBuffering() {
        if (this.state == 'buffer_eof' || this.state == 'eof')
            return false;

        return this.#videoBuffer.length < MediaConfig.data.videoCacheSize
            || this.audio.tail !== undefined && this.audio.head !== undefined
               && this.audio.tail - this.audio.head < MediaConfig.data.audioPreloadAmount;
    }

    async #decodeLocked() {
        Debug.assert(this.state !== 'closed');
        if (!this.needBuffering()) {
            // enough frames preloaded
            this.#setState('buffer_full');
            return;
        }

        const start = performance.now();
        const targetTime = MediaConfig.data.preloadWorkTime;
        const result = await this.media.decodeAutomatic(targetTime, this.#pool);
        const time = performance.now() - start;
        this.#diag.fetchTimes.push(time);
        if (this.#diag.fetchTimes.length > FETCH_TIME_N)
            this.#diag.fetchTimes.shift();

        // await Debug.trace(`decodeLocked: ${result.audio.length}, ${result.video.length}`);
        await this.#receiveLocked(result);
    }

    #bufferingRunning = false;
    async #startBuffering() {
        Debug.assert(this.state !== 'closed');
        if (this.#bufferingRunning) return;

        this.#setState('buffering');
        this.#bufferingRunning = true;
        while (true) {
            const result = await this.#mutex.useIfIdle(async () => {
                if (this.state == 'suspended') {
                    this.#setState('buffering');
                }
                if (this.#state !== 'buffering' && this.#state !== 'suspended') {
                    this.#bufferingRunning = false;
                    return false;
                }
                await this.#decodeLocked();
                return true;
            });
            if (result === false) break;
            await Basic.wait(0);
        }
    }

    #seek = new RestartableTask<[target: number, opt?: SetPositionOptions]>(
        async ([target, opt], _tok) => await this.#mutex.use(async () => {
            if (this.state === 'closed') return Debug.early();

            await Debug.trace('seek: start');

            if (this.#videoBuffer.length >= 2
             && target >= this.#videoBuffer[0].time
             && target <= this.#videoBuffer.at(-1)!.time)
            {
                // inside cache
                while (this.#videoBuffer[0].time < target) {
                    const frame = this.#videoBuffer.shift();
                    frame?.content.delete();
                }

                await this.audio.shiftUntil(target);

                Debug.assert(this.#videoBuffer.length > 0);
                const frame = this.#videoBuffer[0];
                this.#playPosition = frame.time;
                this.onArrive.dispatch(frame.time);
                await Debug.trace(`seek: [${frame.time.toFixed(3)}] inside cache`);

                if (this.needBuffering())
                    void this.#startBuffering();
            } else {
                await this.#clearBufferLocked();

                const realTarget = Math.max(target, this.startTime);
                const lastKeyframe = await Playback.sampler?.getKeyframeBefore(realTarget);

                if (this.#readVideoPosition === undefined
                 || target <= this.#readVideoPosition
                 || !lastKeyframe
                 || lastKeyframe.time > this.#readVideoPosition)
                {
                    // must seek
                    await this.media.seekVideo(realTarget);
                    await Debug.trace(`seek: [${target.toFixed(3)}] by time (${realTarget.toFixed(3)})`);
                    if (lastKeyframe)
                        await Debug.trace(`seek: info: last keyframe is`, lastKeyframe);
                } else {
                    // no need to seek
                    await Debug.trace(`seek: [${target.toFixed(3)}] not seeked`);
                }

                this.#readAudioPosition = undefined;
                this.#readVideoPosition = undefined;
                this.#playPosition = undefined;

                if (!(opt?.imprecise)) {
                    let frames = await this.media.skipUntil(target, this.#pool);
                    await Debug.trace('skipUntil: arriving at',
                        frames.audio[0]?.time, frames.video[0]?.time);

                    let i = 0;
                    while (frames.audio.length == 0 || frames.video.length == 0) {
                        // a problem in seeking caused us to arrive past the target
                        i++;
                        const newTarget = realTarget - i;
                        if (newTarget < this.startTime) break;
                        await this.#clearBufferLocked();
                        await this.media.seekVideo(newTarget);
                        frames = await this.media.skipUntil(target, this.#pool);
                    }
                    if (i > 0)
                        await Debug.trace(`seek: retried ${i} time[s]`);

                    await this.#receiveLocked(frames);
                }
                void this.#startBuffering();
            }
        })
    );
}
