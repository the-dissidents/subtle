import { Basic } from "../Basic";
import { ASSSubtitles } from "./ASS.svelte";
import { JSONSubtitles } from "./JSON.svelte";
import { SRTSubtitles } from "./SRT.svelte";
import { SubtitleEntry, Subtitles, type SubtitleWritableFormat, type SubtitleWriter } from "./Subtitles.svelte";
import { LinearFormatCombineStrategy, SubtitleUtil, type LinearEntry } from "./SubtitleUtil.svelte";

export class SubtitleLinearFormatWriter implements SubtitleWriter {
    #strategy = LinearFormatCombineStrategy.KeepOrder;
    #useEntries?: SubtitleEntry[];

    constructor(
        private source: Subtitles, 
        private generate: (x: LinearEntry[]) => string) {}

    strategy(s: LinearFormatCombineStrategy) {
        this.#strategy = s;
        return this;
    }

    useEntries(e: SubtitleEntry[]) {
        this.#useEntries = e;
        return this;
    }

    toString(): string {
        const linear = SubtitleUtil.combineToLinear(this.source, 
            this.#useEntries ?? this.source.entries, 
            this.#strategy);
        return this.generate(linear);
    }
}

const plaintext = {
    write: (x) => new SubtitleLinearFormatWriter(x, 
        (linear) => linear.map((x) => x.text).join('\n'))
} satisfies SubtitleWritableFormat;

const tabDelimited = {
    write: (x) => new SubtitleLinearFormatWriter(x, 
        (linear) => {
            let result = '';
            for (const entry of linear) {
                result += `${
                    Basic.formatTimestamp(entry.start, 3, '.')}\t${
                        Basic.formatTimestamp(entry.end, 3, '.')}\t${
                    entry.text
                        .replace('\n', '\\N')
                        .replace('\t', '\\T')}\n`;
            }
            return result;
        })
} satisfies SubtitleWritableFormat;

export const Format = {
    ASS: ASSSubtitles,
    SRT: SRTSubtitles,
    JSON: JSONSubtitles,
    plaintext,
    tabDelimited
}