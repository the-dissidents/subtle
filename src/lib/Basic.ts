import {  path } from "@tauri-apps/api";
import * as os from "@tauri-apps/plugin-os";
import { Config } from "./Config";

export type TranslatedWheelEvent = {
    isZoom: true;
    amount: number,
    isTrackpad: boolean
} | {
    isZoom: false;
    amountX: number,
    amountY: number,
    isTrackpad: boolean
}

export function assert(val: boolean): asserts val {
    console.assert(val);
    if (!val) throw new Error('assertion failed');
}

export const Basic = {
    OSType: os.type(),
    pathSeparator: path.sep(),
    ctrlKey: () => Basic.OSType == 'macos' ? 'Meta' : 'Control',

    getFilename(p: string) { 
        return p.split(Basic.pathSeparator).at(-1);
    },

    escapeRegexp(str: string) {
        return str.replace(/[/\-\\^$*+?.()|[\]{}]/g, '\\$&');
    },

    splitPrintingWords(str: string): string[] {
        return str.split(/(\n)/u).flatMap((x) => x.split(
            /(?<=[^\u4E00-\u9FFF])(?=[\u4E00-\u9FFF])|(?<= )|(?<=[\u4E00-\u9FFF])(?=[\u0000-\u00FF\u4E00-\u9FFF])/u));
    },

    timeout<T>(t: number, p: Promise<T>): Promise<T> {
        return Promise.race([p, 
            new Promise<T>((_, reject) => setTimeout(() => reject('timeout'), t))]);
    },

    wait(n: number) {
        return new Promise<void>((resolve) => setTimeout(() => resolve(), n));
    },

    waitUntil(cond: () => boolean): Promise<void> {
        return new Promise((resolve) => {
            const wait = () => {
                if (cond()) resolve();
                else setTimeout(wait, 1);
            };
            wait();
        });
    },

    translateWheelEvent(e: WheelEvent): TranslatedWheelEvent {
        if (e.ctrlKey) {
            // zoom. only look at Y
            const isTrackpad = e.deltaY % 1 != 0;
            return {
                isZoom: true,
                isTrackpad,
                amount: e.deltaY * Config.get(isTrackpad 
                    ? 'trackpadZoomSensitivity' 
                    : 'mouseZoomSensitivity')
            };
        } else if (Math.abs(e.deltaX) < 100 && Math.abs(e.deltaY) < 100) {
            // trackpad scroll
            return {
                isZoom: false,
                isTrackpad: true,
                amountX: e.deltaX * Config.get('trackpadScrollSensitivity'),
                amountY: e.deltaY * Config.get('trackpadScrollSensitivity'),
            };
        } else {
            // mouse scroll
            return {
                isZoom: false,
                isTrackpad: false,
                amountX: e.deltaX * Config.get('mouseScrollSensitivity'),
                amountY: e.deltaY * Config.get('mouseScrollSensitivity'),
            };
        }
    }
}