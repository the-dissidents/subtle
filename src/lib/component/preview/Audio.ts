import type { AudioFrameData } from '../../API';
import { Debug } from '../../Debug';
import type { AudioFeedbackData, AudioInputData } from './worker/DecodedAudioLoader';
import decodedAudioLoaderUrl from './worker/DecodedAudioLoader?worker&url';

export class Audio {
    #onAudioFeedback?: (data: AudioFeedbackData) => void;
    #closed = false;
    #working = false;
    #worklet: AudioWorkletNode;
    #feedback: AudioFeedbackData = {
        type: 'ok',
        isPlaying: false,
        bufferLength: 0,
        bufferSize: 0,
        headPosition: undefined,
        tailPosition: undefined
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
        return this.#feedback.headPosition;
    }

    get tail() {
        return this.#feedback.tailPosition;
    }

    private constructor(private ctx: AudioContext) {
        this.#worklet = new AudioWorkletNode(ctx, "decoded-audio-loader");
        this.#worklet.connect(ctx.destination);
        this.#worklet.port.onmessage = (ev) => {
            if (Array.isArray(ev.data)) {
                Debug.info.apply(console, ev.data);
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
        Debug.assert(!this.#closed, 'closed (closing)');
        Debug.assert(!this.#working, 'working (closing)');
        this.#closed = true;
        await this.ctx.close();
    }

    async #post(msg: AudioInputData) {
        Debug.assert(!this.#closed, `closed (posting ${msg.type})`);
        Debug.assert(!this.#working, `working (posting ${msg.type})`);
        this.#working = true;
        return await new Promise<void>((resolve, reject) => {
            setTimeout(() => {
                this.#working = false;
                reject(new Error(`postAudioMessage: timed out (posting ${msg.type})`));
            }, 1000);
            this.#onAudioFeedback = (data) => {
                this.#working = false;
                this.#feedback = data;
                resolve();
            };
            this.#worklet.port.postMessage(msg);
        });
    }

    async clearBuffer() {
        await this.#post({ type: 'clearBuffer' });
    }

    async pushFrame(frame: AudioFrameData) {
        await this.#post({ type: 'frame', frame });
    }

    async shiftUntil(position: number) {
        await this.#post({ type: 'shiftUntil', position });
    }

    async play() {
        if (this.#feedback.isPlaying)
            return Debug.early('already playing');
        await this.#post({ type: 'play' });
    }

    async stop() {
        if (!this.#feedback.isPlaying)
            return Debug.early('already stopped');
        await this.#post({ type: 'suspend' });
    }

    async updateStatus() {
        await this.#post({ type: 'query' });
    }
}