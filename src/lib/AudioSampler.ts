import { MAPI, MMedia } from "./API";
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

    static SAMPLE_LENGTH = 1024;
    data: Float32Array;
    detail: Float32Array;

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

    startSampling(from: number, to: number, speed: number): Promise<void> {
        assert(!this.#isSampling);
        let a = Math.floor(from * this.#sampleRate);
        let b = Math.floor(to * this.#sampleRate);
        if (b > this.#length) b = this.#length;
        assert(b > a);

        let doSampling = async (resolve: () => void) => {
            let next = this.#sampleProgress + AudioSampler.SAMPLE_LENGTH * 500;
            if (next > b) next = b;
            const data = await this.#media.getIntensities(next, AudioSampler.SAMPLE_LENGTH);
            const status = await this.#media.audioStatus();
            assert(status !== null);
            this.#sampleProgress = status.position;
            
            const start = Math.round(data.start / AudioSampler.SAMPLE_LENGTH);
            const end = start + data.data.length;
            this.data.set(data.data, start);
            this.detail.fill(1, start, end);

            if (this.#cancelling && this.#sampleProgress - a > 0.01) {
                console.log('sucessfully cancelled');
                this.#isSampling = false;
                resolve(); return;
            }
            if (this.#sampleProgress > b - AudioSampler.SAMPLE_LENGTH) {
                console.log('sampling done');
                this.#isSampling = false;
                resolve(); return;
            }

            // continue
            requestAnimationFrame(() => doSampling(resolve));
        }

        this.#isSampling = true;
        this.#cancelling = false;
        return new Promise<void>((resolve) => {
            this.#media.seekAudio(a).then(() => {
                this.#sampleProgress = a;
                console.log('starting sampling: ', a, b, 'at', speed);
                requestAnimationFrame(() => doSampling(resolve));
            });
        })
    }
}
