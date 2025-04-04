import { Basic } from "../Basic";
import { Debug } from "../Debug";
import { SubtitleEntry, Subtitles } from "./Subtitles.svelte";

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

type LinearEntry = {
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
            let events: { type: 'start' | 'end', pos: number, i: number }[] = [];
            entries.forEach(({start, end}, i) => {
                events.push({ type: 'start', pos: start, i });
                events.push({ type: 'end', pos: end, i });
            });
            events.sort((a, b) => a.pos - b.pos);
            if (events.length == 0) return [];

            let activeTexts: {i: number, text: string}[] = [];
            let result: LinearEntry[] = [];
            let i = 0;
            outer: while (true) {
                const pos = events[i].pos;
                while (events[i].pos == pos) {
                    const event = events[i];
                    if (event.type == 'start') {
                        const entry = entries[event.i];
                        let text = subs.styles
                            .map((s) => entry.texts.get(s))
                            .filter((x) => x).join('\n');
                        activeTexts.push({text, i: event.i});
                    } else {
                        let index = activeTexts.findIndex((x) => x.i == event.i);
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

export const SimpleFormats = {
    parse: {
        JSON(source: string) {
            try {
                let result = Subtitles.deserialize(JSON.parse(source));
                return result;
            } catch (e: any) {
                console.log('note: failed importing json', e);
                return null;
            }
        },
        SRT_VTT(source: string) {
            const regex = 
                /(?:\n|^)(\d+:\d+:\d+[,.]\d+)\s-->\s(\d+:\d+:\d+[,.]\d+)\s*\n((?:.+\n)*.+)(?:\n|$)/g;
            let matches = [...source.matchAll(regex)];
            if (matches.length == 0) return null;
            // console.log(matches);
    
            let subs = new Subtitles();
            for (let match of matches) {
                let start = Basic.parseTimestamp(match[1]),
                    end = Basic.parseTimestamp(match[2]);
                if (start === null || end === null) continue;
                let entry = new SubtitleEntry(start, end);
                entry.texts.set(subs.defaultStyle, match[3].trimEnd());
                subs.entries.push(entry)
            }
            return subs;
        }
    } as const,
    export: {
        JSON(subs: Subtitles) {
            return JSON.stringify(subs.toSerializable());
        },
        SRT(subs: Subtitles, entries: SubtitleEntry[], strategy: LinearFormatCombineStrategy) {
            const linear = ToLinearFormat[strategy](subs, entries);
            let result = '', i = 1;
            for (let entry of linear) {
                result += `${i}\n${
                    Basic.formatTimestamp(entry.start, 3, ',')} --> ${
                    Basic.formatTimestamp(entry.end, 3, ',')}\n${entry.text}\n\n`;
                i += 1;
            }
            return result;
        },
        tabDelimited(
            subs: Subtitles, entries: SubtitleEntry[], 
            strategy: LinearFormatCombineStrategy
        ) {
            const linear = ToLinearFormat[strategy](subs, entries);
            let result = '', i = 1;
            for (let entry of linear) {
                result += `${
                    Basic.formatTimestamp(entry.start, 3, '.')}\t${
                        Basic.formatTimestamp(entry.end, 3, '.')}\t${
                    entry.text
                        .replace('\n', '\\N')
                        .replace('\t', '\\T')}\n`;
                i += 1;
            }
            return result;
        },
        /**
         * Plain text of lines, without times.
         */
        plaintext(
            subs: Subtitles, entries: SubtitleEntry[], 
            strategy: LinearFormatCombineStrategy
        ) {
            const linear = ToLinearFormat[strategy](subs, entries);
            return linear.map((x) => x.text).join('\n');
        }
    } as const
};