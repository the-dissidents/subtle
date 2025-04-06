import { MMedia } from "./API";
import { Basic } from "./Basic";
import { Debug } from "./Debug";
import { AggregationTree } from "./details/AggregationTree";

export class AudioSampler {
    #length: number;
    #sampleRate: number;
    #size: number;

    #sampleStart = 0;
    #sampleEnd = 0;
    #sampleProgress = 0;
    #cancelling = false;
    #isSampling = false;
    #media: MMedia;

    data: AggregationTree;
    detail: Float32Array;

    onProgress?: () => void;

    /** points per second */
    get resolution() {return this.#sampleRate / this.sampleLength;}
    get sampleRate() {return this.#sampleRate;}
    get duration() {return this.#length / this.#sampleRate;}
    get isSampling() {return this.#isSampling;}
    get sampleStart() {return this.#sampleStart / this.#sampleRate;}
    get sampleEnd() {return this.#sampleEnd / this.#sampleRate;}
    get sampleProgress() {return this.#sampleProgress / this.#sampleRate;}

    private constructor(
        length: number, rate: number, media: MMedia,
        public readonly sampleLength: number
    ) {
        this.#media = media;
        this.#length = length;
        this.#sampleRate = rate;
        this.#size = length / sampleLength;
        this.data = new AggregationTree(this.#size, Math.max);
        // this.data = new AggregationTree(this.#size, (a, b) => (a + b) / 2);
        this.detail = new Float32Array(this.#size);
    }

    static async open(media: MMedia, resolution: number) {
        await media.openAudio(-1);
        let info = await media.audioStatus();
        if (info == null)
            throw Error("Unable to open audio");
        return new AudioSampler(
            info.length, info.sampleRate, media, Math.ceil(info.sampleRate / resolution));
    }

    isClosing = false;
    async close() {
        if (this.#media.isClosed)
            return Debug.early('already closed');
        this.isClosing = true;
        if (this.#isSampling) {
            this.tryCancelSampling();
            await Basic.waitUntil(() => !this.#isSampling);
        }
        await this.#media.close();
    }

    tryCancelSampling() {
        Debug.assert(this.#isSampling);
        Debug.debug('cancelling sampling');
        this.#cancelling = true;
    }

    extendSampling(to: number) {
        Debug.assert(this.#isSampling);
        let pos = Math.floor(to * this.#sampleRate);
        if (pos > this.#length) pos = this.#length;
        if (this.#sampleEnd > pos) return;
        Debug.assert(this.#sampleProgress < pos);
        Debug.trace('extending sampling to', pos);
        this.#sampleEnd = pos;
    }

    async startSampling(from: number, to: number): Promise<void> {
        Debug.assert(!this.#isSampling && !this.#media.isClosed);
        if (this.isClosing) return;

        let a = Math.floor(from * this.#sampleRate);
        let b = Math.floor(to * this.#sampleRate);
        if (b > this.#length) b = this.#length;
        Debug.assert(b > a);

        this.#isSampling = true;
        this.#cancelling = false;
        this.#sampleProgress = a;
        Debug.debug('sampling', a, b);

        let current = a;
        await this.#media.waitUntilAvailable();
        Debug.assert(!this.#media.isClosed);
        await this.#media.seekAudio(a);
        let doSampling = async () => {
            let next = this.#sampleProgress + this.sampleLength * 500;
            if (next > b) next = b;
            await this.#media.waitUntilAvailable();
            const data = await this.#media.getIntensities(next, this.sampleLength);
            if (data.start < 0 || data.start == data.end) {
                Debug.debug(`sampling done upon EOF`, data.end, `(${from}-${current / this.#sampleRate}-${to})`);
                this.#isSampling = false;
                // FIXME: very hacky!
                this.#length = Math.min(this.#length, current);
                return;
            }
            
            const start = Math.round(data.start / this.sampleLength);
            const end = start + data.data.length + 1;
            this.data.set(data.data, start);
            this.detail.fill(1, start, end);
            this.onProgress?.();

            this.#sampleProgress = data.end;
            if (this.#sampleProgress > b) {
                Debug.debug(`sampling done: ${data.start}~${data.end}`);
                this.#isSampling = false;
                return;
            }
            if (this.#cancelling && this.#sampleProgress - a > this.sampleLength) {
                Debug.debug('sampling cancelled');
                this.#isSampling = false;
                return;
            }

            // continue
            current = data.end;
            requestAnimationFrame(() => doSampling());
        }
        requestAnimationFrame(() => doSampling());
    }
}
