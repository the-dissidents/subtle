import { MMedia } from "./API";
import { Basic } from "./Basic";
import { InterfaceConfig } from "./config/Groups";
import { Debug } from "./Debug";

type TypedArray = Int8Array | Uint8Array | Int16Array | Uint16Array | Int32Array | Uint32Array | Uint8ClampedArray | Float32Array | Float64Array;

const PRELOAD_MARGIN = 200;

class DataRequest<T extends TypedArray>{
    #output: T;
    #buffer: T;
    #start = 0;
    #end = 0;
    #currentLevel = -1;
    #dirty = false;

    constructor(
        ctor: new (length: number) => T,
        public readonly length: number,
        public readonly defaultValue: number,
        private readonly retrieve: (level: number, from: number, to: number) => Promise<T>
    ) {
        this.#buffer = new ctor(6000);
        this.#output = new ctor(6000);
    }

    markDirty() {
        this.#dirty = true;
    }

    get(level: number, from: number, to: number): T {
        Debug.assert(to > from && from >= 0);
        Debug.assert(to - from + 1 < this.#buffer.length);
        this.#output.fill(this.defaultValue);

        if (this.#currentLevel == level && from >= this.#start && to <= this.#end) {
            if (this.#dirty)
                this.#scheduleRequest(level, from, to);
            this.#output.set(this.#buffer);
            return this.#output.subarray(from - this.#start, to - this.#start) as T;
        }

        this.#scheduleRequest(level, from, to);

        if (this.#currentLevel !== level || from > this.#end || to < this.#start)
            return this.#output.subarray(0, to - from) as T;

        let offset = Math.max(0, this.#start - from);
        let clipStart = Math.max(0, from - this.#start);
        let clipLength = Math.min(
            this.#output.length - offset, 
            this.#end - this.#start - clipStart);
        if (clipLength > 0)
            this.#output.set(this.#buffer.subarray(clipStart, clipStart + clipLength), offset);
        return this.#output.subarray(0, to - from) as T;
    }

    #scheduledRequest: [level: number, from: number, to: number] | null = null;

    #scheduleRequest(level: number, from: number, to: number) {
        if (this.#scheduledRequest === null)
            requestAnimationFrame(() => this.#request());
        this.#scheduledRequest = [level, from, to];
    }

    async #request() {
        if (!this.#scheduledRequest) return Debug.early('no schedule');
        let [level, from, to] = this.#scheduledRequest;
        this.#scheduledRequest = null;

        Debug.assert(to > from && from >= 0);
        Debug.assert(to - from + 1 < this.#buffer.length);
        if (this.#dirty || level !== this.#currentLevel || from > this.#end || to < this.#start) {
            // clear
            const data = await this.retrieve(level, from, to);
            this.#buffer.set(data, 0);
            this.#start = from;
            this.#end = from + data.length;
            this.#currentLevel = level;
            this.#dirty = false;
            return;
        }
        if (from >= this.#start && to <= this.#end) {
            // no need
            return;
        }
        if (from < this.#start) {
            const start = from; //Math.max(0, Math.min(from, this.#start - PRELOAD_MARGIN));
            const data = await this.retrieve(level, start, this.#start);
            const moveLen = Math.min(this.#end - this.#start, this.#buffer.length - data.length);
            this.#buffer.set(this.#buffer.subarray(0, moveLen), this.#start - from);
            this.#buffer.set(data, 0);
            this.#start = start;
            this.#end = this.#start + moveLen;
        }
        if (to > this.#end) {
            const end = to; // Math.max(0, Math.min(from, this.#start - PRELOAD_MARGIN));
            const data = await this.retrieve(level, this.#end, end);
            const moveStart = Math.max(0, 
                data.length + this.#end - this.#start - this.#buffer.length);
            this.#buffer.set(this.#buffer.subarray(moveStart), 0);
            this.#buffer.set(data, this.#end - this.#start - moveStart);
            this.#start = this.#start + moveStart;
            this.#end = end;
        }
    }
}

export class MediaSampler {
    #sampleEnd = 0;
    #sampleProgress = 0;
    #cancelling = false;
    #isSampling = false;
    #sampleLength?: number;

    onProgress?: () => void;

    /** points per second */
    get keyframeResolution() { return this.media.video!.framerate; }
    /** points per second */
    get intensityResolution() { return this.media.audio!.sampleRate / this.#sampleLength!; }
    get isSampling() { return this.#isSampling; }
    get sampleEnd() { return this.#sampleEnd; }
    get sampleProgress() { return this.#sampleProgress; }

    #intensity?: DataRequest<Float32Array>;
    #keyframes?: DataRequest<Uint8Array>;

    get intensity() { return this.#intensity!; }
    get keyframes() { return this.#keyframes!; }

    private constructor(
        private readonly media: MMedia, 
        private readonly resolution: number,
    ) {
        Debug.assert(media.video !== undefined);
        this.#initAudioData();
        this.#keyframes = new DataRequest(Uint8Array, 
            media.video.length, 0, 
            (l, f, t) => this.keyframeData(l, f, t));
    }

    static async open(media: MMedia, audio: number, resolution: number) {
        await media.openAudioSampler(audio, resolution);
        await media.openVideoSampler(-1, InterfaceConfig.data.useHwaccel);
        
        return new MediaSampler(media, resolution);
    }

    #initAudioData() {
        Debug.assert(this.media.audio !== undefined);
        this.#sampleLength = Math.ceil(this.media.audio.sampleRate / this.resolution);
        this.#intensity = new DataRequest(Float32Array, 
            Math.ceil(this.media.audio.length / this.#sampleLength), NaN, 
            (l, f, t) => this.intensityData(l, f, t));
    }

    async setAudioStream(id: number) {
        if (id == this.media.audio!.index) return;
        if (this.#isSampling) {
            this.tryCancelSampling();
            await Basic.waitUntil(() => !this.#isSampling);
        }
        await this.media.openAudio(id);
        this.#initAudioData();
    }

    isClosing = false;
    async close() {
        if (this.media.isClosed)
            return Debug.early('already closed');
        this.isClosing = true;
        if (this.#isSampling) {
            this.tryCancelSampling();
            await Basic.waitUntil(() => !this.#isSampling);
        }
        await this.media.close();
    }

    tryCancelSampling() {
        Debug.assert(this.#isSampling);
        Debug.trace('cancelling sampling');
        this.#cancelling = true;
    }

    extendSampling(to: number) {
        Debug.assert(this.#isSampling);
        if (to > this.media.duration)
            to = this.media.duration;
        if (this.#sampleEnd >= to) return;
        Debug.assert(this.#sampleProgress < to);
        Debug.debug('extending sampling to', to);
        this.#sampleEnd = to;
    }

    async intensityData(level: number, from: number, to: number) {
        return await this.media.getAudioSamplerData(level, from, to);
    }

    async keyframeData(level: number, from: number, to: number) {
        return await this.media.getVideoSamplerData(level, from, to);
    }

    async getKeyframeBefore(pos: number) {
        return await this.media.getKeyframeBefore(pos);
    }

    async startSampling(from: number, to: number): Promise<void> {
        Debug.assert(!this.media.isClosed);
        if (this.isSampling) return Debug.early('already sampling');

        if (to > this.media.duration)
            to = this.media.duration;
        Debug.assert(to > from);

        Debug.assert(!this.media.isClosed);
        const framerate = this.media.video!.framerate;
        const videoPos = Math.floor(from * framerate);
        const prevKeyframe = await this.media.getKeyframeBefore(videoPos);
        await this.media.waitUntilAvailable();
        if (this.isClosing) return;
        if (prevKeyframe === null) {
            await Debug.debug(`startSampling: seeking to [${videoPos}]`);
            await this.media.seekVideo(videoPos);
        } else if (this.#sampleProgress > videoPos / framerate
                || this.#sampleProgress < prevKeyframe / framerate)
        {
            await Debug.debug(`startSampling: seeking to [${videoPos}, using ${prevKeyframe}]`);
            await this.media.seekVideo(prevKeyframe);
        }
        
        this.#isSampling = true;
        this.#cancelling = false;
        this.#sampleProgress = from;
        this.#sampleEnd = to;
        Debug.debug('start sampling', from, to);
        
        let doSampling = async () => {
            await this.media.waitUntilAvailable();
            if (this.isClosing) return;
            // const next = this.#sampleProgress 
            //     + this.#sampleLength! / this.media.audio!.sampleRate * 200;
            const next = -1;
            const result = await this.media.sampleUntil(next);
            this.intensity!.markDirty();
            this.keyframes!.markDirty();
            this.onProgress?.();
            if (result === null) {
                Debug.debug(`sampling done: EOF`);
                this.#isSampling = false;
                return;
            } 
            this.#sampleProgress = result;
            if (result > this.#sampleEnd) {
                Debug.debug(`sampling done: ${from}~${result}`);
                this.#isSampling = false;
                return;
            }
            if (this.#cancelling) {
                Debug.debug('sampling cancelled');
                this.#isSampling = false;
                return;
            }
            requestAnimationFrame(() => doSampling());
        }
        requestAnimationFrame(() => doSampling());
    }
}
