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

export function assert(val: boolean): asserts val {
    console.assert(val);
    if (!val) throw new Error('assertion failed');
}

export function never(x: never): never {
    throw new Error(`should be never: ${x}`);
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
    }
}