import { invoke, Channel } from '@tauri-apps/api/core';
import { assert } from './Basic';

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
        // console.log('received message:', msg);
        // 'as any' because (A => C) | (B => C) will not accept A | B as the parameter
        if (h) {
            h(msg.data as any);
            return;
        }

        switch (msg.event) {
        case 'debug':
            console.log(msg.data.message);
            break;
        case 'runtimeError':
            throw new MediaError('runtimeError: ' + msg.data.what);
        case 'invalidId':
            throw new MediaError('invalid media ID referenced');
        default:
            throw new Error('unhandled event: ' + msg.event);
        }
    }
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

    #readData(data: ArrayBuffer): AudioFrameData | VideoFrameData {
        const view = new DataView(data);
        const type = view.getUint32(0, true) == 0 ? 'audio' : 'video';
        const position = view.getInt32(4, true);
        const time = view.getFloat64(8, true);
        if (type == 'audio') {
            const length = view.getUint32(16, true);
            const content = new Float32Array(data, 20, length);
            return { type, position, time, content } satisfies AudioFrameData;
        } else {
            const stride = view.getUint32(16, true);
            const length = view.getUint32(20, true);
            const content = new Uint8ClampedArray(data, 24, length);
            return { type, position, time, stride, content } satisfies VideoFrameData;
        }
    }

    static async open(path: string) {
        const id = await new Promise<number>((resolve, reject) => {
            setTimeout(() => reject(new MediaError('timed out')), 2000);
            let channel = createChannel({
                opened: (data) => resolve(data.id)
            });
            invoke('open_media', {path, channel});
        });
        console.log('opened; calling status');
        const status = await new Promise<{
            audioIndex: number,
            videoIndex: number,
            duration: number,
            streams: string[]
        }>((resolve, reject) => {
            setTimeout(() => reject(new MediaError('timed out')), 1000);
            let channel = createChannel({
                mediaStatus: (data) => resolve(data)
            });
            invoke('media_status', {id, channel});
        });
        return new MMedia(id, status.duration, status.streams);
    }

    get isClosed() {
        return this.#destroyed;
    }

    async close() {
        assert(!this.#destroyed);
        await new Promise<void>((resolve, reject) => {
            setTimeout(() => reject(new MediaError('timed out')), 1000);
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
    
    async waitUntilAvailable() {
        return await new Promise<void>((resolve, reject) => {
            setTimeout(() => reject(new MediaError('timed out')), 1000);
            const wait = () => {
                if (!this.hasJob) resolve();
                else setTimeout(wait, 1);
            };
            wait();
        });
    }

    async openAudio(audioId: number) {
        assert(!this.#destroyed);
        await new Promise<void>((resolve, reject) => {
            setTimeout(() => reject(new MediaError('timed out')), 1000);
            let channel = createChannel({
                done: () => resolve()
            });
            invoke('open_audio', {id: this.id, audioId, channel});
        });
    }

    async openVideo(videoId: number) {
        assert(!this.#destroyed);
        await new Promise<void>((resolve, reject) => {
            setTimeout(() => reject(new MediaError('timed out')), 1000);
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
            setTimeout(() => reject(new MediaError('timed out')), 1000);
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
            setTimeout(() => reject(new MediaError('timed out')), 1000);
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
            setTimeout(() => reject(new MediaError('timed out')), 1000);
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
            setTimeout(() => reject(new MediaError('timed out')), 1000);
            let channel = createChannel({
                done: () => resolve()
            });
            invoke('video_set_size', {id: this.id, channel, width, height});
        });
        this.#outWidth = width;
        this.#outHeight = height;
    }

    async readNextFrame() {
        assert(!this.#destroyed);
        assert(this.#currentJobs == 0);
        try {
            return await new Promise<VideoFrameData | AudioFrameData | null>((resolve, reject) => {
                setTimeout(() => reject(new MediaError('timed out')), 1000);
                this.#currentJobs += 1;
                let channel = createChannel({ 'EOF': () => {
                    console.log('at eof');
                    resolve(null);
                } });
                invoke<ArrayBuffer>('get_next_frame_data', { id: this.id, channel })
                    .then((x) => resolve(this.#readData(x)))
                    .catch(() => {});
                // errors are handled in the channel; the backend returning Err(()) is just a way
                // to not return any data
            });
        } finally {
            this.#currentJobs -= 1;
        }
    }

    async seekAudio(position: number) {
        assert(!this.#destroyed);
        assert(this.#currentJobs == 0);
        try {
            return await new Promise<void>((resolve, reject) => {
                setTimeout(() => reject(new MediaError('timed out')), 1000);
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
        assert(this.#currentJobs == 0);
        try {
            return await new Promise<void>((resolve, reject) => {
                setTimeout(() => reject(new MediaError('timed out')), 1000);
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

    async seekVideoPrecise(position: number) {
        assert(!this.#destroyed);
        assert(this.#currentJobs == 0);
        try {
            return await new Promise<AudioFrameData | VideoFrameData | null>((resolve, reject) => {
                setTimeout(() => reject(new MediaError('timed out')), 1000);
                this.#currentJobs += 1;
                let channel = createChannel({
                    'EOF': () => resolve(null),
                });
                invoke<ArrayBuffer>('seek_precise_and_get_frame', 
                        { id: this.id, channel, position })
                    .then((x) => resolve(this.#readData(x)))
                    .catch(() => {});
                // see line 336
            });
        } finally {
            this.#currentJobs -= 1;
        }
    }

    async getIntensities(until: number, step: number) {
        assert(!this.#destroyed);
        assert(this.#currentJobs == 0);
        return await new Promise<{
            start: number,
            end: number,
            data: number[]
        }>((resolve, reject) => {
            setTimeout(() => reject(new MediaError('timed out')), 1000);
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
            setTimeout(() => reject(new MediaError('timed out')), 1000);
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


