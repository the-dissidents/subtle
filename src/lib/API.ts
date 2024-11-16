import { invoke, Channel } from '@tauri-apps/api/core';

type MediaEvent = {
    event: 'done'
    data: {}
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
    event: 'noMedia',
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
        case 'noMedia':
            throw new MediaError('no media opened');
        default:
            console.warn('unhandled event:', msg);
        }
    }
    return channel;
}

export const MAPI = {
    openMedia(path: string) {
        return new Promise<void>((resolve, reject) => {
            let channel = createChannel({
                done: () => resolve()
            });
            console.log('called open_media');
            invoke('open_media', {path, channel});
        });
    },
    
    openAudio(index: number) {
        return new Promise<void>((resolve, reject) => {
            let channel = createChannel({
                done: () => resolve()
            });
            console.log('called open_audio');
            invoke('open_audio', {index, channel});
        });
    },

    mediaStatus() {
        return new Promise<{
            audioIndex: number,
            videoIndex: number
        } | null>((resolve, reject) => {
            let channel = createChannel({
                mediaStatus: (data) => resolve(data),
                noMedia: () => resolve(null)
            });
            invoke('media_status', {channel});
        });
    },

    audioStatus() {
        return new Promise<{
            position: number,
            sampleRate: number,
            length: number
        } | null>((resolve, reject) => {
            let channel = createChannel({
                audioStatus: (data) => resolve(data),
                noMedia: () => resolve(null)
            });
            invoke('audio_status', {channel});
        });
    },

    closeMedia() {
        return new Promise<void>((resolve, reject) => {
            let channel = createChannel({
                done: () => resolve()
            });
            invoke('close_media', {channel});
        });
    },

    seekAudio(position: number) {
        return new Promise<void>((resolve, reject) => {
            let channel = createChannel({
                done: () => resolve()
            });
            invoke('seek_audio', {channel, position});
        });
    },

    getIntensities(until: number, step: number) {
        return new Promise<{
            start: number,
            end: number,
            data: number[]
        }>((resolve, reject) => {
            let channel = createChannel({
                intensityList: (data) => resolve(data),
            });
            invoke('get_intensities', {channel, until, step});
        });
    }
}


