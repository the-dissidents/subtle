import type { SubtitleEntry } from "../core/Subtitles.svelte";
import { RichText } from "../core/RichText";

export type MergedUnit = {
    ids: number[],
    text: string,
    durations: number[]
};

function getEntryText(entry: SubtitleEntry): string {
    const first = entry.texts.values().next();
    if (first.done) return '';
    return RichText.toString(first.value);
}

function hasTrailingEllipsis(text: string): boolean {
    const trimmed = text.trimEnd();
    return trimmed.endsWith('...') || trimmed.endsWith('\u2026');
}

function hasLeadingLowercase(text: string): boolean {
    const trimmed = text.trimStart();
    if (trimmed.length === 0) return false;
    const ch = trimmed[0];
    return ch >= 'a' && ch <= 'z';
}

const QUOTE_PAIRS: [string, string][] = [
    ['"', '"'],
    ['\u201C', '\u201D'],
    ['\u2018', '\u2019'],
    ['\u00AB', '\u00BB'],
];

function hasUnclosedQuote(text: string): boolean {
    for (const [open, close] of QUOTE_PAIRS) {
        let depth = 0;
        for (const ch of text) {
            if (ch === open) depth++;
            else if (ch === close && depth > 0) depth--;
        }
        if (depth > 0) return true;
    }
    return false;
}

export function shouldMergeWithNext(currentText: string, nextText: string): boolean {
    return hasTrailingEllipsis(currentText)
        || hasLeadingLowercase(nextText)
        || hasUnclosedQuote(currentText);
}

function cleanBoundaryEllipsis(text: string): string {
    let t = text;
    const leading = t.trimStart();
    if (leading.startsWith('...')) t = leading.slice(3);
    else if (leading.startsWith('\u2026')) t = leading.slice(1);

    const trailing = t.trimEnd();
    if (trailing.endsWith('...')) t = trailing.slice(0, -3);
    else if (trailing.endsWith('\u2026')) t = trailing.slice(0, -1);

    return t.trim();
}

export function mergeTexts(texts: string[]): string {
    return texts
        .map(t => cleanBoundaryEllipsis(t))
        .filter(t => t.length > 0)
        .join(' ');
}

export function mergeEntries(entries: SubtitleEntry[]): MergedUnit[] {
    if (entries.length === 0) return [];

    const result: MergedUnit[] = [];
    let groupIds: number[] = [0];
    let groupTexts: string[] = [getEntryText(entries[0])];
    let groupDurations: number[] = [entries[0].end - entries[0].start];

    for (let i = 1; i < entries.length; i++) {
        const prevText = getEntryText(entries[i - 1]);
        const currText = getEntryText(entries[i]);

        if (shouldMergeWithNext(prevText, currText)) {
            groupIds.push(i);
            groupTexts.push(currText);
            groupDurations.push(entries[i].end - entries[i].start);
        } else {
            result.push({
                ids: groupIds,
                text: mergeTexts(groupTexts),
                durations: groupDurations
            });
            groupIds = [i];
            groupTexts = [currText];
            groupDurations = [entries[i].end - entries[i].start];
        }
    }

    result.push({
        ids: groupIds,
        text: mergeTexts(groupTexts),
        durations: groupDurations
    });

    return result;
}

export function splitTranslation(unit: MergedUnit, translatedText: string): string[] {
    const { durations } = unit;
    if (durations.length <= 1) return [translatedText];

    const totalDuration = durations.reduce((a, b) => a + b, 0);
    if (totalDuration <= 0) {
        const even = Math.ceil(translatedText.length / durations.length);
        return durations.map((_, i) =>
            translatedText.slice(i * even, (i + 1) * even)
        );
    }

    const totalLen = translatedText.length;
    const parts: string[] = [];
    let offset = 0;
    let cumulative = 0;

    for (let i = 0; i < durations.length - 1; i++) {
        cumulative += durations[i];
        const splitIndex = Math.round((cumulative / totalDuration) * totalLen);
        parts.push(translatedText.slice(offset, splitIndex));
        offset = splitIndex;
    }

    parts.push(translatedText.slice(offset));
    return parts;
}
