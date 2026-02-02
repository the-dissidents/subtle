import { Basic } from "../Basic";
import { Debug } from "../Debug";
import { DeserializationError } from "../Serialization";
import { ASSString } from "./ASSString";
import { HTMLString, type HTMLStringWarnings } from "./HTMLString";
import { RichText } from "./RichText";
import { SubtitleLinearFormatWriter } from "./SimpleFormats";
import { SubtitleEntry, Subtitles, type SubtitleFormat, type SubtitleParser } from "./Subtitles.svelte";

function getTime(h: string, m: string, s: string, ms: string) {
    return Number.parseInt(h) * 3600 
         + Number.parseInt(m) * 60 
         + Number.parseInt(s) 
         + Number.parseInt(ms) * 0.001;
}

const timeRegex = /^\s*(\d+):(\d+):(\d+)[,.](\d+) --> (\d+):(\d+):(\d+)[,.](\d+)(?:\s+X1:(-?\d+) X2:(-?\d+) Y1:(-?\d+) Y2:(-?\d+))?\s*$/m;

export type SRTParseMessage = {
    type: 'ignored-format-tag',
    category: 'ignored',
    name: string,
    occurrence: number,
} | {
    type: 'ignored-coordinates',
    category: 'ignored',
    occurrence: number
} | {
    type: 'ignored-special-character',
    category: 'ignored',
    name: string,
    occurrence: number
} | {
    type: 'invalid-color-name',
    category: 'ignored',
    occurrence: number
} | {
    type: 'unsupported-override-tag',
    category: 'ignored',
    name: string,
    occurrence: number,
} ;

export class SRTParser implements SubtitleParser {
    #subs: Subtitles;
    #messages: SRTParseMessage[] = [];
    #ignoredCoords = 0;
    #parsed = false;

    constructor(private source: string) {
        this.#subs = new Subtitles();
    }

    /**
     * This is an exact clone of the algorithm in `srtdec.c`, in libavformat.
     * Reference: https://ffmpeg.org/doxygen/6.1/libavformat_2srtdec_8c_source.html
     */
    update() {
        this.#subs = new Subtitles();
        this.#ignoredCoords = 0;
        this.#messages = [];
        this.#parsed = true;

        let buffer = '';
        let line_cache = '';
        let start: number = -1, end: number = -1;
        const lines = this.source.split('\n');

        const warnings: HTMLStringWarnings = {
            ignoredTags: new Map(),
            invalidColor: 0,
            ignoredSpecialCharacter: new Map()
        };

        const submit = () => {
            while (buffer.at(-1) == '\n')
                buffer = buffer.substring(0, buffer.length - 1);
            if (buffer.length > 0) {
                const entry = new SubtitleEntry(start, end);
                const parsed = HTMLString.parse(buffer, this.#subs.defaultStyle, warnings);
                entry.texts.set(this.#subs.defaultStyle, parsed);
                this.#subs.entries.push(entry);
                buffer = '';
            }
        };

        for (const line of lines) {
            if (line.length == 0) continue;
            const times = timeRegex.exec(line);
            if (times) {
                if (start >= 0) {
                    const standalone_number = /^\d+$/.test(line_cache);
                    if (!standalone_number && buffer.length == 0)
                        buffer = line_cache;
                    line_cache = '';
                    submit();
                }
                // read times
                start = getTime(times[1], times[2], times[3], times[4]);
                end = getTime(times[5], times[6], times[7], times[8]);
                
                if (times[9]) {
                    // we do not support coordinates
                    this.#ignoredCoords++;
                }
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
            submit();
        } else {
            throw new DeserializationError('invalid or empty SRT');
        }
        
        this.#subs.migrated = 'text';
        if (this.#ignoredCoords > 0) this.#messages.push({
            type: 'ignored-coordinates',
            category: 'ignored',
            occurrence: this.#ignoredCoords
        });
        if (warnings.invalidColor > 0) this.#messages.push({
            type: 'invalid-color-name',
            category: 'ignored',
            occurrence: warnings.invalidColor
        });
        for (const [name, occurrence] of warnings.ignoredTags) this.#messages.push({
            type: 'ignored-format-tag',
            category: 'ignored',
            name, occurrence
        });
        for (const [name, occurrence] of warnings.ignoredSpecialCharacter) this.#messages.push({
            type: 'ignored-special-character',
            category: 'ignored',
            name, occurrence
        });
    }

    done() {
        if (!this.#parsed) this.update();
        return this.#subs;
    }

    get messages() {
        return this.#messages;
    }
}

export const SRTSubtitles = {
    detect(source) {
        return timeRegex.test(source) ? null : false;
    },
    parse: (source) => new SRTParser(source),
    
    // TODO: emit a warning if any text line contains timeRegex
    write: (subs) => new SubtitleLinearFormatWriter(subs, 
        (linear) => linear
            .filter((x) => x.text.trim().length > 0)
            .map((ent, i) => `${i+1}\n${
                Basic.formatTimestamp(ent.start, 3, ',')} --> ${
                Basic.formatTimestamp(ent.end, 3, ',')}\n${ent.text}`)
            .join('\n\n'))
} satisfies SubtitleFormat;