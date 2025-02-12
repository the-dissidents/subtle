import { invoke, Channel } from '@tauri-apps/api/core';
import { assert } from './Basic';

type MediaEvent = {
    event: 'done'
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
    constructor(msg: string) {
        super(msg);
        this.name = 'MediaError';
    }
}

type MediaEventKey = MediaEvent['event'];
type MediaEventData = {[E in MediaEvent as E['event']]: E['data']};
type MediaEventHandler<key extends MediaEventKey> = (data: MediaEventData[key]) => void;

function createChannel(handler: {[key in MediaEventKey]?: MediaEventHandler<key>}) {
    const channel = new Channel<MediaEvent>;
    channel.onmessage = (msg) => {
        let h = handler[msg.event];
        // 'as any' because a little quirk in TypeScript's inference system
        // a functor of type (A | B) => C obviously accepts A | B as the parameter
        // however, (A => C) | (B => C) will not accept it
        if (h) {
            h(msg.data as any);
            return;
        }

        switch (msg.event) {
        case 'debug':
            console.log(msg.data.message);
            break;
        case 'runtimeError':
            throw new MediaError(msg.data.what);
        case 'invalidId':
            throw new MediaError('invalid media ID referenced');
        default:
            throw new Error('unhandled event: ' + msg.event);
        }
    }
    return channel;
}

export type VideoFrameData = {
    position: number,
    time: number,
    stride: number,
    content: Uint8ClampedArray
}

