import { invoke, Channel } from '@tauri-apps/api/core';
import { Debug } from './Debug';

export type StreamInfo = {
    type: 'audio' | 'video' | 'subtitle' | 'unknown',
    index: number,
    description: string
};

export type AudioStatus = {
    index: number,
    length: number,
    sampleRate: number
};

export type VideoStatus = {
    index: number,
    length: number,
    framerate: number,
    sampleAspectRatio: number,
    size: [width: number, height: number],
};

export type SampleResult = {
    audio: {
        start: number,
        position: number,
        intensity: number[]
    } | null,
    video: {
        start: number,
        keyframes: number[]
    } | null,
    isEof: boolean
};

export type MediaEvent = {
    event: 'done'
    data: {}
} | {
    event: 'EOF'
    data: {}
} | {
    event: 'opened'
    data: { id: number }
} | {
    event: 'mediaStatus',
    data: {
        audioIndex: number,
        videoIndex: number,
        duration: number,
        streams: StreamInfo[]
    }
} | {
    event: 'audioStatus',
    data: AudioStatus
} | {
    event: 'videoStatus',
    data: VideoStatus
} | {
    event: 'debug',
    data: { message: string }
} | {
    event: 'runtimeError',
    data: { what: string }
} | {
    event: 'noStream',
    data: {}
} | {
    event: 'invalidId',
    data: {}
} | {
    event: 'ffmpegVersion',
    data: { value: string }
} | {
    event: 'keyframeData',
    data: { pos: number | null }
} | {
    event: 'sampleDone2',
    data: SampleResult
};

class MediaError extends Error {
    constructor(msg: string, public readonly from: string) {
        super(`${msg} (${from})`);
        this.name = 'MediaError';
    }
}

type MediaEventKey = MediaEvent['event'];
type MediaEventData = {[E in MediaEvent as E['event']]: E['data']};
type MediaEventHandler<key extends MediaEventKey> = (data: MediaEventData[key]) => void;

function createChannel(
    from: string, handler: {[key in MediaEventKey]?: MediaEventHandler<key>}, 
    reject: (e: any) => void, timeout = 2000
) {
    if (timeout > 0) setTimeout(
        () => reject(new MediaError(`timed out [${timeout}ms]`, from)), timeout);
    
    const channel = new Channel<MediaEvent>;
    channel.onmessage = (msg) => {
        let h = handler[msg.event];
        // 'as any' because (A => C) | (B => C) will not accept A | B as the parameter
        if (h) {
            h(msg.data as any);
            return;
        }

        switch (msg.event) {
        case 'debug':
            Debug.info(msg.data.message);
            break;
        case 'runtimeError':
            return reject(new MediaError('runtimeError: ' + msg.data.what, from));
        case 'invalidId':
            return reject(new MediaError('invalid media ID referenced', from));
        default:
            return reject(new Error('unhandled event: ' + msg.event));
        }
    }
    // Debug.trace('created channel for', from);
    return channel;
}

export type VideoFrameData = {
    type: 'video',
    position: number,
    time: number,
    stride: number,
    size: [width: number, height: number],
    content: Uint8ClampedArray<ArrayBuffer>
};

export type AudioFrameData = {
    type: 'audio',
    position: number,
    time: number,
    content: Float32Array
};

export class MMedia {
    #destroyed = false;
    #currentJobs = 0;
    #video: VideoStatus | undefined;
    #audio: AudioStatus | undefined;
    #outSize: [number, number] = [-1, -1];
    #eof = false;

    get video(): Readonly<VideoStatus> | undefined {
        return this.#video;
    }

    get audio(): Readonly<AudioStatus> | undefined {
        return this.#audio;
    }

    get outputSize(): readonly [number, number] {
        return this.#outSize;
    }

    get streams(): readonly StreamInfo[] {
        return this._streams;
    }

    get duration() {
        return this._duration;
    }

