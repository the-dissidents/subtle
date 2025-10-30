import { OrderedMap } from "@js-sdsl/ordered-map";
import { MMedia } from "../../API";
import { InterfaceConfig } from "../../config/Groups";
import { Debug } from "../../Debug";
import { AggregationTree } from "../../details/AggregationTree";
import { Mutex } from "../../details/Mutex";

class Index {
    private set = new OrderedMap<number, number>();

    add(t: number, pos: number) {
        this.set.setElement(t, pos);
    }

    /** returns true if there is at least 1 keyframe in [left, right] */
    query(left: number, right: number) {
        const it = this.set.lowerBound(left);
        if (it.equals(this.set.rEnd())) return false;
        return it.pointer[0] <= right;
    }
}

export class MediaSampler2 {
    #samplerStart = 0;
    #sampleEnd = 0;
    #sampleProgress = 0;
    #cancelling = false;

    #sampling = false;
    #mutex = new Mutex(1000, 'MediaSampler2');

    #eofTimestamp = -1;

    #intensity: AggregationTree<Float32Array>;
    #videoIndex: Index;

    onProgress?: () => void;

    get startTime() { return this.media.audio!.startTime; }
    get endTime() {
        return this.#eofTimestamp > 0
            ? this.#eofTimestamp
            : this.media.duration + this.startTime;
    }

    get #iota() {
        return 2 / this.resolution;
    }

    #updateEOF(value: number | undefined) {
        if (value !== undefined && (this.#eofTimestamp < 0 || this.#eofTimestamp > value))
            this.#eofTimestamp = value;
    }

    /** points per second */
    get keyframeResolution() { return this.media.video!.framerate; }
    /** points per second */
    get intensityResolution() { return this.resolution; }
    get isSampling() { return this.#sampling; }
    get sampleStart() { return this.#samplerStart; }
    get sampleEnd() { return this.#sampleEnd; }
    get sampleProgress() { return this.#sampleProgress; }

    intensityData(level: number, from: number, to: number) {
        return this.#intensity.getLevel(level).subarray(from, to);
    }

    keyframeData(from: number, to: number) {
        return this.#videoIndex.query(from, to);
    }

    async getKeyframeBefore(time: number) {
        return await this.media.getKeyframeBefore(time);
    }

    async getFrameBefore(time: number) {
        return await this.media.getFrameBefore(time);
    }

    private constructor(
        private readonly media: MMedia, 
        /** points per second */
        private readonly resolution: number,
    ) {
        Debug.assert(media.audio !== undefined);
        this.#intensity = new AggregationTree(Float32Array,
            Math.ceil(this.media.duration * this.resolution), Math.max);
        this.#videoIndex = new Index();
    }

    static async open(media: MMedia, audio: number, resolution: number) {
        await media.openAudioSampler(audio, resolution);
        await media.openVideoSampler(-1, InterfaceConfig.data.useHwaccel);
        
        return new MediaSampler2(media, resolution);
    }

    async setAudioStream(id: number) {
        if (id == this.media.audio!.index) return;
        if (this.isSampling)
            this.tryCancelSampling();
        await this.#mutex.use(async () => {
            await this.media.openAudioSampler(id, this.resolution);
            this.#intensity.clear();
        });
    }

    async close() {
        if (this.media.isClosed)
            return Debug.early('already closed');
        if (this.isSampling)
            this.tryCancelSampling();
        await this.#mutex.use(() => this.media.close());
    }

    tryCancelSampling() {
        Debug.assert(this.#sampling, 'not sampling');
        this.#cancelling = true;
    }

    extendSampling(to: number) {
        Debug.assert(this.#sampling);
        if (to > this.endTime)
            to = this.endTime;
        if (this.#sampleEnd >= to) return;
        Debug.assert(this.#sampleProgress < to);
        Debug.trace('extending sampling to', to);
        this.#sampleEnd = to;
    }

    async startSampling(from: number, to: number): Promise<void> {
        Debug.assert(!this.media.isClosed && this.media.audio !== undefined);
        if (this.#sampling) return Debug.early('already sampling');

        Debug.assert(to > from);
        if (from < this.startTime)
            from = this.startTime;
        if (from >= this.endTime - this.#iota) return;
        if (to > this.endTime)
            to = this.endTime;
        if (from >= to) return;

        this.#sampling = true;
        this.#cancelling = false;
        this.#samplerStart = from;
        this.#sampleProgress = from;
        this.#sampleEnd = to;

        await this.#mutex.use(async () => {
            const prevKeyframe = await this.media.getKeyframeBefore(from);
            if (prevKeyframe === null
             || this.#sampleProgress > from
             || this.#sampleProgress < prevKeyframe.time)
            {
                await Debug.trace(`startSampling: ${from.toFixed(4)} - ${to.toFixed(4)}`);
                await this.media.seekVideo(from);
            } else {
                await Debug.trace(`startSampling: ${from.toFixed(4)} - ${to.toFixed(4)} without seeking`);
            }
        });

        const doSampling = async () => {
            const ok = await this.#mutex.use(async () => {
                const result = await this.media.sampleAutomatic3(20);
                if (result.audio) {
                    this.#sampleProgress = result.audio.endTime;
                    this.#intensity.set(result.audio.intensity, result.audio.startIndex);
                }
                if (result.video) {
                    for (const [time, pos] of result.video.keyframes)
                        this.#videoIndex.add(time, pos);
                }
                this.onProgress?.();
                if (result.isEof) {
                    await Debug.trace(`sampling done upon EOF`, 
                        result.audio?.endTime?.toFixed(4), result.video?.endTime?.toFixed(4));
                    this.#sampling = false;
                    this.#updateEOF(result.audio?.endTime);
                    this.#updateEOF(result.video?.endTime);
                    return false;
                }
                if (this.#sampleProgress > this.#sampleEnd) {
                    await Debug.trace(`sampling done: ${from.toFixed(4)} - ${this.#sampleProgress.toFixed(4)}`);
                    this.#sampling = false;
                    return false;
                }
                if (this.#cancelling) {
                    await Debug.trace('sampling cancelled');
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