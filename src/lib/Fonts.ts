// import { convertFileSrc } from "@tauri-apps/api/core";
import { MAPI } from "./API";
import type { ResolvedFontFace } from "./bindings/ResolvedFontFace";
import { Debug } from "./Debug";

// let counter = 0;
let initialized = false;

type FaceId = `${string}@${number}`;
const faces = new Map<FaceId, LoadedFontFace>();
const cachedFamilies = new Map<string, LoadedFontFace[]>();

const allFamilies = new Set<string>();
const onInitCallbacks: (() => void | Promise<void>)[] = [];

export type LoadedFontFace = ResolvedFontFace & {
    // loaded: FontFace
    loaded: boolean
};

function getFace(face: ResolvedFontFace) {
    const id: FaceId = `${face.url}@${face.index}`;
    const f = faces.get(id);
    if (f) return f;

    const obj = { ...face, loaded: true };
    faces.set(id, obj);
    return obj;
}

export type FontAvailability = {
    status: true
    supplement: false | string
} | {
    status: false
};

import FontsMac10_15 from '../font-data/mac10_15.csv?raw';
import FontsWin11 from '../font-data/win11.csv?raw';

function readFonts(s: string, map: Map<string, string | false>) {
    for (const line of s.split('\n')) {
        const [name, type, system] = line.split(',');
        if (!name || !type || !system) continue;
        map.set(name, type == 'Builtin' ? false : type);
    }
}

const macFonts = new Map<string, string | false>();
const winFonts = new Map<string, string | false>();
readFonts(FontsWin11, winFonts);
readFonts(FontsMac10_15, macFonts);

export const Fonts = {
    async init() {
        allFamilies.clear();
        (await MAPI.getAllFontFamilies()).forEach((x) => allFamilies.add(x));
        void Debug.info(`found ${allFamilies.size} font families`);
        initialized = true;
        for (const c of onInitCallbacks)
            await c();
    },

    async onInit(callback: () => void | Promise<void>) {
        if (initialized) await callback();
        else onInitCallbacks.push(callback);
    },

    get initialized() {
        return initialized;
    },

    get families(): ReadonlySet<string> {
        return allFamilies;
    },

    async getFamily(name: string) {
        if (cachedFamilies.has(name))
            return cachedFamilies.get(name)!;

        const family = await MAPI.resolveFontFamily(name);
        if (!family) return null;
        const result = family.faces.map((x) => getFace(x));
        cachedFamilies.set(name, result);
        return result;
    },

    windowsAvailability(name: string): FontAvailability {
        return winFonts.has(name)
            ? { status: true, supplement: winFonts.get(name)! }
            : { status: false };
    },

    macosAvailability(name: string): FontAvailability {
        return macFonts.has(name)
            ? { status: true, supplement: macFonts.get(name)! }
            : { status: false };
    }
}
