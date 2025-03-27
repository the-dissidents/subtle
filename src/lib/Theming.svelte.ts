import type { LabelTypes } from "./core/Subtitles.svelte";

export let theme = $state({
    isDark: false
});

window
  .matchMedia('(prefers-color-scheme: dark)')
  .addEventListener('change', event => theme.isDark = event.matches);

export const LabelColorOklch = {
    'none':     ['',                    ''], 
    'red':      ['78.78% 0.109 4.54',   '41.17% 0.157 16.58'], 
    'orange':   ['88.37% 0.073 55.8',   '52.49% 0.113 51.98'], 
    'yellow':   ['95% 0.07 92.39',      '75.84% 0.122 92.21'],
    'green':    ['88.77% 0.096 147.71', '52.77% 0.138 145.41'], 
    'blue':     ['80.17% 0.091 258.88', '39.53% 0.15 259.87'], 
    'purple':   ['78.68% 0.091 305',    '36.01% 0.145 298.35']
} satisfies {[k in LabelTypes]: [string, string]};

export function LabelColor(label: LabelTypes, opacity = 1) {
    let raw = LabelColorOklch[label][theme.isDark ? 1 : 0];
    return raw ? `oklch(${raw} / ${opacity})` : 'none';
}