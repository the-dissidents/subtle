import { OrderedMap } from "@js-sdsl/ordered-map";
import { MMedia } from "../../API";
import { InterfaceConfig } from "../../config/Groups";
import { Debug } from "../../Debug";
import { AggregationTree } from "../../details/AggregationTree";
import { Mutex } from "../../details/Mutex";

class Keyframes {
    private set = new OrderedMap<number, undefined>();

    add(t: number) {
        this.set.setElement(t, undefined);
    }

    query(left: number, right: number) {
        let it = this.set.lowerBound(left);
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
    #keyframes: Keyframes;

    onProgress?: () => void;

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

    // keyframeData(level: number, from: number, to: number) {
    //     return this.#keyframes.getLevel(level).subarray(from, to);
    // }

    async getKeyframeBefore(time: number) {
        return await this.media.getKeyframeBefore(time);
    }

    private constructor(
        private readonly media: MMedia, 
        /** points per second */
        private readonly resolution: number,
    ) {
        Debug.assert(media.audio !== undefined);
        this.#intensity = this.#initAudioData();
        this.#keyframes = new Keyframes();
    }

    static async open(media: MMedia, audio: number, resolution: number) {
        await media.openAudioSampler(audio, resolution);
        await media.openVideoSampler(-1, InterfaceConfig.data.useHwaccel);
        
        return new MediaSampler2(media, resolution);
    }

    #initAudioData() {
        Debug.assert(this.media.audio !== undefined);
        this.#intensity = new AggregationTree(Float32Array,
            Math.ceil(this.media.duration * this.resolution), Math.max);
        return this.#intensity;
    }

    async setAudioStream(id: number) {
        if (id == this.media.audio!.index) return;
        if (this.isSampling)
            this.tryCancelSampling();
        await this.#mutex.use(async () => {
            await this.media.openAudio(id);
            this.#initAudioData();
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
        Debug.assert(this.#sampling);
        Debug.trace('cancelling sampling');
        this.#cancelling = true;
    }

    extendSampling(to: number) {
        Debug.assert(this.#sampling);
        const duration = this.media.duration;
        if (to > duration) to = duration;
        if (this.#sampleEnd >= to) return;
        Debug.assert(this.#sampleProgress < to);
        Debug.trace('extending sampling to', to);
        this.#sampleEnd = to;
    }

    async startSampling(from: number, to: number): Promise<void> {
        Debug.assert(!this.media.isClosed);
        if (this.#sampling) return Debug.early('already sampling');

        const duration = this.media.duration;
        Debug.assert(to > from);
        
        if (this.#eofTimestamp >= 0) {
            if (to > this.#eofTimestamp)
                to = this.#eofTimestamp;
        } else if (to > duration)
            to = duration;

        if (from >= to) return;

        this.#sampling = true;
        this.#cancelling = false;
        this.#samplerStart = from;
        this.#sampleEnd = to;

        await this.#mutex.use(async () => {
            const prevKeyframe = await this.media.getKeyframeBefore(from);
            if (prevKeyframe === null
            || this.#sampleProgress > from
            || this.#sampleProgress < prevKeyframe)
            {
                await Debug.trace(`startSampling: ${from}-${to}`);
                await this.media.seekVideo(from);
            } else {
                await Debug.trace(`startSampling: ${from}-${to} without seeking`);
            }
        });

        let doSampling = async () => {
            const ok = await this.#mutex.use(async () => {
                const result = await this.media.sampleAutomatic2(20);
                if (result.audio) {
                    this.#sampleProgress = result.audio.start; // TODO: should be end
                    this.#intensity.set(result.audio.intensity, result.audio.startIndex);
                }
                if (result.video) {
                    for (const key of result.video.keyframes)
                        this.#keyframes.add(key);
                }
                this.onProgress?.();
                if (result.isEof) {
                    Debug.trace(`sampling done upon EOF`, result);
                    this.#sampling = false;
                    if (result.audio) {
                        this.#eofTimestamp = result.audio.start;
                    } else if (result.video) {
                        this.#eofTimestamp = result.video.end;
                    } else {
                        Debug.assert(false, 'sampling EOF without audio or video data');
                    }
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