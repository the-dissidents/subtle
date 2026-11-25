import type { AudioFrameData } from "../../../API";

export type AudioInputData = {
    type: 'clearBuffer' | 'suspend' | 'play' | 'query'
} | {
    type: 'shiftUntil',
    time: number
} | {
    type: 'frame',
    frame: AudioFrameData
} | {
    type: 'setVolume',
    value: number
} | {
    type: 'setPlaybackRate',
    value: number
};

export type AudioFeedbackData = {
    type: 'ok' | 'playing',
    isPlaying: boolean,
    bufferLength: number,
    bufferSize: number,
    frameLength: number | undefined,
    time: number | undefined,
    headTime: number | undefined,
    tailTime: number | undefined
};

const WSOLA_WIN = 1024;
const WSOLA_HOP = WSOLA_WIN / 2;
const WSOLA_SEARCH = 192;
const WSOLA_CORR_STEP = 4;

class DecodedAudioLoader extends AudioWorkletProcessor {
    #time?: number;
    #lastReportTime?: number;
    #buffer: AudioFrameData[] = [];
    #currentPosition = 0;
    #volume = 1;
    #playbackRate = 1;
    #playing: boolean = false;

    // WSOLA pitch-preserving time-stretch state (used only when #playbackRate !== 1)
    #hann: Float32Array;
    #inQueue = new Float32Array(WSOLA_WIN * 8);
    #inQueueLen = 0;
    #inQueueHeadTime?: number;
    #analysisOffset = 0;
    #prevTail = new Float32Array(WSOLA_HOP);
    #hasPrevTail = false;
    #outQueue = new Float32Array(WSOLA_HOP * 4);
    #outRead = 0;
    #outWrite = 0;

