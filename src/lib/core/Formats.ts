import { Basic } from "../Basic";
import { Debug } from "../Debug";
import { ASSSubtitles } from "./ASS.svelte";
import { JSONSubtitles } from "./JSON.svelte";
import { SRTSubtitles } from "./SRT.svelte";
import { type SubtitleFormat } from "./Subtitles.svelte";
import { LinearFormatCombineStrategy, SubtitleUtil } from "./SubtitleUtil.svelte";

const plaintext: SubtitleFormat = {
    parse(source) {
        // TODO perhaps import as untimed text?
        Debug.assert(false);
    },
    write(subs, options) {
        const linear = SubtitleUtil.combineToLinear(subs, 
            options?.useEntries ?? subs.entries, 
            options?.combine ?? LinearFormatCombineStrategy.KeepOrder);
        return linear.map((x) => x.text).join('\n');
    },
}

const tabDelimited: SubtitleFormat = {
    parse(source) {
        // TODO
        Debug.assert(false);
    },
    write(subs, options) {
        const linear = SubtitleUtil.combineToLinear(subs, 
            options?.useEntries ?? subs.entries, 
            options?.combine ?? LinearFormatCombineStrategy.KeepOrder);
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
}

export const Format = {
    ASS: ASSSubtitles,
    SRT: SRTSubtitles,
    JSON: JSONSubtitles,
    plaintext,
    tabDelimited
}