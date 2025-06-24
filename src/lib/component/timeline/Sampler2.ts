import { MMedia } from "../../API";
import { Basic } from "../../Basic";
import { InterfaceConfig } from "../../config/Groups";
import { Debug } from "../../Debug";
import { AggregationTree } from "../../details/AggregationTree";

export class Sampler {
    #sampleLength: number;

    #sampleEnd = 0;
    #sampleProgress = 0;
    #cancelling = false;
    #isSampling = false;

    #intensity: AggregationTree<Float32Array>;
    #keyframes: AggregationTree<Uint8Array>;

    onProgress?: () => void;

    /** points per second */
    get keyframeResolution() { return this.media.video!.framerate; }
    /** points per second */
    get intensityResolution() { return this.media.audio!.sampleRate / this.#sampleLength; }
    get isSampling() { return this.#isSampling; }
    get sampleEnd() { return this.#sampleEnd; }
    get sampleProgress() { return this.#sampleProgress; }

    intensityData(level: number, from: number, to: number) {
        return this.#intensity.getLevel(level).subarray(from, to);
    }

    keyframeData(level: number, from: number, to: number) {
        return this.#keyframes.getLevel(level).subarray(from, to);
    }

    async getKeyframeBefore(pos: number) {
        return await this.media.getKeyframeBefore(pos);
    }

    private constructor(
        private readonly media: MMedia, 
        /** points per second */
        private readonly resolution: number,
    ) {
        Debug.assert(media.audio !== undefined);
        this.#sampleLength = Math.ceil(media.audio.sampleRate / resolution);
        this.#intensity = this.#initAudioData();
        this.#keyframes = new AggregationTree(Uint8Array,
            Math.ceil(this.media.video!.length), Math.max);
    }

    static async open(media: MMedia, audio: number, resolution: number) {
        await media.openAudioSampler(audio, resolution);
        await media.openVideoSampler(-1, InterfaceConfig.data.useHwaccel);
        
        return new Sampler(media, resolution);
    }

    #initAudioData() {
        Debug.assert(this.media.audio !== undefined);
        this.#sampleLength = Math.ceil(this.media.audio.sampleRate / this.resolution);
        this.#intensity = new AggregationTree(Float32Array,
            Math.ceil(this.media.audio.length / this.#sampleLength), Math.max);
        return this.#intensity;
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
        let pos = Math.floor(to * this.media.audio!.sampleRate);
        const length = this.media.audio!.length;
        if (pos > length) pos = length;
        if (this.#sampleEnd >= pos) return;
        Debug.assert(this.#sampleProgress < pos);
        Debug.trace('extending sampling to', pos);
        this.#sampleEnd = pos;
    }

    async startSampling(from: number, to: number): Promise<void> {
        Debug.assert(!this.#isSampling && !this.media.isClosed);
        if (this.isClosing) return;

        const sampleRate = this.media.audio!.sampleRate;
        const length = this.media.audio!.length;
        let a = Math.floor(from * sampleRate);
        let b = Math.floor(to * sampleRate);
        if (b > length) b = length;
        Debug.assert(b > a);
        
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
        this.#sampleEnd = b;
        Debug.debug('start sampling', from, to);
        Debug.trace('sampling', a, b);

        let doSampling = async () => {
            await this.media.waitUntilAvailable();
            if (this.isClosing) return;
            const result = await this.media.sampleAutomatic2(20);
            this.#intensity.set(result.audio.intensity, result.audio.start);
            this.#keyframes.set(result.video.keyframes, result.video.start);
            this.onProgress?.();

            this.#sampleProgress = result.audio.position;
            if (result.isEof) {
                Debug.debug(`sampling done upon EOF`);
                this.#isSampling = false;
                return;
            }
            if (this.#sampleProgress > b) {
                Debug.trace(`sampling done: ${from}~${this.#sampleProgress}`);
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