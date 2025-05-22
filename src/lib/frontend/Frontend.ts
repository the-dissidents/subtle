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
