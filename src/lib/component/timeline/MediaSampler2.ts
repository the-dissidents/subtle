import { MMedia } from "../../API";
import { Basic } from "../../Basic";
import { InterfaceConfig } from "../../config/Groups";
import { Debug } from "../../Debug";
import { AggregationTree } from "../../details/AggregationTree";
import { Mutex } from "../../details/Mutex";

export class MediaSampler2 {
    #sampleLength: number;
    #samplerStart = 0;
    #sampleEnd = 0;
    #sampleProgress = 0;
    #cancelling = false;

    #sampling = false;
    #mutex = new Mutex(1000);

    #intensity: AggregationTree<Float32Array>;
    #keyframes: AggregationTree<Uint8Array>;

    onProgress?: () => void;

    /** points per second */
    get keyframeResolution() { return this.media.video!.framerate; }
    /** points per second */
    get intensityResolution() { return this.media.audio!.sampleRate / this.#sampleLength; }
    get isSampling() { return this.#sampling; }
    get sampleStart() { return this.#samplerStart / this.media.audio!.sampleRate; }
    get sampleEnd() { return this.#sampleEnd / this.media.audio!.sampleRate; }
    get sampleProgress() { return this.#sampleProgress / this.media.audio!.sampleRate; }

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
        
        return new MediaSampler2(media, resolution);
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
        if (this.isSampling)
            this.tryCancelSampling();
        await this.#mutex.acquire();
        await this.media.openAudio(id);
        this.#initAudioData();
        this.#mutex.release();
    }

    async close() {
        if (this.media.isClosed)
            return Debug.early('already closed');
        if (this.isSampling)
            this.tryCancelSampling();
        await this.#mutex.acquire();
        await this.media.close();
        this.#mutex.release();
    }

    tryCancelSampling() {
        Debug.assert(this.#sampling);
        Debug.trace('cancelling sampling');
        this.#cancelling = true;
    }

    extendSampling(to: number) {
        Debug.assert(this.#sampling);
        let pos = Math.floor(to * this.media.audio!.sampleRate);
        const length = this.media.audio!.length;
        if (pos > length) pos = length;
        if (this.#sampleEnd >= pos) return;
        Debug.assert(this.#sampleProgress < pos);
        Debug.trace('extending sampling to', pos);
        this.#sampleEnd = pos;
    }

    async startSampling(from: number, to: number): Promise<void> {
        Debug.assert(!this.media.isClosed);
        if (this.#sampling) return Debug.early('already sampling');

        const sampleRate = this.media.audio!.sampleRate;
        const length = this.media.audio!.length;
        let a = Math.floor(from * sampleRate);
        let b = Math.floor(to * sampleRate);
        if (b > length) b = length;
        Debug.assert(b > a);

        this.#sampling = true;
        this.#cancelling = false;
        this.#samplerStart = a;
        this.#sampleEnd = b;

        await this.#mutex.use(async () => {
            const framerate = this.media.video!.framerate;
            const videoPos = Math.max(0, Math.floor(from * framerate - 1));
            const prevKeyframe = await this.media.getKeyframeBefore(videoPos);
            if (prevKeyframe === null
            || this.#sampleProgress > videoPos / framerate
            || this.#sampleProgress < prevKeyframe / framerate)
            {
                await Debug.trace(`startSampling: ${from}-${to} ${a}-${b}; -> [${videoPos}]`);
                await this.media.seekVideo(videoPos);
            } else {
                await Debug.trace(`startSampling: ${from}-${to} ${a}-${b}`);
            }
        });

        let doSampling = async () => {
            const ok = await this.#mutex.use(async () => {
                const result = await this.media.sampleAutomatic2(20);
                this.#sampleProgress = result.audio.position;
                this.#intensity.set(result.audio.intensity, result.audio.start);
                this.#keyframes.set(result.video.keyframes, result.video.start);
                this.onProgress?.();
                if (result.isEof) {
                    Debug.trace(`sampling done upon EOF`);
                    this.#sampling = false;
                    return false;
                }
                if (this.#sampleProgress > this.#sampleEnd) {
                    Debug.trace(`sampling done: ${from}~${this.#sampleProgress}`);
                    this.#sampling = false;
                    return false;
                }
                if (this.#cancelling) {
                    Debug.trace('sampling cancelled');
                    this.#sampling = false;
                    this.#cancelling = false;
                    return false;
                }
                return true;
            });
            if (ok) requestAnimationFrame(() => doSampling());
        }
        requestAnimationFrame(() => doSampling());
    }
}