// @ts-check
/// <reference types="./AudioWorklet.d.ts" />

import type { AudioFrameData } from "../../../API";

export type AudioInputData = {
    type: 'clearBuffer' | 'suspend' | 'play'
} | {
    type: 'shiftUntil',
    position: number
} | {
    type: 'frame',
    frame: AudioFrameData
};

export type AudioFeedbackData = {
    type: 'ok' | 'playing',
    isPlaying: boolean,
    bufferLength: number,
    bufferSize: number,
    headPosition: number | undefined,
    tailPosition: number | undefined
};

class DecodedAudioLoader extends AudioWorkletProcessor {
    #buffer: AudioFrameData[] = [];
    #currentPosition = 0;
    #playing: boolean = false;
    
    constructor(...args: any) {
        super(...args);
        this.port.onmessage = (e: MessageEvent<AudioInputData>) => {
            switch (e.data.type) {
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
                    while (this.#buffer.length > 0 && e.data.position > this.#buffer[0].position)
                        this.#buffer.shift();
                    this.#postFeedback('ok');
                    break;
                default:
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
            headPosition: this.#buffer[0]?.position,
            tailPosition: this.#buffer.at(-1)?.position,
        } satisfies AudioFeedbackData);
    }

    log(...args: any[]) {
        this.port.postMessage(args);
    }

    process(
        inputs: Float32Array[][], 
        outputs: Float32Array[][], 
        parameters: Record<string, Float32Array>
    ) {
        if (!this.#playing) return true;

        this.#postFeedback('playing');

        try {
            const output = outputs[0];
            let newBuffer = [...this.#buffer];
            let newCurrentPosition = this.#currentPosition;
            for (const channel of [output[0]]) {
                newBuffer = [...this.#buffer];
                newCurrentPosition = this.#currentPosition;
                let fillPosition = 0;
                let counter = 0;
                while (newBuffer.length > 0) {
                    counter += 1;
                    let content = newBuffer[0].content;
                    let end = channel.length - fillPosition + newCurrentPosition;
                    let part = content.subarray(newCurrentPosition, Math.min(content.length, end));
                    channel.set(part, fillPosition);
                    fillPosition += end - newCurrentPosition;
                    if (end < content.length) {
                        newCurrentPosition = end;
                        break;
                    } else {
                        // this buffer entry is used up
                        newBuffer.shift();
                        newCurrentPosition = 0;
                        if (end == content.length) {
                            break;
                        }
                        // else, don't break
                    }
                }
            }
            this.#buffer = newBuffer;
            this.#currentPosition = newCurrentPosition;
            if (this.#buffer.length == 0) {
                this.log('buffer exhausted!');
            }
        } catch (e) {
            this.log('worklet error:', e);
        }

        return true;
    }
  }
  
  registerProcessor("decoded-audio-loader", DecodedAudioLoader);