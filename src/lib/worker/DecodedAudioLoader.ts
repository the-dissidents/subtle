// @ts-check
/// <reference types="./AudioWorklet.d.ts" />

import type { AudioFrameData } from "../API";

export type AudioFeedbackData = {
    type: 'received' | 'playing',
    bufferLength: number,
    bufferCapacity: number,
    averageFullness: number,
    headPosition: number
}

const MaxBufferLength = 10;

class DecodedAudioLoader extends AudioWorkletProcessor {
    #buffer: AudioFrameData[] = [];
    #fullness: number[] = [];
    #currentPosition = 0;
    
    constructor(...args: any) {
        super(...args);
        this.port.onmessage = (e: MessageEvent<AudioFrameData>) => {
            this.#buffer.push(e.data);
            if (this.#buffer.length > MaxBufferLength) {
                this.#buffer.shift();
            }
            this.#postFeedback('received');
        };
    }

    #postFeedback(type: AudioFeedbackData['type']) {
        this.port.postMessage({
            type,
            bufferLength: this.#buffer.length,
            bufferCapacity: MaxBufferLength,
            headPosition: this.#buffer[0]?.position,
            averageFullness: type == 'playing' 
                ? this.#fullness.reduce((a, b) => a + b, 0) / MaxBufferLength 
                : -1
        } as AudioFeedbackData);
    }

    log(...args: any[]) {
        this.port.postMessage(args);
    }

    process(
        inputs: Float32Array[][], 
        outputs: Float32Array[][], 
        parameters: Record<string, Float32Array>
    ) {
        this.#fullness.push(this.#buffer.length);
        if (this.#fullness.length > 100) this.#fullness.shift();
        this.#postFeedback('playing');
        // if (Math.random() < 0.001) this.log(this.#buffer);

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