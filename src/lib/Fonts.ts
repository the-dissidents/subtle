import { convertFileSrc } from "@tauri-apps/api/core";
import { MAPI } from "./API";
import type { ResolvedFontFace } from "./bindings/ResolvedFontFace";
import { Debug } from "./Debug";

let counter = 0;
let initialized = false;

type FaceId = `${string}@${number}`;
const faces = new Map<FaceId, LoadedFontFace>();
const allFamilies = new Set<string>();

export type LoadedFontFace = ResolvedFontFace & {
    loaded: FontFace
};

async function getFace(face: ResolvedFontFace) {
    const id: FaceId = `${face.url}@${face.index}`;
    const f = faces.get(id);
    if (f) return f;

    const newf = new FontFace(
        `__subtle_ff_${face.familyName}_${counter}`, convertFileSrc(face.url));
    await newf.load();
    document.fonts.add(newf);
    const obj = { ...face, loaded: newf };
    faces.set(id, obj);
    counter++;
    return obj;
}

export const Fonts = {
    async init() {
        allFamilies.clear();
        (await MAPI.getAllFontFamilies()).forEach((x) => allFamilies.add(x));
        Debug.info(`found ${allFamilies.size} font families`);
        initialized = true;
    },

    get initialized() {
        return initialized;
    },

    get families(): ReadonlySet<string> {
        return allFamilies;
    },

    async getFamily(name: string) {
        const family = await MAPI.resolveFontFamily(name);
        if (!family) return null;
        return (await Promise.allSettled(family.faces.map((x) => getFace(x))))
            .filter((x) => x.status == 'fulfilled')
            .map((x) => x.value);
    }
}