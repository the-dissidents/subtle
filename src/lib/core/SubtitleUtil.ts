import deepEqual from "deep-equal";
import { type SubtitleStyle, SubtitleEntry, Subtitles } from "./Subtitles.svelte";
import { assert } from "../Basic";

export enum MergeStyleSelection {
    UsedOnly,
    All,
    OnlyStyles
}

export enum MergeStyleBehavior {
    KeepAll,
    KeepDifferent,
    UseLocalByName,
    Overwrite,
    UseOverrideForAll
}

export enum MergePosition {
    SortedBefore, SortedAfter,
    Before, After, Overwrite, Custom
}

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

        let styleMap = new Map<SubtitleStyle, SubtitleStyle>();
        let processStyle = (s: SubtitleStyle) => {
            if (styleMap.has(s)) return styleMap.get(s)!;
            let iLocal = original.styles.findIndex((x) => x.name == s.name);
            if (iLocal < 0) {
                original.styles.push(s);
                styleMap.set(s, s);
                return s;
            } else switch (options.style ?? MergeStyleBehavior.KeepDifferent) {
                case MergeStyleBehavior.KeepDifferent:
                    if (deepEqual(s, original.styles[iLocal])) {
                        styleMap.set(s, original.styles[iLocal]);
                        return styleMap.get(s)!;
                    } // else, fallthrough
                case MergeStyleBehavior.KeepAll:
                    // generate unqiue name
                    let newStyle = structuredClone(s);
                    newStyle.name = SubtitleTools.getUniqueStyleName(original, s.name);
                    original.styles.push(newStyle);
                    styleMap.set(s, newStyle);
                    return newStyle;
                case MergeStyleBehavior.UseLocalByName:
                    styleMap.set(s, original.styles[iLocal]);
                    return styleMap.get(s)!;
                case MergeStyleBehavior.Overwrite:
                    if (original.defaultStyle === original.styles[iLocal])
                        original.defaultStyle = s;
                    original.styles.splice(iLocal, 1, s);
                    styleMap.set(s, s);
                    return s;
                case MergeStyleBehavior.UseOverrideForAll:
                    styleMap.set(s, options.overrideStyle ?? original.defaultStyle);
                    return styleMap.get(s)!;
                default:
                    assert(false);
            }
        };
        if (options.selection) switch (options.selection) {
            case MergeStyleSelection.OnlyStyles:
            case MergeStyleSelection.All:
                for (let style of other.styles) processStyle(style);
                break;
        }

        if (options.selection == MergeStyleSelection.OnlyStyles)
            return [];

        let position = options.position ?? MergePosition.After;
        if (position == MergePosition.Overwrite)
            original.entries = [];
        let insertEntry: (e: SubtitleEntry) => void;
        let index = options.customPosition ?? 0;
        switch (position) {
            case MergePosition.SortedBefore:
                insertEntry = (e) => {
                    let i = original.entries.findIndex((x) => x.start >= e.start);
                    original.entries.splice(i, 0, e);
                }; break;
            case MergePosition.SortedAfter:
                insertEntry = (e) => {
                    let i = original.entries.findLastIndex((x) => x.start <= e.start);
                    original.entries.splice(i+1, 0, e);
                }; break;
            case MergePosition.Before:
            case MergePosition.Custom:
                insertEntry = (e) => {
                    original.entries.splice(index, 0, e);
                    index++;
                }; break;
            case MergePosition.After:
            case MergePosition.Overwrite:
                insertEntry = (e) => {
                    original.entries.push(e);
                }; break;
            default: assert(false);
        }

        for (let ent of other.entries) {
            insertEntry(ent);
            let newTexts: [SubtitleStyle, string][] = [];
            for (let [style, text] of ent.texts)
                newTexts.push([processStyle(style), text]);
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