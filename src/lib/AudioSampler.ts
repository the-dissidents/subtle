import { assert } from "./Basic";

export class AudioSampler {
    #audio: HTMLAudioElement;
    #ctx: AudioContext;
    #analyser: AnalyserNode;
    #tempdata: Float32Array;
    #size = 0;

    #sampleStart = 0;
    #sampleEnd = 0;
    #sampleProgress = 0;
    #cancelling = false;
    #isSampling = false;

    static RESOLUTION = 60; // data point per second 
    data = new Float32Array;
    detail = new Float32Array;
    get duration() {return this.#audio.duration;}
    get isSampling() {return this.#isSampling;}
    get sampleStart() {return this.#sampleStart;}
    get sampleEnd() {return this.#sampleEnd;}
    get sampleProgress() {return this.#sampleProgress;}

    private constructor() {
        this.#audio = new Audio();
        this.#ctx = new AudioContext();
        let sn = this.#ctx.createMediaElementSource(this.#audio);
        this.#analyser = this.#ctx.createAnalyser();
        this.#analyser.fftSize = 2048;
        this.#analyser.smoothingTimeConstant = 0;
        this.#tempdata = new Float32Array(this.#analyser.fftSize);
        sn.connect(this.#analyser);
        //this.#analyser.connect(this.#ctx.destination);
    }

    static create(url: string) {
        return new Promise<AudioSampler>((resolve, reject) => {
            let obj = new AudioSampler();
            let handler1 = () => {
                console.log('audio: loadeddata');
                obj.#audio.removeEventListener('loadeddata', handler1);
                obj.#size = Math.round(obj.#audio.duration * this.RESOLUTION);
                obj.data = new Float32Array(obj.#size);
                obj.detail = new Float32Array(obj.#size);
                resolve(obj);
            };
            let handler2 = (ev: ErrorEvent) => {
                obj.#audio.removeEventListener('error', handler2);
                reject('error loading video: ' + ev.message);
            }
            // TODO: error handler
            obj.#audio.addEventListener('loadeddata', handler1);
            obj.#audio.addEventListener('error', handler2);
            obj.#audio.src = url;
            obj.#audio.volume = 1;
            obj.#audio.load();
        });
    }

    tryCancelSampling() {
        assert(this.#isSampling);
        this.#cancelling = true;
    }

    extendSampling(to: number) {
        assert(this.#isSampling);
        if (to > this.#audio.duration) to = this.#audio.duration;
        assert(this.#sampleProgress < to);
        assert(this.sampleEnd <= to);
        this.#sampleEnd = to;
    }

    startSampling(a: number, b: number, speed: number): Promise<void> {
        assert(!this.#isSampling);

        if (b > this.#audio.duration) b = this.#audio.duration;
        assert(b > a);
        this.#isSampling = true;
        this.#cancelling = false;
        this.#audio.playbackRate = speed;
        this.#audio.currentTime = a;

        console.log('starting sampling: ', a, b, 'at', speed);
        return new Promise<void>((resolve) => {
            let prev = this.#audio.currentTime;
            let prev_i = Math.ceil(a * AudioSampler.RESOLUTION);
            let handler = () => {
                this.#sampleProgress = this.#audio.currentTime;
                let index = Math.floor(this.#sampleProgress * AudioSampler.RESOLUTION);

                if (this.#cancelling && this.sampleProgress - a > 0.01) {
                    console.log('sucessfully cancelled');
                    this.#isSampling = false;
                    this.#audio.pause();
                    resolve();
                    return;
                }
                if (index >= b * AudioSampler.RESOLUTION) {
                    console.log('sampling done');
                    this.#isSampling = false;
                    this.#audio.pause();
                    resolve();
                    return;
                }
                if (this.#sampleProgress - prev > 0) {
                    this.#analyser.getFloatTimeDomainData(this.#tempdata);
                    let result = 0;
                    for (let i = 0; i < this.#tempdata.length; i++)
                        result += Math.pow(this.#tempdata[i], 2);
                    result *= 8 / this.#tempdata.length;
                    // for (let i = 0; i < this.#tempdata.length; i++)
                    //     result = Math.max(result, Math.abs(this.#tempdata[i]));
                    let di = index - prev_i + 1;
                    for (let i = prev_i; i < index; i++) {
                        if (this.detail[i] == 0 /*|| this.detail[i] > di*/) {
                            this.data[i] = result;
                            this.detail[i] = di;
                        } else {
                            // adjust data[i] based on current detail level
                            let ratio = di / (di + this.detail[i]);
                            this.data[i] = this.data[i] * ratio + result * (1-ratio);
                            this.detail[i] = this.detail[i] * ratio + di * (1-ratio);
                        }
                    }
                    prev = this.#sampleProgress;
                    prev_i = index;
                }
                //setTimeout(handler, 10);
                requestAnimationFrame(handler);
            };
            // this.#audio.play().then(() => setTimeout(handler, 10));
            this.#audio.play().then(() => requestAnimationFrame(handler));
        });
    }
}
