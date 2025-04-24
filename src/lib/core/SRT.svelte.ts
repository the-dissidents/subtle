import { Basic } from "../Basic";
import { SubtitleEntry, Subtitles, SubtitlesParseError, type SubtitleFormat } from "./Subtitles.svelte";
import { LinearFormatCombineStrategy, SubtitleUtil } from "./SubtitleUtil.svelte";

function getTime(h: string, m: string, s: string, ms: string) {
    return Number.parseInt(h) * 3600 
         + Number.parseInt(m) * 60 
         + Number.parseInt(s) 
         + Number.parseInt(ms) * 0.001;
}

export const SRTSubtitles: SubtitleFormat = {
    /**
     * This is an exact clone of the algorithm in `srtdec.c` in libavformat.
     * Reference: https://ffmpeg.org/doxygen/6.1/libavformat_2srtdec_8c_source.html
     */
    parse(source) {
        const timeRegex = /^\s*(\d+):(\d+):(\d+)[,.](\d+) --> (\d+):(\d+):(\d+)[,.](\d+)(?:\s+X1:(-?\d+) X2:(-?\d+) Y1:(-?\d+) Y2:(-?\d+))?\s*$/;

        let buffer = '';
        let line_cache = '';
        let start: number = -1, end: number = -1;
        const subs = new Subtitles();

        const lines = source.split(/\r?\n/);
        for (const line of lines) {
            if (line.length == 0) continue;
            const times = timeRegex.exec(line);
            if (times) {
                if (start >= 0) {
                    const standalone_number = /^\d+$/.test(line_cache);
                    if (standalone_number && buffer.length == 0)
                        buffer = line_cache;
                    line_cache = '';

                    while (buffer.at(-1) == '\n')
                        buffer = buffer.substring(0, buffer.length - 1);
                    if (buffer.length > 0) {
                        const entry = new SubtitleEntry(start, end);
                        entry.texts.set(subs.defaultStyle, buffer);
                        subs.entries.push(entry);
                        buffer = '';
                    }
                }
                // read times
                start = getTime(times[1], times[2], times[3], times[4]);
                end = getTime(times[5], times[6], times[7], times[8]);
                // TODO: read the coordinates
            } else {
                if (start < 0) continue;
                if (line_cache.length > 0) {
                    buffer += line_cache + '\n';
                    line_cache = '';
                }
                if (/^\s*\d+/.test(line)) {
                    line_cache = line;
                } else {
                    buffer += line + '\n';
                }
            }
        }

        if (start >= 0) {
            if (line_cache.length > 0)
                buffer = line_cache;
    
            while (buffer.at(-1) == '\n')
                buffer = buffer.substring(0, buffer.length - 1);
            if (buffer.length > 0) {
                const entry = new SubtitleEntry(start, end);
                entry.texts.set(subs.defaultStyle, buffer);
                subs.entries.push(entry);
                buffer = '';
            }
        } else {
            throw new SubtitlesParseError('invalid or empty SRT');
        }
        
        subs.migrated = 'text';
        return subs;
    },
    write(subs, options) {
        const linear = SubtitleUtil.combineToLinear(subs, 
            options?.useEntries ?? subs.entries, 
            options?.combine ?? LinearFormatCombineStrategy.KeepOrder);
        let result = linear.map((ent, i) => `${i+1}\n${
            Basic.formatTimestamp(ent.start, 3, ',')} --> ${
            Basic.formatTimestamp(ent.start, 3, ',')}\n${ent.text}`);
        return result.join('\n\n');
    },
};