// @ts-check
/// <reference types="./AudioWorklet.d.ts" />

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
};

export type AudioFeedbackData = {
    type: 'ok' | 'playing',
    isPlaying: boolean,
    bufferLength: number,
    bufferSize: number,
    headTime: number | undefined,
    tailTime: number | undefined
};

class DecodedAudioLoader extends AudioWorkletProcessor {
    #buffer: AudioFrameData[] = [];
    #currentPosition = 0;
    #volume = 1;
    #playing: boolean = false;
    
    constructor(options?: AudioWorkletNodeOptions | undefined) {
        super(options);
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
                    this.#postFeedback('ok');
                    break;
                case "frame":
                    this.#buffer.push(e.data.frame);
                    this.#postFeedback('ok');
                    break;
                case "shiftUntil":
                    while (this.#buffer.length > 0 && e.data.time > this.#buffer[0].time)
                        this.#buffer.shift();
                    this.#postFeedback('ok');
                    break;
                case "setVolume":
                    this.#volume = e.data.value;
                    this.#postFeedback('ok');
                    break;
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
            headTime: this.#buffer[0]?.time,
            tailTime: this.#buffer.at(-1)?.time,
        } satisfies AudioFeedbackData);
    }

    #log(...args: unknown[]) {
        this.port.postMessage(args);
    }

    process(
        _inputs: Float32Array[][], 
        outputs: Float32Array[][]
    ) {
        if (!this.#playing) return true;

        try {
            const output = outputs[0];
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
                    fillPosition += end - newCurrentPosition;
                    if (end < content.length) {
                        newCurrentPosition = end;
                        break;
                    } else {
                        // this buffer entry is used up
                        newBuffer.shift();
                        this.#postFeedback('playing');

                        newCurrentPosition = 0;
                        if (end == content.length)
                            break;
                        // else, don't break
                    }
                }
            }
            this.#buffer = newBuffer;
            this.#currentPosition = newCurrentPosition;
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