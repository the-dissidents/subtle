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
const onInitCallbacks: (() => void)[] = [];

export type LoadedFontFace = ResolvedFontFace & {
    // loaded: FontFace
    loaded: boolean
};

async function getFace(face: ResolvedFontFace) {
    const id: FaceId = `${face.url}@${face.index}`;
    const f = faces.get(id);
    if (f) return f;

    // const newf = new FontFace(
    //     `__subtle_ff_${face.familyName}_${counter}`, `url("${convertFileSrc(face.url)}")`);
    // await newf.load();
    // document.fonts.add(newf);
    // Debug.info('added font', id);
    // counter++;

    const obj = { ...face, loaded: true };
    faces.set(id, obj);
    return obj;
}

export const Fonts = {
    async init() {
        allFamilies.clear();
        (await MAPI.getAllFontFamilies()).forEach((x) => allFamilies.add(x));
        Debug.info(`found ${allFamilies.size} font families`);
        initialized = true;
        for (const c of onInitCallbacks)
            c();
    },

    onInit(callback: () => void) {
        if (initialized) callback();
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
        const result =
            (await Promise.allSettled(family.faces.map((x) => getFace(x))))
            .filter((x) => x.status == 'fulfilled')
            .map((x) => x.value);
        cachedFamilies.set(name, result);
        return result;
    }
}