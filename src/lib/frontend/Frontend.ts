console.info('Frontend loading');

import { Basic } from "../Basic";
import { DebugConfig, InputConfig } from "../config/Groups";
import { ASS } from "../core/ASS.svelte";
import { SimpleFormats } from "../core/SimpleFormats";
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

export function parseSubtitleSource(source: string): [Subtitles | null, boolean] {
    let newSub = SimpleFormats.parse.JSON(source);
    if (newSub) return [newSub, true];
    source = Basic.normalizeNewlines(source);
    newSub = SimpleFormats.parse.SRT_VTT(source);
    if (newSub) return [newSub, false];
    newSub = ASS.parse(source);
    return [newSub, false];
}

function isTrackpad(e: WheelEvent) {
    return DebugConfig.data.mouseWheelDetection == 'multiple'
        ? e.deltaX % 120 != 0 || e.deltaY % 120 != 0
        : Math.abs(e.deltaX) < 100 && Math.abs(e.deltaY) < 100;
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
    } else if (isTrackpad(e)) {
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
export enum UIFocus {
    Other,
    Table,
    EditingField,
    Timeline
}
