console.info('Basic loading');

import { path } from "@tauri-apps/api";
import * as os from "@tauri-apps/plugin-os";

import { addMessages, locale } from 'svelte-i18n';

import en from '../locales/en.json';
import zh_cn from '../locales/zh-cn.json';
import zh_tw from '../locales/zh-tw.json';

addMessages('en', en);
addMessages('zh-cn', zh_cn);
addMessages('zh-tw', zh_tw);
locale.set('en');

// export function assert(val: boolean): asserts val {
//     console.assert(val);
//     if (!val) throw new Error('assertion failed');
// }

// export function never(x: never): never {
//     throw new Error(`should be never: ${x}`);
// }

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

    parseTimestamp: (t: string) => {
        const reg = /(\d+):(\d+):(\d+)[,.](\d+)/;
        let match = reg.exec(t);
        if (!match) return null;
        let h = parseInt(match[1]),
            m = parseInt(match[2]),
            s = parseFloat(match[3] + '.' + match[4]);
        let result = h * 3600 + m * 60 + s;
        if (isNaN(result)) return null;
        return result;
    },

    formatTimestamp: (t: number, n: number = 3, char = '.') => {
        let h = Math.floor(t / 3600).toString().padStart(2, '0');
        let m = Math.floor((t % 3600) / 60).toString().padStart(2, '0');
        let s = Math.floor(t % 60).toString().padStart(2, '0');
        let ms = (t % 1).toFixed(n).slice(2);
        return `${h}:${m}:${s}${char}${ms}`;
    },
    
    normalizeNewlines: (s: string) => {
        return s.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
    },
}