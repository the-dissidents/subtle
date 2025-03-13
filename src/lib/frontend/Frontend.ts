import { ASS } from "../core/ASS";
import { SimpleFormats } from "../core/SimpleFormats";
import { Subtitles, SubtitleUtil } from "../core/Subtitles.svelte";

export class EventHost<T extends unknown[] = []> {
    #listeners = new Map<object, ((...args: [...T]) => void)[]>();

    static globalEventHosts: EventHost<any>[] = [];
    constructor() {
        EventHost.globalEventHosts.push(this);
    }

    dispatch(...args: [...T]) {
        for (const [_, l] of this.#listeners)
            l.forEach((x) => x(...args));
    };
    
    bind(obj: object, f: (...args: [...T]) => void) {
        if (!this.#listeners.has(obj))
            this.#listeners.set(obj, []);
        this.#listeners.get(obj)!.push(f);
    }

    static unbind(obj: object) {
        for (const host of EventHost.globalEventHosts)
            host.#listeners.delete(obj);
    }
}

export function parseSubtitleSource(source: string): [Subtitles | null, boolean] {
    let newSub = SimpleFormats.parse.JSON(source);
    if (newSub) return [newSub, true];
    source = SubtitleUtil.normalizeNewlines(source);
    newSub = SimpleFormats.parse.SRT_VTT(source);
    if (newSub) return [newSub, false];
    newSub = ASS.parse(source);
    return [newSub, false];
}
