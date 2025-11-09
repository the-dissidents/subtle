import type { AudioFrameData } from '../../API';
import { Debug } from '../../Debug';
import { Mutex } from '../../details/Mutex';
import type { AudioFeedbackData, AudioInputData } from './worker/DecodedAudioLoader';
import decodedAudioLoaderUrl from './worker/DecodedAudioLoader?worker&url';

const VOLUME_POWER = 3;

export class Audio {
    #onAudioFeedback?: (data: AudioFeedbackData) => void;
    #closed = false;
    #worklet: AudioWorkletNode;
    #mutex = new Mutex(1000, 'audio');
    #volume = 1;

    #feedback: AudioFeedbackData = {
        type: 'ok',
        isPlaying: false,
        bufferLength: 0,
        bufferSize: 0,
        headTime: undefined,
        tailTime: undefined
    };

    get isPlaying() {
        return this.#feedback.isPlaying;
    }

    get bufferLength() {
        return this.#feedback.bufferLength;
    }

    get bufferSize() {
        return this.#feedback.bufferSize;
    }

    get head() {
        return this.#feedback.headTime;
    }

    get tail() {
        return this.#feedback.tailTime;
    }

    get volume() {
        return this.#volume;
    }

    private constructor(private ctx: AudioContext) {
        this.#worklet = new AudioWorkletNode(ctx, "decoded-audio-loader");
        this.#worklet.connect(ctx.destination);
        this.#worklet.port.onmessage = (ev) => {
            if (Array.isArray(ev.data)) {
                // Debug.info.apply(console, ev.data);
            } else {
                const feedback = ev.data as AudioFeedbackData;
                if (this.#onAudioFeedback)
                    this.#onAudioFeedback(feedback);
            }
        };
    }

    static async create(sampleRate: number) {
        const ctx = new AudioContext({ sampleRate });
        await ctx.audioWorklet.addModule(decodedAudioLoaderUrl);
        return new Audio(ctx);
    }

    async close() {
        Debug.assert(!this.#closed);
        await this.#mutex.acquire();
        this.#closed = true;
        await this.ctx.close();
    }

    async #post(msg: AudioInputData) {
        Debug.assert(!this.#closed);
        await this.#mutex.use(() => new Promise<void>((resolve, reject) => {
            setTimeout(() => {
                reject(new Error(`postAudioMessage: timed out (posting ${msg.type})`));
            }, 1000);
            this.#onAudioFeedback = (data) => {
                this.#feedback = data;
                resolve();
            };
            this.#worklet.port.postMessage(msg);
        }));
    }

    async clearBuffer() {
        await this.#post({ type: 'clearBuffer' });
    }

    async pushFrame(frame: AudioFrameData) {
        await this.#post({ type: 'frame', frame });
    }

    async shiftUntil(time: number) {
        await this.#post({ type: 'shiftUntil', time });
    }

    async play() {
        if (this.#feedback.isPlaying)
            return Debug.early();
        await this.#post({ type: 'play' });
    }

    async stop() {
        if (!this.#feedback.isPlaying)
            return Debug.early();
        await this.#post({ type: 'suspend' });
    }

    async setVolume(value: number) {
        if (value == this.#volume) return;
        this.#volume = value;
        await this.#post({ type: 'setVolume', value: Math.pow(value, VOLUME_POWER) });
    }

    async updateStatus() {
        await this.#post({ type: 'query' });
    }
}