    get hasJob() {
        Debug.assert(this.#currentJobs >= 0);
        return this.#currentJobs != 0;
    }

    get isEOF() {
        return this.#eof;
    }

    private constructor(
        private id: number,
        private _duration: number,
        private _streams: StreamInfo[]
    ) {
        Debug.info(`media ${id} opened`);
    }

    #readFrameData(data: ArrayBuffer): AudioFrameData | VideoFrameData {
        const view = new DataView(data);
        const type = view.getUint32(0, true) == 0 ? 'audio' : 'video';
        const position = view.getInt32(4, true);
        const time = view.getFloat64(8, true);
        if (type == 'audio') {
            const length = view.getUint32(16, true);
            const content = new Float32Array(data, 20, length);
            // Debug.debug('received:', `audio @${position}(${time})`)
            // this.#_finalizationReg.register(data, `audio @${position}(${time})`);
            return { type, position, time, content } satisfies AudioFrameData;
        } else {
            const stride = view.getUint32(16, true);
            const length = view.getUint32(20, true);
            const content = new Uint8ClampedArray(data, 24, length);
            // Debug.debug('received:', `video @${position}(${time})`)
            // this.#_finalizationReg.register(data, `video @${position}(${time})`);
            return { type, position, time, stride, content, 
                size: [...this.#outSize] } satisfies VideoFrameData;
        }
    }

    #readFloatArrayData(data: ArrayBuffer) {
        const view = new DataView(data);
        const length = view.getUint32(0, true);
        const content = new Float32Array(data, 4, length);
        return content;
    }

    #readByteArrayData(data: ArrayBuffer) {
        const view = new DataView(data);
        const length = view.getUint32(0, true);
        const content = new Uint8Array(data, 4, length);
        return content;
    }

    static async open(path: string) {
        const id = await new Promise<number>((resolve, reject) => {
            let channel = createChannel('open', {
                opened: (data) => resolve(data.id)
            }, reject);
            invoke('open_media', {path, channel});
        });
        const status = await new Promise<{
            audioIndex: number,
            videoIndex: number,
            duration: number,
            streams: StreamInfo[]
        }>((resolve, reject) => {
            let channel = createChannel('open/status', {
                mediaStatus: (data) => resolve(data)
            }, reject);
            invoke('media_status', {id, channel});
        });
        return new MMedia(id, status.duration, status.streams);
    }

    get isClosed() {
        return this.#destroyed;
    }

    async close() {
        Debug.assert(!this.#destroyed);
        await new Promise<void>((resolve, reject) => {
            let channel = createChannel('close', {
                done: () => {
                    Debug.info(`media ${this.id} closed`);
                    this.#destroyed = true;
                    // IPC.deleteListeners(this);
                    resolve();
                }
            }, reject);
            invoke('close_media', {id: this.id, channel});
        });
    }
    
    async waitUntilAvailable() {
        return await new Promise<void>((resolve, reject) => {
            setTimeout(() => reject(
                new MediaError('timed out [1000ms]', 'waitUntilAvailable')), 1000);
            const wait = () => {
                if (!this.hasJob) resolve();
                else setTimeout(wait, 1);
            };
            wait();
        });
    }

    async openAudio(audioId: number) {
        Debug.assert(!this.#destroyed);
        this.#audio = await new Promise<AudioStatus>((resolve, reject) => {
            let channel = createChannel('openAudio', {
                audioStatus: (data) => resolve(data)
            }, reject);
            invoke('open_audio', {id: this.id, audioId, channel});
        });
        return this.#audio;
    }

