import type { BackendSubtitleData } from "$lib/API";
import { Basic } from "$lib/Basic";
import { Debug } from "$lib/Debug";
import { SubtitleEntry, Subtitles } from "../Subtitles.svelte";
import { ASSParser } from "./ASS.svelte";

export function convertBackendSubtitles(data: BackendSubtitleData) {
    if (data.header) {
        // ASS
        let source = data.header.trim();
        for (const { start, end, rects } of data.entries)
        for (const rect of rects) {
            if (rect.type == 'ass') {
                const t0 = Basic.formatTimestamp(start, 2);
                const t1 = Basic.formatTimestamp(end, 2);
                source += '\n' +
                    rect.content.replace(/^\d+,(\d+),/, (_, layer) => `Dialogue: ${layer},${t0},${t1},`);
            }
        }
        const result = new ASSParser(source).decode();
        void Debug.trace(result.messages);
        return result.subs;
    } else {
        // text?
        const subs = new Subtitles();
        for (const { start, end, rects } of data.entries)
        for (const rect of rects) {
            if (rect.type == 'text') {
                const entry = new SubtitleEntry(start, end);
                entry.texts.set(subs.defaultStyle, rect.content);
                subs.entries.push(entry);
            }
        }
        return subs.entries.length > 0 ? subs : null;
    }
}
