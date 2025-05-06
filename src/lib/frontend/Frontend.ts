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
    #listeners = new Map<object, ((...args: [...T]) => void)[]>();

    static globalEventHosts: EventHost<any>[] = [];
    constructor() {
        EventHost.globalEventHosts.push(this);
    }

    dispatch(...args: [...T]) {
        for (const [obj, f] of this.#listeners) {
            // console.log(`dispatch`, obj, f, this);
            f.forEach((x) => x(...args));
        }
    };
    
    bind(obj: object, f: (...args: [...T]) => void) {
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
    return DebugConfig.data.mouseWheelDetection == 'multiple'
        ? x % 120 != 0 || y % 120 != 0
        : Math.abs(x) < 100 && Math.abs(y) < 100;
}

export function translateWheelEvent(e: WheelEvent): TranslatedWheelEvent {
    // @ts-expect-error
    const deltaX = -(e.wheelDeltaX ?? -e.deltaX);
    // @ts-expect-error
    const deltaY = -(e.wheelDeltaY ?? -e.deltaY);
    if (e.ctrlKey) {
        // zoom. only look at Y
        const isTrackpad = deltaY % 1 != 0;
        return {
            isZoom: true,
            isTrackpad,
            amount: deltaY * (isTrackpad 
                ? InputConfig.data.trackpadZoomFactor
                : InputConfig.data.mouseZoomFactor)
        };
    } else if (isTrackpad(deltaX, deltaY)) {
        // trackpad scroll
        // console.log('trackpad scroll', e.deltaX, e.deltaY);
        return {
            isZoom: false,
            isTrackpad: true,
            amountX: deltaX * InputConfig.data.trackpadScrollFactor,
            amountY: deltaY * InputConfig.data.trackpadScrollFactor,
        };
    } else {
        // mouse scroll
        // console.log('mouse scroll', e.deltaX, e.deltaY);
        return {
            isZoom: false,
            isTrackpad: false,
            amountX: deltaX * InputConfig.data.mouseScrollFactor,
            amountY: deltaY * InputConfig.data.mouseScrollFactor,
        };
    }
}

export type UIFocus = (typeof UIFocusList)[number];
export const UIFocusList = ['Other', 'Table', 'EditingField', 'Timeline'] as const;
