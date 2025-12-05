import { SvelteMap } from "svelte/reactivity";
import { Debug } from "../Debug";
import { SubtitleEntry, Subtitles, SubtitleStyle } from "./Subtitles.svelte";

export type MergeStyleSelection =
    'usedOnly' | 'all' | 'onlyStyles';

export type MergeStyleBehavior = {
    type: 'keepAll' | 'keepDifferent' | 'useLocalByName' | 'overwrite';
} | {
    type: 'override',
    overrideStyle: SubtitleStyle
} | {
    type: 'createNewOverride',
    name: string
}

export type MergePosition = {
    type: 'sortedBefore' | 'sortedAfter' | 'before' | 'after' | 'overwrite'
} | {
    type: 'custom',
    customPosition: number
};

export type MergeOptions = {
    style: MergeStyleBehavior;
    selection: MergeStyleSelection;
    position: MergePosition;
    overrideMetadata?: boolean;
};

export type TimeShiftOptions = {
    selection?: SubtitleEntry[];
    modifySince?: boolean;
    offset?: number;
    scale?: number;
};

export enum LinearFormatCombineStrategy {
    /**
     * Keeps the original ordering of subtitle entries, but channels in the same entry are combined.
     */
    KeepOrder,
    /**
     * Sorts subtitle entries by starting time, combined channels in the same entry, but retains overlapping durations.
     */
    Sorted,
    /**
     * Sorts subtitle entries by starting time and recombines them to ensure no overlapping occurs.
     */
    Recombine
}

export type LinearEntry = {
    start: number, end: number, text: string
};

const ToLinearFormat = {
    [LinearFormatCombineStrategy.KeepOrder]: 
        (subs: Subtitles, entries: SubtitleEntry[]): LinearEntry[] => entries
            .map((x) => ({ 
                start: x.start, end: x.end, 
                text: subs.styles
                    .map((s) => x.texts.get(s))
                    .filter((x) => x).join('\n') 
            })),
    [LinearFormatCombineStrategy.Sorted]:
        (subs: Subtitles, entries: SubtitleEntry[]): LinearEntry[] => entries
            .toSorted((x, y) => x.start - y.start)
            .map((x) => ({ 
                start: x.start, end: x.end, 
                text: subs.styles
                    .map((s) => x.texts.get(s))
                    .filter((x) => x).join('\n') 
            })),
    [LinearFormatCombineStrategy.Recombine]:
        (subs: Subtitles, entries: SubtitleEntry[]): LinearEntry[] => {
            const events: { type: 'start' | 'end', pos: number, i: number }[] = [];
            entries.forEach(({start, end}, i) => {
                events.push({ type: 'start', pos: start, i });
                events.push({ type: 'end', pos: end, i });
            });
            events.sort((a, b) => a.pos - b.pos);
            if (events.length == 0) return [];

            const activeTexts: {i: number, text: string}[] = [];
            const result: LinearEntry[] = [];
            let i = 0;
            outer: while (true) {
                const pos = events[i].pos;
                while (events[i].pos == pos) {
                    const event = events[i];
                    if (event.type == 'start') {
                        const entry = entries[event.i];
                        const text = subs.styles
                            .map((s) => entry.texts.get(s))
                            .filter((x) => x).join('\n');
                        activeTexts.push({text, i: event.i});
                    } else {
                        const index = activeTexts.findIndex((x) => x.i == event.i);
                        Debug.assert(index >= 0);
                        activeTexts.splice(index, 1);
                    }
                    i++;
                    if (i == events.length) break outer;
                }
                const pos2 = events[i].pos;
                if (activeTexts.length > 0) result.push({
                    start: pos, end: pos2, 
                    text: activeTexts.map((x) => x.text).join('\n')
                });
            }
            return result;
        }
}

export const SubtitleTools = {
    alignTimes: (subs: Subtitles, epsilon: number) => {
        for (let i = 0; i < subs.entries.length - 1; i++) {
            const s0 = subs.entries[i].start;
            const e0 = subs.entries[i].end;
            for (let j = i + 1; j < subs.entries.length; j++) {
                const s1 = subs.entries[j].start;
                const e1 = subs.entries[j].end;
                if (Math.abs(s1 - s0) <= epsilon)
                    subs.entries[j].start = s0;
                if (Math.abs(e1 - e0) <= epsilon)
                    subs.entries[j].end = e0;
            }
        }
    },
    makeTestSubtitles: () => {
        const subs = new Subtitles();
        for (let i = 0; i < 10; i++) {
            const entry = new SubtitleEntry(i * 5, i * 5 + 5);
            entry.texts.set(subs.defaultStyle, `测试第${i}行`);
            subs.entries.push(entry);
        }
        return subs;
    },
    getUniqueStyleName: (subs: Subtitles, base: string, ignore?: SubtitleStyle) => {
        let i = 1;
        let newName = base;
        while (subs.styles.find((x) => x.name == newName && x !== ignore)) {
            newName = base + `_${i}`;
            i++;
        }
        return newName;
    }
};

