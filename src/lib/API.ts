import { invoke, Channel } from '@tauri-apps/api/core';
import { Debug } from './Debug';

type MediaEvent = {
    event: 'done'
    data: {}
} | {
    event: 'EOF'
    data: {}
} | {
    event: 'opened'
    data: {
        id: number
    }
} | {
    event: 'mediaStatus',
    data: {
        audioIndex: number,
        videoIndex: number,
        duration: number,
        streams: string[]
    }
} | {
    event: 'audioStatus',
    data: {
        length: number,
        sampleRate: number
    }
} | {
    event: 'videoStatus',
    data: {
        length: number,
        framerate: number,
        sampleAspectRatio: number,
        width: number, height: number,
        outWidth: number, outHeight: number
    }
} | {
    event: 'intensityList',
    data: {
        start: number,
        end: number,
        data: number[]
    }
} | {
    event: 'debug',
    data: {
        message: string
    }
} | {
    event: 'runtimeError',
    data: {
        what: string
    }
} | {
    event: 'position',
    data: {
        value: number
    }
} | {
    event: 'noStream',
    data: {}
} | {
    event: 'invalidId',
    data: {}
} | {
    event: 'ffmpegVersion',
    data: {
        value: string
    }
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
    reject: (e: any) => void
) {
    setTimeout(() => reject(new MediaError('timed out', from)), 1000);
    
    const channel = new Channel<MediaEvent>;
    channel.onmessage = (msg) => {
        let h = handler[msg.event];
        // console.log('received message:', msg);
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
    content: Uint8ClampedArray
}

export type AudioFrameData = {
    type: 'audio',
    position: number,
    time: number,
    content: Float32Array
}

export class MMedia {
    #destroyed = false;
    #width: number = -1;
    #height: number = -1;
    #outWidth: number = -1;
    #outHeight: number = -1;
    #SAR: number = 1;
    #currentJobs = 0;
    // #_finalizationReg = new FinalizationRegistry((x) => {
    //     Debug.debug('finalizing:', x);
    // });

    get streams(): readonly string[] {
        return this._streams;
    }

    get duration() {
        return this._duration;
    }

    get videoSize(): [number, number] {
        return [this.#width, this.#height];
    }

    get videoOutputSize() {
        return [this.#outWidth, this.#outHeight];
    }

    get sampleAspectRatio() {
        return this.#SAR;
    }

    get hasJob() {
        Debug.assert(this.#currentJobs >= 0);
        return this.#currentJobs != 0;
    }

    private constructor(
        private id: number,
        private _duration: number,
        private _streams: string[]
    ) {
        Debug.info(`media ${id} opened`);
    }

    #readData(data: ArrayBuffer): AudioFrameData | VideoFrameData {
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
            return { type, position, time, stride, content } satisfies VideoFrameData;
        }
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
            streams: string[]
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
            setTimeout(() => reject(new MediaError('timed out', 'waitUntilAvailable')), 1000);
            const wait = () => {
                if (!this.hasJob) resolve();
                else setTimeout(wait, 1);
            };
            wait();
        });
    }

    async openAudio(audioId: number) {
        Debug.assert(!this.#destroyed);
        await new Promise<void>((resolve, reject) => {
            let channel = createChannel('openAudio', {
                done: () => resolve()
            }, reject);
            invoke('open_audio', {id: this.id, audioId, channel});
        });
    }

    async openVideo(videoId: number) {
        Debug.assert(!this.#destroyed);
        await new Promise<void>((resolve, reject) => {
            let channel = createChannel('openVideo', {
                done: () => resolve()
            }, reject);
            invoke('open_video', {id: this.id, videoId, channel});
        });
        let status = await this.videoStatus();
        Debug.assert(status !== null);
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

    async audioStatus() {
        Debug.assert(!this.#destroyed);
        return await new Promise<{
            sampleRate: number,
            length: number
        } | null>((resolve, reject) => {
            let channel = createChannel('audioStatus', {
                audioStatus: (data) => resolve(data),
                noStream: () => resolve(null)
            }, reject);
            invoke('audio_status', {id: this.id, channel});
        });
    }

    async videoStatus() {
        Debug.assert(!this.#destroyed);
        let status = await new Promise<{
            length: number,
            framerate: number,
            sampleAspectRatio: number,
            width: number, height: number,
            outWidth: number, outHeight: number
        } | null>((resolve, reject) => {
            let channel = createChannel('videoStatus', {
                videoStatus: (data) => resolve(data),
                noStream: () => resolve(null)
            }, reject);
            invoke('video_status', {id: this.id, channel});
        });
        if (status) {
            this.#width = status.width;
            this.#outWidth = status.outWidth;
            this.#height = status.height;
            this.#outHeight = status.outHeight;
            this.#SAR = status.sampleAspectRatio;
        }
        return status;
    }

    async setVideoSize(width: number, height: number) {
        Debug.assert(!this.#destroyed);
        width = Math.max(1, Math.floor(width));
        height = Math.max(1, Math.floor(height));
        await new Promise<void>((resolve, reject) => {
            let channel = createChannel('setVideoSize', {
                done: () => resolve()
            }, reject);
            invoke('video_set_size', {id: this.id, channel, width, height});
        });
        this.#outWidth = width;
        this.#outHeight = height;
    }

    async readNextFrame() {
        Debug.assert(!this.#destroyed);
        Debug.assert(this.#currentJobs == 0);
        let channel: Channel<MediaEvent> | undefined;
        try {
            return await new Promise<VideoFrameData | AudioFrameData | null>((resolve, reject) => {
                this.#currentJobs += 1;
                channel = createChannel('readNextFrame', { 'EOF': () => {
                    Debug.debug('at eof');
                    resolve(null);
                }}, reject);
                invoke<ArrayBuffer>('get_next_frame_data', { id: this.id, channel })
                    .then((x) => {
                        if (x.byteLength > 0)
                            resolve(this.#readData(x))
                    });
            });
        } finally {
            this.#currentJobs -= 1;
        }
    }

    async seekAudio(position: number) {
        Debug.assert(!this.#destroyed);
        Debug.assert(this.#currentJobs == 0);
        let channel: Channel<MediaEvent> | undefined;
        try {
            return await new Promise<void>((resolve, reject) => {
                this.#currentJobs += 1;
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
        try {
            return await new Promise<void>((resolve, reject) => {
                this.#currentJobs += 1;
                channel = createChannel('seekVideo', {
                    done: () => resolve()
                }, reject);
                invoke('seek_video', { id: this.id, channel, position });
            });
        } finally {
            this.#currentJobs -= 1;
        }
    }

    async seekVideoPrecise(position: number) {
        Debug.assert(!this.#destroyed);
        Debug.assert(this.#currentJobs == 0);
        let channel: Channel<MediaEvent> | undefined;
        try {
            return await new Promise<AudioFrameData | VideoFrameData | null>((resolve, reject) => {
                this.#currentJobs += 1;
                channel = createChannel('seekVideoPrecise', {
                    'EOF': () => resolve(null),
                }, reject);
                invoke<ArrayBuffer>('seek_precise_and_get_frame', 
                        { id: this.id, channel, position })
                    .then((x) => {
                        if (x.byteLength > 0)
                            resolve(this.#readData(x))
                    });
            });
        } finally {
            this.#currentJobs -= 1;
        }
    }

    async getIntensities(until: number, step: number) {
        Debug.assert(!this.#destroyed);
        Debug.assert(this.#currentJobs == 0);
        return await new Promise<{
            start: number,
            end: number,
            data: number[]
        }>((resolve, reject) => {
            let channel = createChannel('getIntensities', {
                intensityList: (data) => resolve(data),
            }, reject);
            invoke('get_intensities', {id: this.id, channel, until, step});
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
}


