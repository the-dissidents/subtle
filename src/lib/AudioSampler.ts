import { MMedia } from "./API";
import { Basic } from "./Basic";
import { Debug } from "./Debug";

type TypedArray = Int8Array | Uint8Array | Int16Array | Uint16Array | Int32Array | Uint32Array | Uint8ClampedArray | Float32Array | Float64Array;

const PRELOAD_MARGIN = 200;
const AUDIO_SAMPLER_RATE = 48000;

class DataRequest<T extends TypedArray>{
    #output: T;
    #buffer: T;
    #start = 0;
    #end = 0;
    #currentLevel = -1;

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
        this.#currentLevel = -1;
    }

    get(level: number, from: number, to: number): T {
        Debug.assert(to > from && from >= 0);
        Debug.assert(to - from + 1 < this.#buffer.length);
        this.#output.fill(this.defaultValue);
        if (this.#currentLevel !== level || from > this.#end || to < this.#start) {
            this.request(level, from, to);
            return this.#output.subarray(0, to - from) as T;
        }
        if (from >= this.#start && to <= this.#end) {
            this.#output.set(this.#buffer);
            return this.#output.subarray(from - this.#start, to - this.#start) as T;
        }
        let offset = Math.max(0, this.#start - from);
        let clipStart = Math.max(0, from - this.#start);
        let clipLength = Math.min(
            this.#output.length - offset, 
            this.#end - this.#start - clipStart);
        if (clipLength > 0)
            this.#output.set(this.#buffer.subarray(clipStart, clipStart + clipLength), offset);
        this.request(level, from, to);
        return this.#output.subarray(0, to - from) as T;
    }

    async request(level: number, from: number, to: number) {
        Debug.assert(to > from && from >= 0);
        Debug.assert(to - from + 1 < this.#buffer.length);
        if (level !== this.#currentLevel || from > this.#end || to < this.#start) {
            // clear
            const data = await this.retrieve(level, from, to);
            this.#buffer.set(data, 0);
            this.#start = from;
            this.#end = from + data.length;
            this.#currentLevel = level;
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

export class AudioSampler {
    #sampleEnd = 0;
    #sampleProgress = 0;
    #cancelling = false;
    #isSampling = false;

    onProgress?: () => void;

    get videoFramerate() {return this.media.videoStatus!.framerate;}
    /** points per second */
    get intensityResolution() {return AUDIO_SAMPLER_RATE / this.sampleLength;}
    get duration() {return this.media.duration;}
    get isSampling() {return this.#isSampling;}
    get sampleEnd() {return this.#sampleEnd;}
    get sampleProgress() {return this.#sampleProgress;}

    readonly intensity: DataRequest<Float32Array>;
    readonly keyframes: DataRequest<Uint8Array>;

    private constructor(
        private readonly media: MMedia, 
        public readonly sampleLength: number
    ) {
        Debug.assert(media.audioStatus !== undefined);
        Debug.assert(media.videoStatus !== undefined);

        this.intensity = new DataRequest(Float32Array, 
            Math.ceil(media.audioStatus.length / sampleLength), NaN, 
            (l, f, t) => this.intensityData(l, f, t));
        this.keyframes = new DataRequest(Uint8Array, 
            media.videoStatus.length, 0, 
            (l, f, t) => this.keyframeData(l, f, t));
    }

    static async open(media: MMedia, audio: number, resolution: number) {
        const sampleLength = Math.ceil(AUDIO_SAMPLER_RATE / resolution);
        await media.openAudioSampler(audio, sampleLength);
        await media.openVideoSampler(-1);
        
        return new AudioSampler(media, sampleLength);
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
        if (to > this.duration) to = this.duration;
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

    async startSampling(from: number, to: number): Promise<void> {
        Debug.assert(!this.#isSampling && !this.media.isClosed);
        if (this.isClosing) return;

        if (to > this.duration) to = this.duration;
        Debug.assert(to > from);

        // if (to < this.#sampleProgress) return;
        
        this.#isSampling = true;
        this.#cancelling = false;
        this.#sampleProgress = from;
        this.#sampleEnd = to;
        Debug.debug('start sampling', from, to);

        await this.media.waitUntilAvailable();
        Debug.assert(!this.media.isClosed);

        await this.media.seekVideo(Math.floor(from * this.videoFramerate));
        
        let doSampling = async () => {
            let next = this.#sampleProgress + this.sampleLength / AUDIO_SAMPLER_RATE * 100;
            if (next > this.#sampleEnd) next = this.#sampleEnd;
            await this.media.waitUntilAvailable();
            await this.media.sampleUntil(next);
            this.#sampleProgress = next;
            this.intensity.markDirty();
            this.keyframes.markDirty();
            this.onProgress?.();
            if (next == this.#sampleEnd) {
                Debug.debug(`sampling done: ${from}~${this.#sampleEnd}`);
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
