import type { Subtitles } from "../Subtitles.svelte";


export interface SubtitleWritableFormat {
    write(subs: Subtitles): SubtitleWriter;
}

export interface SubtitleParseMessage {
    type: string;
    category: string;
}

export interface SubtitleParsableFormat {
    /**
     * Detects if a source is of this format. Returns `null` if uncertain.
     */
    detect(source: string | Uint8Array): boolean | null;

    /**
     * Attempt to create a parser for the source. If a fatal error occurs while parsing a subtitle, throws an error.
     */
    parse(source: string | Uint8Array): SubtitleParser | Promise<SubtitleParser>;
}

export type SubtitleFormat = SubtitleWritableFormat & SubtitleParsableFormat;
/**
 * Upon creation by `SubtitleParsableFormat.parse(source)`, a SubtitleParser should load a subtitle file but not necessarily decode all of it. It may provide fields or methods to change its settings, since `parse` doesn't provide any options. Call `decode` to decode the file and get any parse messages.
 */

export interface SubtitleParser {
    decode(): SubtitleParseResult | Promise<SubtitleParseResult>;
}
interface SubtitleParseResult {
    messages: SubtitleParseMessage[];
    subs: Subtitles;
}

export interface SubtitleWriter {
    toString(): string;
}
