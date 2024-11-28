import { invoke, Channel } from '@tauri-apps/api/core';
import WebSocket from '@tauri-apps/plugin-websocket';
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
        position: number,
        length: number,
        framerate: number,
        width: number, height: number
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

export class IPCClient {
    #socket: WebSocket;

    private constructor(socket: WebSocket) {
        this.#socket = socket;
    }

    static async create() {
        let socket = await WebSocket.connect("ws://127.0.0.1:42069");
        socket.addListener((msg) => {
            console.log('from socket:', msg);
        });
        return new IPCClient(socket);
    }
}

export class MMedia {
    #destroyed = false;

    private constructor(private id: number) {}

    static open(path: string) {
        return new Promise<MMedia>((resolve, reject) => {
            let channel = createChannel({
                opened: (data) => resolve(new MMedia(data.id))
            });
            console.log('called open_media');
            invoke('open_media', {path, channel});
        });
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

    openVideo(videoId: number) {
        assert(!this.#destroyed);
        return new Promise<void>((resolve, reject) => {
            let channel = createChannel({
                done: () => resolve()
            });
            console.log('called open_video');
            invoke('open_video', {id: this.id, videoId, channel});
        });
    }

    status() {
        assert(!this.#destroyed);
        return new Promise<{
            audioIndex: number,
            videoIndex: number,
            duration: number,
            streams: string[]
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

    videoStatus() {
        assert(!this.#destroyed);
        return new Promise<{
            position: number,
            length: number,
            framerate: number,
            width: number, height: number
        } | null>((resolve, reject) => {
            let channel = createChannel({
                videoStatus: (data) => resolve(data),
                noStream: () => resolve(null)
            });
            invoke('video_status', {id: this.id, channel});
        });
    }

    setVideoSize(width: number, height: number) {
        assert(!this.#destroyed);
        return new Promise<void>((resolve, reject) => {
            let channel = createChannel({
                done: () => resolve()
            });
            invoke('video_set_size', {id: this.id, channel, width, height});
        });
    }

    seekAudio(position: number) {
        assert(!this.#destroyed);
        return new Promise<void>((resolve, reject) => {
            let channel = createChannel({
                done: () => resolve()
            });
            invoke('seek_audio', {id: this.id, channel, position});
        });
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


