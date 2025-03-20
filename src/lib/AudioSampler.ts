import { MMedia } from "./API";
import { assert } from "./Basic";

export class AudioSampler {
    #length: number;
    #sampleRate: number;
    #size: number;
    // TODO: implement a fixed buffer size, adjust resolution dynamically since data retreival is very fast now
    // #bufferSize = 250000;

    #sampleStart = 0;
    #sampleEnd = 0;
    #sampleProgress = 0;
    #cancelling = false;
    #isSampling = false;
    #media: MMedia;

    static SAMPLE_LENGTH = 512;
    data: Float32Array;
    detail: Float32Array;

    onProgress?: () => void;

    get resolution() {return this.#sampleRate / AudioSampler.SAMPLE_LENGTH;}
    get sampleRate() {return this.#sampleRate;}
    get duration() {return this.#length / this.#sampleRate;}
    get isSampling() {return this.#isSampling;}
    get sampleStart() {return this.#sampleStart / this.#sampleRate;}
    get sampleEnd() {return this.#sampleEnd / this.#sampleRate;}
    get sampleProgress() {return this.#sampleProgress / this.#sampleRate;}

    private constructor(length: number, rate: number, media: MMedia) {
        this.#media = media;
        this.#length = length;
        this.#sampleRate = rate;
        this.#size = length / AudioSampler.SAMPLE_LENGTH;
        this.data = new Float32Array(this.#size);
        this.detail = new Float32Array(this.#size);
    }

    static async open(media: MMedia) {
        await media.openAudio(-1);
        let info = await media.audioStatus();
        if (info == null)
            throw Error("Unable to open audio");
        return new AudioSampler(
            info.length, info.sampleRate, media);
    }

    async close() {
        await this.#media.close();
    }

    tryCancelSampling() {
        assert(this.#isSampling);
        this.#cancelling = true;
    }

    extendSampling(to: number) {
        assert(this.#isSampling);
        let pos = Math.floor(to * this.#sampleRate);
        if (pos > this.#length) to = this.#length;
        assert(this.#sampleProgress < pos);
        assert(this.#sampleEnd <= pos);
        this.#sampleEnd = pos;
    }

    async startSampling(from: number, to: number): Promise<void> {
        assert(!this.#isSampling);

        let a = Math.floor(from * this.#sampleRate);
        let b = Math.floor(to * this.#sampleRate);
        if (b > this.#length) b = this.#length;
        assert(b > a);

        this.#isSampling = true;
        this.#cancelling = false;
        this.#sampleProgress = a;

        let current = a;
        await this.#media.waitUntilAvailable();
        await this.#media.seekAudio(a);
        let doSampling = async () => {
            let next = this.#sampleProgress + AudioSampler.SAMPLE_LENGTH * 500;
            if (next > b) next = b;
            await this.#media.waitUntilAvailable();
            const data = await this.#media.getIntensities(next, AudioSampler.SAMPLE_LENGTH);
            if (data.start < 0 || data.start == data.end) {
                console.log(`sampling done upon EOF`, data.end, `(${from}-${current / this.#sampleRate}-${to})`);
                this.#isSampling = false;
                // FIXME: very hacky!
                this.#length = Math.min(this.#length, current);
                return;
            }
            
            const start = Math.round(data.start / AudioSampler.SAMPLE_LENGTH);
            const end = start + data.data.length + 1;
            this.data.set(data.data, start);
            this.detail.fill(1, start, end);
            this.onProgress?.();

            this.#sampleProgress = data.end;
            if (this.#sampleProgress > b) {
                // console.log(`sampling done with ${counter} steps, last=${data.start}~${data.end}, pos=${status.position}`);
                // console.log(data);
                this.#isSampling = false;
                return;
            }
            if (this.#cancelling && this.#sampleProgress - a > AudioSampler.SAMPLE_LENGTH) {
                // console.log('sucessfully cancelled');
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
