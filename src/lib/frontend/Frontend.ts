console.info('Frontend loading');

import { Basic } from "../Basic";
import { DebugConfig, InputConfig } from "../config/Groups";
import { Format } from "../core/Formats";
import { Subtitles, type SubtitleFormat } from "../core/Subtitles.svelte";
import { Debug } from "../Debug";

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
    source = source.replaceAll('\r\n', '\n');
    
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
