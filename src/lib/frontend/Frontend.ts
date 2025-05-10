console.info('Frontend loading');

import { Basic } from "../Basic";
import { DebugConfig, InputConfig } from "../config/Groups";
import { Format } from "../core/Formats";
import { Subtitles } from "../core/Subtitles.svelte";

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

export class EventHost<T extends unknown[] = []> {
    #listeners = new Map<object, ((...args: [...T]) => void | Promise<void>)[]>();

    static globalEventHosts: EventHost<any>[] = [];
    constructor() {
        EventHost.globalEventHosts.push(this);
    }

    dispatch(...args: [...T]) {
        for (const [_, f] of this.#listeners) {
            // console.log(`dispatch`, obj, f, this);
            f.forEach((x) => x(...args));
        }
    };

    async dispatchAndAwaitAll(...args: [...T]) {
        const list = [...this.#listeners]
            .flatMap(([_, f]) => f.map((x) => x(...args)))
            .filter((x) => x !== undefined);
        await Promise.allSettled(list);
    };
    
    bind(obj: object, f: (...args: [...T]) => void | Promise<void>) {
        if (!this.#listeners.has(obj))
            this.#listeners.set(obj, []);
        this.#listeners.get(obj)!.push(f);
        // console.log(`bind`, obj, f, this);
    }

    static unbind(obj: object) {
        for (const host of EventHost.globalEventHosts) {
            // console.log(`unbind`, host.#listeners.get(obj), this);
            host.#listeners.delete(obj);
        }
    }
}

export function parseSubtitleSource(source: string): Subtitles | null {
    try {
        let newSub = Format.JSON.parse(source);
        return newSub;
    } catch {}

    source = Basic.normalizeNewlines(source);

    try {
        let newSub = Format.SRT.parse(source);
        return newSub;
    } catch {}

    try {
        let newSub = Format.ASS.parse(source);
        return newSub;
    } catch {}

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
        // console.log('trackpad scroll', e.deltaX, e.deltaY);
        return {
            isZoom: false,
            isTrackpad: true,
            amountX: e.deltaX * InputConfig.data.trackpadScrollFactor,
            amountY: e.deltaY * InputConfig.data.trackpadScrollFactor,
        };
    } else {
        // mouse scroll
        // console.log('mouse scroll', e.deltaX, e.deltaY);
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