    async openAudioSampler(audioId: number, resolution: number) {
        Debug.assert(!this.#destroyed);
        this.#audio = await new Promise<AudioStatus>((resolve, reject) => {
            let channel = createChannel('openAudioSampler', {
                audioStatus: (data) => resolve(data)
            }, reject);
            invoke('open_audio_sampler', {id: this.id, audioId, resolution, channel});
        });
        return this.#audio;
    }

    async openVideo(videoId: number, accel: boolean) {
        Debug.assert(!this.#destroyed);
        this.#video = await new Promise<VideoStatus>((resolve, reject) => {
            let channel = createChannel('openVideo', {
                videoStatus: (data) => resolve(data)
            }, reject);
            invoke('open_video', {id: this.id, videoId, accel, channel});
        });
        this.#outSize = [...this.#video.size];
        return this.#video;
    }

    async openVideoSampler(videoId: number, accel: boolean) {
        Debug.assert(!this.#destroyed);
        this.#video = await new Promise<VideoStatus>((resolve, reject) => {
            let channel = createChannel('openVideoSampler', {
                videoStatus: (data) => resolve(data)
            }, reject);
            invoke('open_video_sampler', {id: this.id, videoId, accel, channel});
        });
        return this.#video;
    }

    async status() {
        Debug.assert(!this.#destroyed);
        return await new Promise<{
            audioIndex: number,
            videoIndex: number
        }>((resolve, reject) => {
            let channel = createChannel('status', {
                mediaStatus: (data) => resolve(data)
            }, reject);
            invoke('media_status', {id: this.id, channel});
        });
    }

    async setVideoSize(width: number, height: number) {
        Debug.assert(!this.#destroyed);
        Debug.assert(this.#video !== undefined);
        width = Math.max(1, Math.round(width));
        height = Math.max(1, Math.round(height));
        await new Promise<void>((resolve, reject) => {
            let channel = createChannel('setVideoSize', {
                done: () => resolve()
            }, reject);
            invoke('video_set_size', {id: this.id, channel, width, height});
        });
        this.#outSize = [width, height];
    }

    /** returns null on EOF */
    async readNextFrame() {
        Debug.assert(!this.#destroyed);
        Debug.assert(this.#currentJobs == 0);
        let channel: Channel<MediaEvent> | undefined;
        this.#currentJobs += 1;
        try {
            return await new Promise<VideoFrameData | AudioFrameData | null>((resolve, reject) => {
                channel = createChannel('readNextFrame', { 
                    'EOF': () => {
                        Debug.debug('at eof');
                        this.#eof = true;
                        resolve(null);
                    }
                }, reject);
                invoke<ArrayBuffer>('get_next_frame_data', { id: this.id, channel })
                    .then((x) => {
                        if (x.byteLength > 0)
                            resolve(this.#readFrameData(x))
                    });
            });
        } finally {
            this.#currentJobs -= 1;
        }
    }

    /** returns null on EOF */
    async sampleAutomatic2(targetWorkingTimeMs: number) {
        Debug.assert(!this.#destroyed);
        Debug.assert(this.#currentJobs == 0);
        let channel: Channel<MediaEvent> | undefined;
        this.#currentJobs += 1;
        try {
            return await new Promise<SampleResult>((resolve, reject) => {
                channel = createChannel('sampleAutomatic', {
                    sampleDone2: (data) => resolve(data)
                }, reject);
                invoke('sample_automatic2', { id: this.id, targetWorkingTimeMs, channel });
            });
        } finally {
            this.#currentJobs -= 1;
        }
    }

    async seekAudio(position: number) {
        Debug.assert(!this.#destroyed);
        Debug.assert(this.#currentJobs == 0);
        let channel: Channel<MediaEvent> | undefined;
        this.#currentJobs += 1;
        try {
            return await new Promise<void>((resolve, reject) => {
                channel = createChannel('seekAudio', {
                    done: () => resolve()
                }, reject);
                invoke('seek_audio', { id: this.id, channel, position });
            });
        } finally {
            this.#currentJobs -= 1;
        }
    }

    async seekVideo(position: number) {
        Debug.assert(!this.#destroyed);
        Debug.assert(this.#currentJobs == 0);
        let channel: Channel<MediaEvent> | undefined;
        this.#currentJobs += 1;
        try {
            return await new Promise<void>((resolve, reject) => {
                channel = createChannel('seekVideo', {
                    done: () => resolve()
                }, reject);
                invoke('seek_video', { id: this.id, channel, position });
            });
        } finally {
            this.#currentJobs -= 1;
        }
    }

    async skipUntil(videoPosition: number, audioPosition: number) {
        Debug.assert(!this.#destroyed);
        Debug.assert(this.#currentJobs == 0);
        let channel: Channel<MediaEvent> | undefined;
        this.#currentJobs += 1;
        try {
            return await new Promise<VideoFrameData | AudioFrameData | null>((resolve, reject) => {
                channel = createChannel('skipUntilVideoFrame', { 
                    'EOF': () => {
                        Debug.debug('at eof');
                        this.#eof = true;
                        resolve(null);
                    }
                }, reject);
                invoke<ArrayBuffer>('skip_until', { 
                    id: this.id, videoPosition, audioPosition, channel 
                }).then((x) => {
                    if (x.byteLength > 0)
                        resolve(this.#readFrameData(x))
                });
            });
        } finally {
            this.#currentJobs -= 1;
        }
    }

    async getKeyframeBefore(pos: number) {
        Debug.assert(!this.#destroyed);
        let channel: Channel<MediaEvent> | undefined;
        return await new Promise<number | null>((resolve, reject) => {
            channel = createChannel('getKeyframeBefore', {
                keyframeData: (data) => resolve(data.pos)
            }, reject);
            invoke('get_keyframe_before', { id: this.id, channel, pos });
        });
    }

    async getAudioSamplerData(level: number, from: number, to: number) {
        Debug.assert(!this.#destroyed);
        // await Debug.trace('getAudioSamplerData', level, from, to);
        return await new Promise<Float32Array>((resolve, reject) => {
            let channel = createChannel('getAudioSamplerData', {}, reject);
            invoke<ArrayBuffer>('get_audio_sampler_data', {id: this.id, channel, level, from, to})
                .then((x) => {
                    if (x.byteLength > 0)
                        resolve(this.#readFloatArrayData(x))
                });
        });
    }

    async getVideoSamplerData(level: number, from: number, to: number) {
        Debug.assert(!this.#destroyed);
        // await Debug.trace('getVideoSamplerData', level, from, to);
        return await new Promise<Uint8Array>((resolve, reject) => {
            let channel = createChannel('getVideoSamplerData', {}, reject);
            invoke<ArrayBuffer>('get_video_sampler_data', {id: this.id, channel, level, from, to})
                .then((x) => {
                    if (x.byteLength > 0)
                        resolve(this.#readByteArrayData(x))
                });
        });
    }
}

export const MAPI = {
    async version() {
        return await new Promise<string>((resolve, reject) => {
            let channel = createChannel('version', {
                ffmpegVersion: (data) => resolve(data.value)
            }, reject);
            invoke('media_version', {channel});
        });
    },

    async config() {
        return await invoke<string>('media_config', {});
    },

    async testPerformance(path: string, postprocess: boolean, hwaccel: boolean) {
        return await new Promise<void>((resolve, reject) => {
            let channel = createChannel('test_performance', {
                done: () => resolve()
            }, reject, -1);
            invoke('test_performance', {path, postprocess, hwaccel, channel});
        });
    },

    async decodeFile(path: string, encoding: string | null) {
        const { type, data } = await invoke<{ type: 'ok' | 'error', data: string }>(
            'decode_file_as', { path, encoding });
        if (type == 'error') throw new Error(`decode_file_as: ${data}`);
        return data;
    },

    async detectOrDecodeFile(path: string) {
        const result = await invoke<{ 
            type: 'normal' | 'error', data: string 
        } | { type: 'strange' }>(
            'decode_or_detect_file', { path });
        if (result.type == 'error') throw new Error(`decode_or_detect_file: ${result.data}`);
        if (result.type == 'strange') return null;
        return result.data;
    },

    async openDevtools() {
        await invoke<void>('open_devtools');
    }
};