import type { LabelTypes } from "./Subtitles.svelte";

export const LabelColorOklch = {
    'none':     '', 
    'red':      '78.78% 0.109 4.54', 
    'orange':   '88.37% 0.073 55.8', 
    'yellow':   '95% 0.07 92.39',
    'green':    '88.77% 0.096 147.71', 
    'blue':     '80.17% 0.091 258.88', 
    'purple':   '78.68% 0.091 305'
} satisfies {[k in LabelTypes]: string};

export function LabelColor(label: LabelTypes, opacity = 1) {
    let raw = LabelColorOklch[label];
    return raw ? `oklch(${raw} / ${opacity})` : 'none';
}