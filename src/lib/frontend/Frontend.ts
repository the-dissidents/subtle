console.info('Frontend loading');

import { DebugConfig, InputConfig } from "../config/Groups";
import { Format } from "../core/SimpleFormats";
import { Subtitles, type SubtitleFormat } from "../core/Subtitles.svelte";
import { Debug } from "../Debug";
import { get, readonly, writable } from "svelte/store";

export type TranslatedWheelEvent = {
    isZoom: true;
    amount: number,
    isTrackpad: boolean
} | {
    isZoom: false;
    amountX: number,
    amountY: number,
    isTrackpad: boolean
};

export function parseSubtitleSource(source: string): Subtitles | null {
    const formats = [Format.JSON, Format.ASS, Format.SRT];
    let possible: SubtitleFormat[] = [];
    for (const f of formats) {
        const d = f.detect(source);
        if (d === null) possible.push(f);
        if (d === true) return f.parse(source).done();
    }
    if (possible.length == 1)
        return possible[0].parse(source).done();
    for (const f of possible) {
        try {
            return f.parse(source).done();
        } catch (e) {
            // pass
            Debug.debug(e);
        }
    }
    Debug.debug('no recognized format');
    return null;
}

function isTrackpad(x: number, y: number) {
    const absx = Math.abs(x);
    const absy = Math.abs(y);
    return DebugConfig.data.mouseWheelDetection == 'multiple'
        ? (absx != 120 && absx != 100 && x != 0) || (absy != 120 && absy != 100 && y != 0)
        : Math.abs(x) < 100 && Math.abs(y) < 100;
}

export function translateWheelEvent(e: WheelEvent): TranslatedWheelEvent {
    if (e.ctrlKey) {
        // zoom. only look at Y
        const isTrackpad = e.deltaY % 1 != 0;
        return {
            isZoom: true,
            isTrackpad,
            amount: e.deltaY * (isTrackpad 
                ? InputConfig.data.trackpadZoomFactor
                : InputConfig.data.mouseZoomFactor)
        };
    } else if (isTrackpad(e.deltaX, e.deltaY)) {
        // trackpad scroll
        return {
            isZoom: false,
            isTrackpad: true,
            amountX: e.deltaX * InputConfig.data.trackpadScrollFactor,
            amountY: e.deltaY * InputConfig.data.trackpadScrollFactor,
        };
    } else {
        // mouse scroll
        return {
            isZoom: false,
            isTrackpad: false,
            amountX: e.deltaX * InputConfig.data.mouseScrollFactor,
            amountY: e.deltaY * InputConfig.data.mouseScrollFactor,
        };
    }
}

export type UIFocus = (typeof UIFocusList)[number];
export const UIFocusList = ['EditingField', 'Table', 'Timeline', 'Other'] as const;

export type StatusType = 'info' | 'error';
export type ToolboxPage = 'properties' | 'search' | 'untimed' | 'test' | 'references' | undefined;
const status = writable({ msg: 'ok', type: 'info' as StatusType });

export const Frontend = {
    modalOpenCounter: 0,
    uiFocus: writable<UIFocus>('Other'),
    // FIXME: this immediately gets overwritten by App.svelte
    toolboxFocus: writable<ToolboxPage>(),

    get status() {
        return readonly(status);
    },

    setStatus(msg: string, type: StatusType = 'info') {
        Debug.debug('status ->', msg, type);
        status.set({ msg, type });
    },

    getUIFocus(): UIFocus {
        return get(this.uiFocus);
    },
}
export async function guardAsync(x: () => Promise<void>, msg: string): Promise<void>;
export async function guardAsync<T>(x: () => Promise<T>, msg: string, fallback: T): Promise<T>;

export async function guardAsync<T>(x: () => Promise<T>, msg: string, fallback?: T) {
    if (DebugConfig.data.disableTry) {
        return await x();
    } else {
        try {
            return await x();
        } catch (x) {
            Frontend.setStatus(`${msg}: ${x}`, 'error');
            Debug.info('guardAsync:', msg, x);
            return fallback;
        };
    }
}

type EnforceNotPromise<T extends () => any> = ReturnType<T> extends Promise<any> ? never : T;

export function guard<T extends () => void>(x: EnforceNotPromise<T>, msg: string): void;
export function guard<T extends () => any>(
    x: EnforceNotPromise<T>, msg: string, fallback: ReturnType<T>): ReturnType<T>;

export function guard<T>(x: () => T, msg: string, fallback?: T) {
    if (DebugConfig.data.disableTry) {
        return x();
    } else {
        try {
            return x();
        } catch (x) {
            Frontend.setStatus(`${msg}: ${x}`, 'error');
            Debug.info('guard:', msg, x);
            return fallback;
        };
    }
}
