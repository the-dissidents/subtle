import { SvelteMap } from "svelte/reactivity";
import { Debug } from "../Debug";
import { type SubtitleStyle, SubtitleEntry, Subtitles } from "./Subtitles.svelte";

export type MergeStyleSelection =
    'UsedOnly' | 'All' | 'OnlyStyles';

export type MergeStyleBehavior = 
    'KeepAll' | 'KeepDifferent' | 'UseLocalByName' | 'Overwrite' | 'UseOverrideForAll';

export type MergePosition =
    'SortedBefore' | 'SortedAfter' |
    'Before' | 'After' | 'Overwrite' | 'Custom';

export type MergeOptions = {
    style?: MergeStyleBehavior;
    overrideStyle?: SubtitleStyle;
    selection?: MergeStyleSelection;
    position?: MergePosition;
    customPosition?: number;
    overrideMetadata?: boolean;
};

export type TimeShiftOptions = {
    selection?: SubtitleEntry[];
    modifySince?: boolean;
    offset?: number;
    scale?: number;
};export const SubtitleTools = {
    alignTimes: (subs: Subtitles, epsilon: number) => {
        for (let i = 0; i < subs.entries.length - 1; i++) {
            let s0 = subs.entries[i].start;
            let e0 = subs.entries[i].end;
            for (let j = i + 1; j < subs.entries.length; j++) {
                let s1 = subs.entries[j].start;
                let e1 = subs.entries[j].end;
                if (Math.abs(s1 - s0) <= epsilon)
                    subs.entries[j].start = s0;
                if (Math.abs(e1 - e0) <= epsilon)
                    subs.entries[j].end = e0;
            }
        }
    },
    makeTestSubtitles: () => {
        let subs = new Subtitles();
        for (let i = 0; i < 10; i++) {
            let entry = new SubtitleEntry(i * 5, i * 5 + 5);
            entry.texts.set(subs.defaultStyle, `测试第${i}行`);
            subs.entries.push(entry);
        }
        return subs;
    },
    getUniqueStyleName: (subs: Subtitles, base: string) => {
        let i = 1;
        let newName = base;
        while (subs.styles.find((x) => x.name == newName)) {
            newName = base + `_${i}`;
            i++;
        }
        return newName;
    }
};



export const SubtitleUtil = {
    /** Note: this method will use and modify the entries in `other` */ 
    merge(original: Subtitles, other: Subtitles, options: MergeOptions): SubtitleEntry[] {
        if (options.overrideMetadata) {
            other.metadata = JSON.parse(JSON.stringify(original.metadata));
        }
        console.log(options);

        const styleMap = new Map<SubtitleStyle, SubtitleStyle>();
        const overrideStyle = options.overrideStyle ?? original.defaultStyle;
        Debug.assert(original.styles.includes(overrideStyle));
        const orginalStyleSerialized = original.styles.map((x) => JSON.stringify(x));
        let processStyle = (s: SubtitleStyle) => {
            if (styleMap.has(s)) return styleMap.get(s)!;
            const newStyleSerialized = JSON.stringify(s);
            let iLocalName = original.styles.findIndex((x) => x.name == s.name);
            let iLocalMatch = orginalStyleSerialized.indexOf(newStyleSerialized);

            const add = () => {
                // make sure it is a proxy
                let newStyle = $state(s);
                original.styles.push(newStyle);
                styleMap.set(s, newStyle);
                return newStyle;
            };

            switch (options.style ?? 'KeepDifferent') {
                case 'UseOverrideForAll':
                    console.log('UseOverrideForAll:', 
                        $state.snapshot(s), '->', $state.snapshot(overrideStyle));
                    styleMap.set(s, overrideStyle);
                    return overrideStyle;
                case 'KeepAll':
                    // generate unqiue name
                    {
                        let newStyle = $state($state.snapshot(s));
                        newStyle.name = SubtitleTools.getUniqueStyleName(original, s.name);
                        original.styles.push(newStyle);
                        styleMap.set(s, newStyle);
                        console.log('KeepAll:', 
                            $state.snapshot(s), '->', $state.snapshot(newStyle));
                        return newStyle;
                    }
                case 'KeepDifferent':
                    if (iLocalMatch >= 0) {
                        styleMap.set(s, original.styles[iLocalMatch]);
                        return styleMap.get(s)!;
                    }
                    return add();
                case 'UseLocalByName':
                    if (iLocalName >= 0) {
                        styleMap.set(s, original.styles[iLocalName]);
                        return styleMap.get(s)!;
                    }
                    return add();
                case 'Overwrite':
                    if (iLocalName >= 0) {
                        let newStyle = $state(s);
                        if (original.defaultStyle === original.styles[iLocalName])
                            original.defaultStyle = newStyle;
                        original.styles.splice(iLocalName, 1, newStyle);
                        styleMap.set(s, newStyle);
                        return newStyle;
                    }
                    return add();
                default:
                    Debug.assert(false);
            }
        };
        if (options.selection) switch (options.selection) {
            case 'OnlyStyles':
            case 'All':
                for (let style of other.styles) processStyle(style);
                break;
        }

        if (options.selection == 'OnlyStyles')
            return [];

        let position = options.position ?? 'After';
        if (position == 'Overwrite')
            original.entries = [];
        let insertEntry: (e: SubtitleEntry) => void;
        let index = options.customPosition ?? 0;
        switch (position) {
            case 'SortedBefore':
                insertEntry = (e) => {
                    let i = original.entries.findIndex((x) => x.start >= e.start);
                    original.entries.splice(i, 0, e);
                }; break;
            case 'SortedAfter':
                insertEntry = (e) => {
                    let i = original.entries.findLastIndex((x) => x.start <= e.start);
                    original.entries.splice(i+1, 0, e);
                }; break;
            case 'Before':
            case 'Custom':
                insertEntry = (e) => {
                    original.entries.splice(index, 0, e);
                    index++;
                }; break;
            case 'After':
            case 'Overwrite':
                insertEntry = (e) => {
                    original.entries.push(e);
                }; break;
            default:
                Debug.never(position);
        }

        for (let ent of other.entries) {
            insertEntry(ent);
            let newTexts: [SubtitleStyle, string][] = [];
            for (let [style, text] of ent.texts)
                newTexts.push([processStyle(style), text]);
            ent.texts = new SvelteMap(newTexts);
        }
        return other.entries;
    },

    // first scale, then offset
    shiftTimes(original: Subtitles, options: TimeShiftOptions) {
        let modifySince = options.modifySince ?? false;
        let offset = options.offset ?? 0;
        let scale = options.scale ?? 1;
        if (offset == 0 && scale == 1) return false;
        let selection = options.selection ?? original.entries;
        let set = new Set(selection);
        let start = Math.min(...selection.map((x) => x.start));
        for (let ent of original.entries) {
            if (set.has(ent) || (ent.start >= start && modifySince)) {
                ent.start = Math.max(0, ent.start * scale + offset);
                ent.end = Math.max(0, ent.end * scale + offset);
                // ent.update.dispatch();
            }
        }
        return true;
    }
}