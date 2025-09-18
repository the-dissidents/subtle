import { invoke, Channel } from '@tauri-apps/api/core';
import { Debug } from './Debug';
import { BinaryReader } from './details/BinaryReader';
import type { MediaEvent } from './bindings/MediaEvent';
import type { StreamDescription } from './bindings/StreamDescription';

export class MediaError extends Error {
    constructor(msg: string, public readonly from: string) {
        super(`${msg} (${from})`);
        this.name = 'MediaError';
    }
}

type MediaEventKey = MediaEvent['event'];
type MediaEventData = {[E in MediaEvent as E['event']]: E['data']};
type MediaEventHandler<key extends MediaEventKey> = (data: MediaEventData[key]) => void;

export type VideoStatus = MediaEventData['videoStatus'];
export type AudioStatus = MediaEventData['audioStatus'];
export type SampleResult = MediaEventData['sampleDone2'];

function createChannel(
    from: string, handler: {[key in MediaEventKey]?: MediaEventHandler<key>}, 
    reject: (e: unknown) => void, timeout = 2000
) {
    if (timeout > 0) setTimeout(
        () => reject(new MediaError(`timed out [${timeout}ms]`, from)), timeout);
    
    const channel = new Channel<MediaEvent>;
    channel.onmessage = (msg) => {
        const h = handler[msg.event];
        if (h) {
            h(msg.data as never);
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
    pktpos: number,
    time: number,
    stride: number,
    length: number,
    size: [width: number, height: number],
    content: ImageDataArray
};

export type AudioFrameData = {
    pktpos: number,
    time: number,
    length: number,
    content: Float32Array
};

export type DecodeResult = {
    video: VideoFrameData[],
    audio: AudioFrameData[]
}

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

    get streams(): readonly StreamDescription[] {
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
        private _streams: StreamDescription[]
    ) {
        Debug.info(`media ${id} opened`);
    }

    #readFrames(data: ArrayBuffer): DecodeResult {
        const view = new BinaryReader(data);
        const nA = view.readU32();
        const audio: AudioFrameData[] = [];
        for (let i = 0; i < nA; i++)
            audio.push(this.#readAudioFrame(view));

        const nV = view.readU32();
        const video: VideoFrameData[] = [];
        for (let i = 0; i < nV; i++)
            video.push(this.#readVideoFrame(view));

        return { audio, video };
    }

    #readAudioFrame(view: BinaryReader<ArrayBuffer>): AudioFrameData {
        const time = view.readF64();
        const pktpos = view.readI64();
        const length = view.readU32();
        const content = view.readF32Array(length);
        return { pktpos, time, length, content };
    }

    #readVideoFrame(view: BinaryReader<ArrayBuffer>): VideoFrameData {
        const time = view.readF64();
        const pktpos = view.readI64();
        const stride = view.readU32();
        const length = view.readU32();
        const content = view.readU8ClampedArray(length);
        return { pktpos, time, stride, length, content, size: [...this.#outSize] };
    }

    static async open(path: string) {
        const id = await new Promise<number>((resolve, reject) => {
            const channel = createChannel('open', {
                opened: (data) => resolve(data.id)
            }, reject);
            invoke('open_media', {path, channel});
        });
        const status = await new Promise<{
            audioIndex: number,
            videoIndex: number,
            duration: number,
            streams: StreamDescription[]
        }>((resolve, reject) => {
            const channel = createChannel('open/status', {
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
            const channel = createChannel('close', {
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
            const channel = createChannel('openAudio', {
                audioStatus: (data) => resolve(data)
            }, reject);
            invoke('open_audio', {id: this.id, audioId, channel});
        });
        return this.#audio;
    }

    async openAudioSampler(audioId: number, samplePerSecond: number) {
        Debug.assert(!this.#destroyed);
        this.#audio = await new Promise<AudioStatus>((resolve, reject) => {
            const channel = createChannel('openAudioSampler', {
                audioStatus: (data) => resolve(data)
            }, reject);
            invoke('open_audio_sampler', {id: this.id, audioId, samplePerSecond, channel});
        });
        return this.#audio;
    }

    async openVideo(videoId: number, accel: boolean) {
        Debug.assert(!this.#destroyed);
        this.#video = await new Promise<VideoStatus>((resolve, reject) => {
            const channel = createChannel('openVideo', {
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
            const channel = createChannel('openVideoSampler', {
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
            const channel = createChannel('status', {
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
            const channel = createChannel('setVideoSize', {
                done: () => resolve()
            }, reject);
            invoke('video_set_size', {id: this.id, channel, width, height});
        });
        this.#outSize = [width, height];
    }

    async sampleAutomatic3(targetWorkingTimeMs: number) {
        Debug.assert(!this.#destroyed);
        Debug.assert(this.#currentJobs == 0);
        let channel: Channel<MediaEvent> | undefined;
        this.#currentJobs += 1;
        try {
            return await new Promise<SampleResult>((resolve, reject) => {
                channel = createChannel('sampleAutomatic3', {
                    sampleDone2: (data) => resolve(data)
                }, reject);
                invoke('sample_automatic3', { id: this.id, targetWorkingTimeMs, channel });
            });
        } finally {
            this.#currentJobs -= 1;
        }
    }

    async decodeAutomatic(targetWorkingTimeMs: number) {
        Debug.assert(!this.#destroyed);
        Debug.assert(this.#currentJobs == 0);
        let channel: Channel<MediaEvent> | undefined;
        this.#currentJobs += 1;
        try {
            const result = await new Promise<ArrayBuffer>((resolve, reject) => {
                channel = createChannel('decodeAutomatic', {}, reject);
                invoke<ArrayBuffer>('get_frames_automatic', { 
                    id: this.id, targetWorkingTimeMs, channel 
                }).then(resolve);
            });
            const frames = this.#readFrames(result);
            return frames;
        } finally {
            this.#currentJobs -= 1;
        }
    }

    async seek(time: number) {
        Debug.assert(!this.#destroyed);
        Debug.assert(this.#currentJobs == 0);
        let channel: Channel<MediaEvent> | undefined;
        this.#currentJobs += 1;
        try {
            return await new Promise<void>((resolve, reject) => {
                channel = createChannel('seek', {
                    done: () => resolve()
                }, reject);
                invoke('seek_media', { id: this.id, channel, time });
            });
        } finally {
            this.#currentJobs -= 1;
        }
    }

    async seekByte(pos: number) {
        Debug.assert(!this.#destroyed);
        Debug.assert(this.#currentJobs == 0);
        let channel: Channel<MediaEvent> | undefined;
        this.#currentJobs += 1;
        try {
            return await new Promise<void>((resolve, reject) => {
                channel = createChannel('seekByte', {
                    done: () => resolve()
                }, reject);
                invoke('seek_media_byte', { id: this.id, channel, pos });
            });
        } finally {
            this.#currentJobs -= 1;
        }
    }

    async seekAudio(time: number) {
        Debug.assert(!this.#destroyed);
        Debug.assert(this.#currentJobs == 0);
        let channel: Channel<MediaEvent> | undefined;
        this.#currentJobs += 1;
        try {
            return await new Promise<void>((resolve, reject) => {
                channel = createChannel('seekAudio', {
                    done: () => resolve()
                }, reject);
                invoke('seek_audio', { id: this.id, channel, time });
            });
        } finally {
            this.#currentJobs -= 1;
        }
    }

    async seekVideo(time: number) {
        Debug.assert(!this.#destroyed);
        Debug.assert(this.#currentJobs == 0);
        let channel: Channel<MediaEvent> | undefined;
        this.#currentJobs += 1;
        try {
            return await new Promise<void>((resolve, reject) => {
                channel = createChannel('seekVideo', {
                    done: () => resolve()
                }, reject);
                invoke('seek_video', { id: this.id, channel, time });
            });
        } finally {
            this.#currentJobs -= 1;
        }
    }

    async skipUntil(time: number) {
        Debug.assert(!this.#destroyed);
        Debug.assert(this.#currentJobs == 0);
        let channel: Channel<MediaEvent> | undefined;
        this.#currentJobs += 1;
        try {
            return await new Promise<DecodeResult>((resolve, reject) => {
                channel = createChannel('skipUntil', {}, reject);
                invoke<ArrayBuffer>('skip_until', { 
                    id: this.id, time, channel 
                }).then((x) => {
                    if (x.byteLength > 0)
                        resolve(this.#readFrames(x));
                });
            });
        } finally {
            this.#currentJobs -= 1;
        }
    }

    async getKeyframeBefore(time: number) {
        Debug.assert(!this.#destroyed);
        let channel: Channel<MediaEvent> | undefined;
        return await new Promise<MediaEventData['frameQueryResult'] | null>((resolve, reject) => {
            channel = createChannel('getKeyframeBefore', {
                frameQueryResult: (data) => resolve(data),
                noResult: () => resolve(null)
            }, reject);
            invoke('get_keyframe_before', { id: this.id, channel, time });
        });
    }

    async getFrameBefore(time: number) {
        Debug.assert(!this.#destroyed);
        let channel: Channel<MediaEvent> | undefined;
        return await new Promise<MediaEventData['frameQueryResult'] | null>((resolve, reject) => {
            channel = createChannel('getKeyframeBefore', {
                frameQueryResult: (data) => resolve(data),
                noResult: () => resolve(null)
            }, reject);
            invoke('get_frame_before', { id: this.id, channel, time });
        });
    }
}

export type FontStyle = 'normal' | 'italic' | 'oblique';

export type ResolvedFontFamily = {
    faces: ResolvedFontFace[],
    familyName: string
};

export type ResolvedFontFace = {
    url: string,
    postscriptName: string,
    real_height: number,
    weight: number,
    stretch: number,
    style: FontStyle,
};

export const MAPI = {
    async version() {
        return await new Promise<string>((resolve, reject) => {
            const channel = createChannel('version', {
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
            const channel = createChannel('test_performance', {
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
    },

    async resolveFontFamily(name: string) {
        return await invoke<ResolvedFontFamily | null>('resolve_family_name', { name });
    }
};