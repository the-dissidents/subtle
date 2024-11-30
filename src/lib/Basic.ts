import {  path } from "@tauri-apps/api"
import * as os from "@tauri-apps/plugin-os"

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
    }
}