export const SubtitleUtil = {
    combineToLinear(
        subs: Subtitles, entries: SubtitleEntry[],
        strategy: LinearFormatCombineStrategy
    ): LinearEntry[] {
        return ToLinearFormat[strategy](subs, entries);
    },

    /** Note: this method will use and modify the entries in `other` */ 
    merge(original: Subtitles, other: Subtitles, options: MergeOptions): SubtitleEntry[] {
        if (options.overrideMetadata) {
            other.metadata = JSON.parse(JSON.stringify(original.metadata));
        }
        
        let overrideStyle: SubtitleStyle;
        if (options.style.type == 'createNewOverride') {
            const name = SubtitleTools.getUniqueStyleName(original, options.style.name);
            const state = $state(SubtitleStyle.new(name));
            original.styles.push(state);
            overrideStyle = state;
        } else {
            overrideStyle = options.style.type == 'override' 
                ? options.style.overrideStyle : original.defaultStyle;
            Debug.assert(original.styles.includes(overrideStyle));
        }

        const styleMap = new Map<SubtitleStyle, SubtitleStyle>();
        const orginalStyleSerialized = original.styles.map((x) => JSON.stringify(x));
        const processStyle = (s: SubtitleStyle) => {
            if (styleMap.has(s)) return styleMap.get(s)!;
            const newStyleSerialized = JSON.stringify(s);
            const iLocalName = original.styles.findIndex((x) => x.name == s.name);
            const iLocalMatch = orginalStyleSerialized.indexOf(newStyleSerialized);

            const add = () => {
                // make sure it is a proxy
                const newStyle = $state(s);
                original.styles.push(newStyle);
                styleMap.set(s, newStyle);
                return newStyle;
            };

            switch (options.style.type) {
                case 'override':
                case 'createNewOverride':
                    Debug.trace('override:', s.name, '->', overrideStyle.name);
                    styleMap.set(s, overrideStyle);
                    return overrideStyle;
                case 'keepAll': {
                    // generate unqiue name
                    const newStyle = $state(SubtitleStyle.clone(s));
                    newStyle.name = SubtitleTools.getUniqueStyleName(original, s.name);
                    original.styles.push(newStyle);
                    styleMap.set(s, newStyle);
                    Debug.trace('KeepAll:', s.name, '->', newStyle.name);
                    return newStyle;
                }
                case 'keepDifferent':
                    if (iLocalMatch >= 0) {
                        styleMap.set(s, original.styles[iLocalMatch]);
                        return styleMap.get(s)!;
                    }
                    return add();
                case 'useLocalByName':
                    if (iLocalName >= 0) {
                        styleMap.set(s, original.styles[iLocalName]);
                        return styleMap.get(s)!;
                    }
                    return add();
                case 'overwrite':
                    if (iLocalName >= 0) {
                        const newStyle = $state(s);
                        if (original.defaultStyle === original.styles[iLocalName])
                            original.defaultStyle = newStyle;
                        original.styles.splice(iLocalName, 1, newStyle);
                        styleMap.set(s, newStyle);
                        return newStyle;
                    }
                    return add();
                default:
                    Debug.never(options.style);
            }
        };
        switch (options.selection) {
            case 'onlyStyles':
            case 'all':
                for (const style of other.styles) processStyle(style);
                break;
            case "usedOnly":
                break;
            default:
                Debug.never(options.selection);
        }

        if (options.selection == 'onlyStyles')
            return [];

        if (options.position.type == 'overwrite')
            original.entries = [];
        let insertEntry: (e: SubtitleEntry) => void;
        let insertIndex = 0;
        switch (options.position.type) {
            case 'sortedBefore':
                insertEntry = (e) => {
                    const i = original.entries.findIndex((x) => x.start >= e.start);
                    original.entries.splice(i, 0, e);
                }; break;
            case 'sortedAfter':
                insertEntry = (e) => {
                    const i = original.entries.findLastIndex((x) => x.start <= e.start);
                    original.entries.splice(i+1, 0, e);
                }; break;
            case 'custom':
                insertIndex = options.position.customPosition;
                // fallthrough
            case 'before':
                insertEntry = (e) => {
                    original.entries.splice(insertIndex, 0, e);
                    insertIndex++;
                }; break;
            case 'after':
            case 'overwrite':
                insertEntry = (e) => {
                    original.entries.push(e);
                }; break;
            default:
                Debug.never(options.position);
        }

        for (const ent of other.entries) {
            insertEntry(ent);
            ent.texts = new SvelteMap([...ent.texts]
                .map(([style, text]) => [processStyle(style), text]));
        }
        return other.entries;
    },

    // first scale, then offset
    shiftTimes(original: Subtitles, options: TimeShiftOptions) {
        const modifySince = options.modifySince ?? false;
        const offset = options.offset ?? 0;
        const scale = options.scale ?? 1;
        if (offset == 0 && scale == 1) return false;
        const selection = options.selection ?? original.entries;
        const set = new Set(selection);
        const start = Math.min(...selection.map((x) => x.start));
        for (const ent of original.entries) {
            if (set.has(ent) || (ent.start >= start && modifySince)) {
                ent.start = Math.max(0, ent.start * scale + offset);
                ent.end = Math.max(0, ent.end * scale + offset);
                // ent.update.dispatch();
            }
        }
        return true;
    }
}