export type AudioFrameData = {
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
    #currentJobs = 0;

    get streams(): readonly string[] {
        return this._streams;
    }

    get duration() {
        return this._duration;
    }

    get videoSize() {
        return [this.#width, this.#height];
    }

    get videoOutputSize() {
        return [this.#outWidth, this.#outHeight];
    }

    get hasJob() {
        assert(this.#currentJobs >= 0);
        return this.#currentJobs != 0;
    }

    private constructor(
        private id: number,
        private _duration: number,
        private _streams: string[]
    ) { }

    #readVideoData(data: ArrayBuffer) {
        const view = new DataView(data);
        const position = Number(view.getBigInt64(0, true));
        const time = view.getFloat64(8, true);
        const stride = Number(view.getBigUint64(16, true));
        const length = Number(view.getBigUint64(24, true));
        const content = new Uint8ClampedArray(data, 32, length);

        const struct: VideoFrameData = { position, time, stride, content };
        return struct;
    }

    #readAudioData(data: ArrayBuffer) {
        const view = new DataView(data);
        const position = Number(view.getBigInt64(0, true));
        const time = view.getFloat64(8, true);
        const length = Number(view.getBigUint64(16, true));
        const content = new Float32Array(data, 24, length);

        const struct: AudioFrameData = { position, time, content };
        return struct;
    }

    static async open(path: string) {
        // await IPC.init();
        const id = await new Promise<number>((resolve, reject) => {
            let channel = createChannel({
                opened: (data) => resolve(data.id)
            });
            invoke('open_media', {path, channel});
        });
        const status = await new Promise<{
            audioIndex: number,
            videoIndex: number,
            duration: number,
            streams: string[]
        }>((resolve, reject) => {
            let channel = createChannel({
                mediaStatus: (data) => resolve(data)
            });
            invoke('media_status', {id: id, channel});
        });
        return new MMedia(id, status.duration, status.streams);
    }

    get isClosed() {
        return this.#destroyed;
    }

    async close() {
        assert(!this.#destroyed);
        await new Promise<void>((resolve, reject) => {
            let channel = createChannel({
                done: () => {
                    this.#destroyed = true;
                    // IPC.deleteListeners(this);
                    resolve();
                }
            });
            invoke('close_media', {id: this.id, channel});
        });
    }

    async openAudio(audioId: number) {
        assert(!this.#destroyed);
        await new Promise<void>((resolve, reject) => {
            let channel = createChannel({
                done: () => resolve()
            });
            invoke('open_audio', {id: this.id, audioId, channel});
        });
    }

    async openVideo(videoId: number) {
        assert(!this.#destroyed);
        await new Promise<void>((resolve, reject) => {
            let channel = createChannel({
                done: () => resolve()
            });
            invoke('open_video', {id: this.id, videoId, channel});
        });
        let status = await this.videoStatus();
        assert(status !== null);
    }

    async status() {
        assert(!this.#destroyed);
        return await new Promise<{
            audioIndex: number,
            videoIndex: number
        }>((resolve, reject) => {
            let channel = createChannel({
                mediaStatus: (data) => resolve(data)
            });
            invoke('media_status', {id: this.id, channel});
        });
    }

    async audioStatus() {
        assert(!this.#destroyed);
        return await new Promise<{
            sampleRate: number,
            length: number
        } | null>((resolve, reject) => {
            let channel = createChannel({
                audioStatus: (data) => resolve(data),
                noStream: () => resolve(null)
            });
            invoke('audio_status', {id: this.id, channel});
        });
    }

    async videoStatus() {
        assert(!this.#destroyed);
        let status = await new Promise<{
            length: number,
            framerate: number,
            width: number, height: number,
            outWidth: number, outHeight: number
        } | null>((resolve, reject) => {
            let channel = createChannel({
                videoStatus: (data) => resolve(data),
                noStream: () => resolve(null)
            });
            invoke('video_status', {id: this.id, channel});
        });
        if (status) {
            this.#width = status.width;
            this.#outWidth = status.outWidth;
            this.#height = status.height;
            this.#outHeight = status.outHeight;
        }
        return status;
    }

    async setVideoSize(width: number, height: number) {
        assert(!this.#destroyed);
        width = Math.max(1, Math.floor(width));
        height = Math.max(1, Math.floor(height));
        await new Promise<void>((resolve, reject) => {
            let channel = createChannel({
                done: () => resolve()
            });
            invoke('video_set_size', {id: this.id, channel, width, height});
        });
        this.#outWidth = width;
        this.#outHeight = height;
    }

    async videoPosition() {
        assert(!this.#destroyed);
        try {
            return await new Promise<number>((resolve, reject) => {
                this.#currentJobs += 1;
                let channel = createChannel({
                    position: (data_1) => resolve(data_1.value)
                });
                invoke('get_current_video_position', { id: this.id, channel });
            });
        } finally {
            this.#currentJobs -= 1;
        }
    }
    
    async audioPosition() {
        assert(!this.#destroyed);
        try {
            return await new Promise<number>((resolve, reject) => {
                this.#currentJobs += 1;
                let channel = createChannel({
                    position: (data_1) => resolve(data_1.value)
                });
                invoke('get_current_audio_position', { id: this.id, channel });
            });
        } finally {
            this.#currentJobs -= 1;
        }
    }

    async moveToNextVideoFrame() {
        assert(!this.#destroyed);
        try {
            return await new Promise<number>((resolve, reject) => {
                this.#currentJobs += 1;
                let channel = createChannel({
                    position: (data_1) => resolve(data_1.value)
                });
                invoke('move_to_next_video_frame', { id: this.id, channel });
            });
        } finally {
            this.#currentJobs -= 1;
        }
    }

    async moveToNextAudioFrame() {
        assert(!this.#destroyed);
        try {
            return await new Promise<number>((resolve, reject) => {
                this.#currentJobs += 1;
                let channel = createChannel({
                    position: (data_1) => resolve(data_1.value)
                });
                invoke('move_to_next_audio_frame', { id: this.id, channel });
            });
        } finally {
            this.#currentJobs -= 1;
        }
    }

    async pollAudioFrame() {
        assert(!this.#destroyed);
        try {
            return await new Promise<number>((resolve, reject) => {
                this.#currentJobs += 1;
                let channel = createChannel({
                    position: (data_1) => resolve(data_1.value)
                });
                invoke('poll_next_audio_frame', { id: this.id, channel });
            });
        } finally {
            this.#currentJobs -= 1;
        }
    }

    async readCurrentVideoFrame() {
        assert(!this.#destroyed);
        try {
            return await new Promise<VideoFrameData>((resolve, reject) => {
                this.#currentJobs += 1;
                let channel = createChannel({});
                invoke<ArrayBuffer>('send_current_video_frame', { id: this.id, channel }).then((x) => {
                    resolve(this.#readVideoData(x));
                });
            });
        } finally {
            this.#currentJobs -= 1;
        }
    }

    async readCurrentAudioFrame() {
        assert(!this.#destroyed);
        try {
            return await new Promise<AudioFrameData>((resolve, reject) => {
                this.#currentJobs += 1;
                let channel = createChannel({});
                invoke<ArrayBuffer>('send_current_audio_frame', { id: this.id, channel }).then((x) => {
                    resolve(this.#readAudioData(x));
                });
            });
        } finally {
            this.#currentJobs -= 1;
        }
    }

    async seekAudio(position: number) {
        assert(!this.#destroyed);
        try {
            return await new Promise<void>((resolve, reject) => {
                this.#currentJobs += 1;
                let channel = createChannel({
                    done: () => resolve()
                });
                invoke('seek_audio', { id: this.id, channel, position });
            });
        } finally {
            this.#currentJobs -= 1;
        }
    }

    async seekVideo(position: number) {
        assert(!this.#destroyed);
        try {
            return await new Promise<void>((resolve, reject) => {
                this.#currentJobs += 1;
                let channel = createChannel({
                    done: () => resolve()
                });
                invoke('seek_video', { id: this.id, channel, position });
            });
        } finally {
            this.#currentJobs -= 1;
        }
    }

    async getIntensities(until: number, step: number) {
        assert(!this.#destroyed);
        return await new Promise<{
            start: number,
            end: number,
            data: number[]
        }>((resolve, reject) => {
            let channel = createChannel({
                intensityList: (data) => resolve(data),
            });
            invoke('get_intensities', {id: this.id, channel, until, step});
        });
    }
}

export const MAPI = {
    async version() {
        return await new Promise<string>((resolve, reject) => {
            let channel = createChannel({
                ffmpegVersion: (data) => resolve(data.value)
            });
            invoke('media_version', {channel});
        });
    },

    async testResponse() {
        console.log(await invoke('test_response', {}));
    }
}


