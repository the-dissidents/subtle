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
        position: number,
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
            console.warn('unhandled event:', msg);
        }
    }
    return channel;
}

type IPCMessage = {
    type: 'text',
    content: string
} | {
    type: 'binary',
    content: Readonly<ArrayBuffer>
};

type IPCListener = (msg: IPCMessage) => void;

const IPCInternal = {
    socket: undefined as WebSocket | undefined,
    listeners: new Map<Object, IPCListener[]>()
}

export const IPC = {
    async init() {
        if (IPCInternal.socket != undefined) return;
        
        IPCInternal.socket = new WebSocket("ws://127.0.0.1:42069");
        IPCInternal.socket.binaryType = "arraybuffer";
        return new Promise<void>((resolve, reject) => {
            IPCInternal.socket!.onopen = () => {
                console.log('IPC socket connected');
                resolve();
            }
            IPCInternal.socket!.onerror = () => {
                IPCInternal.socket = undefined;
                reject('socket error');
            }
            IPCInternal.socket!.onmessage = (ev) => {
                const msg: IPCMessage = (typeof ev.data == 'string') 
                    ? { type: 'text', content: ev.data } 
                    : { type: 'binary', content: ev.data };

                for (const [_, fns] of IPCInternal.listeners.entries()) {
                    fns.forEach((x) => x(msg));
                }
            };
        });
    },
    registerListener(key: Object, fn: IPCListener) {
        assert(IPCInternal.socket !== undefined);
        if (!IPCInternal.listeners.has(key))
            IPCInternal.listeners.set(key, []);
        IPCInternal.listeners.get(key)!.push(fn);
    },
    deleteListeners(key: Object) {
        assert(IPCInternal.socket !== undefined);
        IPCInternal.listeners.delete(key);
    }
}

export type VideoFrameData = {
    position: number,
    time: number,
    stride: number,
    content: Uint8ClampedArray
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

    onReceiveVideoFrame: ((data: VideoFrameData) => void) | undefined = undefined;

    private constructor(
        private id: number,
        private _duration: number,
        private _streams: string[]
    ) {
        IPC.registerListener(this, (msg) => {
            if (msg.type == 'binary' && this.onReceiveVideoFrame !== undefined) {
                const view = new DataView(msg.content);
                const kind = String.fromCharCode(view.getUint8(0));
                const position = Number(view.getBigInt64(1+0, true));
                const time = view.getFloat64(1+8, true);
                const stride = Number(view.getBigUint64(1+16, true));
                const length = Number(view.getBigUint64(1+24, true));
                // console.log(position, time, length);
                const content = new Uint8ClampedArray(msg.content, 1+32, length);

                switch (kind) {
                case 'V':
                    const struct: VideoFrameData = { position, time, stride, content };
                    this.onReceiveVideoFrame(struct);
                    break;
                case 'A':
                    
                default:
                    console.log('Invalid message type:', kind);
                }
            }
        })
    }

    static async open(path: string) {
        await IPC.init();
        const id = await new Promise<number>((resolve, reject) => {
            let channel = createChannel({
                opened: (data) => resolve(data.id)
            });
            console.log('called open_media');
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

    close() {
        assert(!this.#destroyed);
        return new Promise<void>((resolve, reject) => {
            let channel = createChannel({
                done: () => {
                    this.#destroyed = true;
                    IPC.deleteListeners(this);
                    resolve();
                }
            });
            invoke('close_media', {id: this.id, channel});
        });
    }

    openAudio(audioId: number) {
        assert(!this.#destroyed);
        return new Promise<void>((resolve, reject) => {
            let channel = createChannel({
                done: () => resolve()
            });
            console.log('called open_audio');
            invoke('open_audio', {id: this.id, audioId, channel});
        });
    }

    async openVideo(videoId: number) {
        assert(!this.#destroyed);
        await new Promise<void>((resolve, reject) => {
            let channel = createChannel({
                done: () => resolve()
            });
            console.log('called open_video');
            invoke('open_video', {id: this.id, videoId, channel});
        });
        let status = await this.videoStatus();
        assert(status !== null);
    }

    status() {
        assert(!this.#destroyed);
        return new Promise<{
            audioIndex: number,
            videoIndex: number
        }>((resolve, reject) => {
            let channel = createChannel({
                mediaStatus: (data) => resolve(data)
            });
            invoke('media_status', {id: this.id, channel});
        });
    }

    audioStatus() {
        assert(!this.#destroyed);
        return new Promise<{
            position: number,
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

    videoPosition() {
        assert(!this.#destroyed);
        return new Promise<number>((resolve, reject) => {
            this.#currentJobs += 1;
            let channel = createChannel({
                position: (data) => resolve(data.value)
            });
            invoke('get_current_video_position', {id: this.id, channel});
        }).finally(() => this.#currentJobs -= 1);
    }

    moveToNextVideoFrame(n = 1) {
        assert(!this.#destroyed);
        return new Promise<number>((resolve, reject) => {
            this.#currentJobs += 1;
            let channel = createChannel({
                position: (data) => resolve(data.value)
            });
            invoke('move_to_next_video_frame', {id: this.id, n, channel});
        }).finally(() => this.#currentJobs -= 1);
    }

    readNextVideoFrame() {
        assert(!this.#destroyed);
        return new Promise<void>((resolve, reject) => {
            this.#currentJobs += 1;
            let channel = createChannel({
                done: () => resolve()
            });
            invoke('send_next_video_frame', {id: this.id, channel});
        }).finally(() => this.#currentJobs -= 1);
    }

    readCurrentVideoFrame() {
        assert(!this.#destroyed);
        return new Promise<void>((resolve, reject) => {
            this.#currentJobs += 1;
            let channel = createChannel({
                done: () => resolve()
            });
            invoke('send_current_video_frame', {id: this.id, channel});
        }).finally(() => this.#currentJobs -= 1);
    }

    seekAudio(position: number) {
        assert(!this.#destroyed);
        return new Promise<void>((resolve, reject) => {
            this.#currentJobs += 1;
            let channel = createChannel({
                done: () => resolve()
            });
            invoke('seek_audio', {id: this.id, channel, position});
        }).finally(() => this.#currentJobs -= 1);
    }

    seekVideo(position: number) {
        assert(!this.#destroyed);
        return new Promise<void>((resolve, reject) => {
            this.#currentJobs += 1;
            let channel = createChannel({
                done: () => resolve()
            });
            invoke('seek_video', {id: this.id, channel, position});
        }).finally(() => this.#currentJobs -= 1);
    }

    getIntensities(until: number, step: number) {
        assert(!this.#destroyed);
        return new Promise<{
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
    async testSocket() {
        await invoke('request_something', {});
    }
}