    #resetStretcher() {
        this.#inQueueLen = 0;
        this.#inQueueHeadTime = undefined;
        this.#analysisOffset = 0;
        this.#hasPrevTail = false;
        this.#outRead = 0;
        this.#outWrite = 0;
    }

    #upateTime(playing = true) {
        if (this.#playbackRate !== 1 && this.#inQueueHeadTime !== undefined) {
            this.#time = this.#inQueueHeadTime + this.#analysisOffset / sampleRate;
        } else {
            this.#time = this.#buffer.length == 0
                ? undefined
                : this.#currentPosition / sampleRate + this.#buffer[0].time;
        }
        if (playing && this.#time !== undefined
            && (this.#lastReportTime === undefined || Math.abs(this.#time - this.#lastReportTime) > 0.003))
        {
            this.#lastReportTime = this.#time;
            this.#postFeedback('playing');
        }
    }

    constructor(options?: AudioWorkletNodeOptions) {
        super(options);
        this.#hann = new Float32Array(WSOLA_WIN);
        for (let i = 0; i < WSOLA_WIN; i++) {
            this.#hann[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (WSOLA_WIN - 1)));
        }

        this.port.onmessage = (e: MessageEvent<AudioInputData>) => {
            switch (e.data.type) {
                case "query":
                    this.#postFeedback('ok');
                    break;
                case "suspend":
                    this.#playing = false;
                    this.#postFeedback('ok');
                    break;
                case "play":
                    this.#playing = true;
                    this.#postFeedback('ok');
                    break;
                case "clearBuffer":
                    this.#buffer = [];
                    this.#currentPosition = 0;
                    this.#resetStretcher();
                    this.#upateTime(false);
                    this.#postFeedback('ok');
                    break;
                case "frame":
                    this.#buffer.push(e.data.frame);
                    this.#upateTime(false);
                    this.#postFeedback('ok');
                    break;
                case "shiftUntil":
                    while (this.#buffer.length > 0 && e.data.time > this.#buffer[0].time)
                        this.#buffer.shift();
                    this.#currentPosition = 0;
                    this.#resetStretcher();
                    this.#upateTime(false);
                    this.#postFeedback('ok');
                    break;
                case "setVolume":
                    this.#volume = e.data.value;
                    this.#postFeedback('ok');
                    break;
                case "setPlaybackRate": {
                    const nextRate = Math.min(4, Math.max(0.25, e.data.value));
                    if (nextRate !== this.#playbackRate) {
                        this.#playbackRate = nextRate;
                        this.#resetStretcher();
                        this.#upateTime(false);
                    }
                    this.#postFeedback('ok');
                    break;
                }
                default:
                    this.#log('unexpected data: ', e.data)
                    break;
            }
        };
    }

    #postFeedback(type: AudioFeedbackData['type']) {
        this.port.postMessage({
            type,
            isPlaying: this.#playing,
            bufferLength: this.#buffer.length,
            bufferSize: this.#buffer.reduce((a, b) => a + b.content.length * 4, 0),
            frameLength: this.#buffer[0]?.length,
            time: this.#time,
            headTime: this.#inQueueHeadTime ?? this.#buffer[0]?.time,
            tailTime: this.#buffer.at(-1)?.time,
        } satisfies AudioFeedbackData);
    }

    #log(...args: unknown[]) {
        this.port.postMessage(args);
    }

    #pullInput(needed: number) {
        while (this.#inQueueLen < needed && this.#buffer.length > 0) {
            const frame = this.#buffer[0];
            if (this.#inQueueLen === 0) {
                this.#inQueueHeadTime = frame.time + this.#currentPosition / sampleRate;
            }
            const avail = frame.content.length - this.#currentPosition;
            if (avail <= 0) {
                this.#buffer.shift();
                this.#currentPosition = 0;
                continue;
            }
            const requiredCap = this.#inQueueLen + avail;
            if (requiredCap > this.#inQueue.length) {
                const grown = new Float32Array(Math.max(requiredCap, this.#inQueue.length * 2));
                grown.set(this.#inQueue.subarray(0, this.#inQueueLen));
                this.#inQueue = grown;
            }
            this.#inQueue.set(
                frame.content.subarray(this.#currentPosition),
                this.#inQueueLen
            );
            this.#inQueueLen += avail;
            this.#buffer.shift();
            this.#currentPosition = 0;
        }
    }

    #synthesizeHop(): boolean {
        const nom = Math.round(this.#analysisOffset);
        const needed = nom + WSOLA_WIN + WSOLA_SEARCH + 16;
        this.#pullInput(needed);
        if (nom + WSOLA_WIN > this.#inQueueLen) {
            return false;
        }

        let best = nom;
        if (this.#hasPrevTail) {
            const minPos = Math.max(0, nom - WSOLA_SEARCH);
            const maxPos = Math.min(this.#inQueueLen - WSOLA_WIN, nom + WSOLA_SEARCH);
            let bestScore = -Infinity;
            for (let cand = minPos; cand <= maxPos; cand += 2) {
                let dot = 0;
                let energy = 1e-9;
                for (let i = 0; i < WSOLA_HOP; i += WSOLA_CORR_STEP) {
                    const a = this.#prevTail[i];
                    const b = this.#inQueue[cand + i];
                    dot += a * b;
                    energy += b * b;
                }
                const score = dot / Math.sqrt(energy);
                if (score > bestScore) {
                    bestScore = score;
                    best = cand;
                }
            }
        }

        // Compact output queue if needed
        if (this.#outWrite + WSOLA_HOP > this.#outQueue.length) {
            const remaining = this.#outWrite - this.#outRead;
            if (remaining > 0) {
                this.#outQueue.copyWithin(0, this.#outRead, this.#outWrite);
            }
            this.#outRead = 0;
            this.#outWrite = remaining;
        }

        const outBase = this.#outWrite;
        if (this.#hasPrevTail) {
            for (let i = 0; i < WSOLA_HOP; i++) {
                this.#outQueue[outBase + i] =
                    this.#prevTail[i] + this.#inQueue[best + i] * this.#hann[i];
            }
        } else {
            for (let i = 0; i < WSOLA_HOP; i++) {
                this.#outQueue[outBase + i] = this.#inQueue[best + i];
            }
        }
        this.#outWrite += WSOLA_HOP;

        for (let i = 0; i < WSOLA_HOP; i++) {
            this.#prevTail[i] = this.#inQueue[best + WSOLA_HOP + i] * this.#hann[WSOLA_HOP + i];
        }
        this.#hasPrevTail = true;

        this.#analysisOffset += WSOLA_HOP * this.#playbackRate;

        const drop = Math.floor(this.#analysisOffset) - WSOLA_SEARCH;
        if (drop > 0) {
            const actualDrop = Math.min(drop, this.#inQueueLen);
            const remain = this.#inQueueLen - actualDrop;
            if (remain > 0) {
                this.#inQueue.copyWithin(0, actualDrop, this.#inQueueLen);
            }
            this.#inQueueLen = remain;
            this.#analysisOffset -= actualDrop;
            if (this.#inQueueHeadTime !== undefined) {
                this.#inQueueHeadTime += actualDrop / sampleRate;
            }
        }
        return true;
    }

    #processStretched(channel: Float32Array) {
        while (this.#outWrite - this.#outRead < channel.length) {
            if (!this.#synthesizeHop()) break;
        }
        const available = Math.min(channel.length, this.#outWrite - this.#outRead);
        for (let i = 0; i < available; i++) {
            channel[i] = this.#outQueue[this.#outRead + i] * this.#volume;
        }
        this.#outRead += available;
        if (available < channel.length) {
            channel.fill(0, available);
        }
    }

    process(
        _inputs: Float32Array[][],
        outputs: Float32Array[][]
    ) {
        if (!this.#playing) return true;

        try {
            const output = outputs[0];
            if (this.#playbackRate !== 1) {
                this.#processStretched(output[0]);
                this.#upateTime();
                if (this.#buffer.length == 0 && this.#inQueueLen < WSOLA_WIN) {
                    this.#log('buffer exhausted!');
                }
                return true;
            }

            let newBuffer = [...this.#buffer];
            let newCurrentPosition = this.#currentPosition;
            for (const channel of [output[0]]) {
                newBuffer = [...this.#buffer];
                newCurrentPosition = this.#currentPosition;
                let fillPosition = 0;
                while (newBuffer.length > 0) {
                    const content = newBuffer[0].content;
                    const end = channel.length - fillPosition + newCurrentPosition;
                    const part = content
                        .subarray(newCurrentPosition, Math.min(content.length, end))
                        .map((x) => x * this.#volume);
                    channel.set(part, fillPosition);
                    fillPosition += part.length;
                    if (end < content.length) {
                        newCurrentPosition = end;
                        break;
                    } else {
                        // this buffer entry is used up
                        newBuffer.shift();
                        newCurrentPosition = 0;
                        if (end == content.length)
                            break;
                        // else, don't break
                    }
                }
            }
            this.#buffer = newBuffer;
            this.#currentPosition = newCurrentPosition;
            this.#upateTime();

            if (this.#buffer.length == 0) {
                this.#log('buffer exhausted!');
            }
        } catch (e) {
            this.#log('worklet error:', e);
        }

        return true;
    }
}

registerProcessor("decoded-audio-loader", DecodedAudioLoader);
