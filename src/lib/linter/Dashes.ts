import type { Diagnostic } from "./Common";
import * as z from "zod/v4-mini";

import { unwrapFunctionStore, _ } from 'svelte-i18n';
const $_ = unwrapFunctionStore(_);

export const DashType = {
    emDash: '—',
    enDash: '–',
    hyphenMinus: '-',
    doubleHyphenMinus: '--',
    fullwidthHyphenMinus: '－',
    horizontalBar: '―'
};

export type DashType = keyof typeof DashType;
export const ZDashType = z.enum(Object.keys(DashType) as DashType[]);

export const CJKDashType = {
    standard: '——',
    unicode: '⸺',
    // 'forbidden' disables long CJK dashes entirely: any long CJK dash is reported.
    forbidden: ''
};

export type CJKDashType = keyof typeof CJKDashType;
export const ZCJKDashType = z.enum(Object.keys(CJKDashType) as CJKDashType[]);

export const DashesConfig = z.object({
    dialog: z.object({
        type: ZDashType,
        spaces: z.boolean(),
        separateLines: z.boolean(),
        reportLoneDash: z.optional(z.boolean()),
        reportMissingDash: z.optional(z.boolean()),
    }),
    dash: z.object({
        type: ZDashType,
        spaces: z.boolean(),
        endOnly: z.boolean(),
    }),
    cjkDash: z.optional(z.object({
        type: ZCJKDashType,
        // whether to check CJK word connectors (hyphens inside foreign names / technical
        // terms, which should be en-dashes); when off, unspaced short dashes in CJK
        // contexts are treated as dialog dashes instead.
        wordConnectors: z._default(z.boolean(), false),
    }))
});

export type DashesConfig = z.infer<typeof DashesConfig>;

// The en-dash is the correct form of a CJK word connector.
const CJK_WORD_CONNECTOR = DashType.enDash;

// Wide CJK punctuations that subsume a following space: a dash right after them is already
// visually spaced on its left, so no missing space should be reported there.
const FOLLOWING_SPACE_SUBSUMING = '、，。；：！？」』';

// Wide CJK punctuations that subsume a preceding space (opening brackets and quotes): a dash
// right before them is already visually spaced on its right, so no missing space should be
// reported there either.
const PRECEDING_SPACE_SUBSUMING = '「『（《【〈';

export class DashLinter {
    constructor(private config: DashesConfig) {}

    private isCJKGlyph(char: string): boolean {
        if (!char) return false;
        const code = char.charCodeAt(0);
        return (
            (code >= 0x4E00 && code <= 0x9FFF) || // CJK Unified Ideographs
            (code >= 0x3400 && code <= 0x4DBF) || // CJK Extension A
            (code >= 0x3040 && code <= 0x309F) || // Hiragana
            (code >= 0x30A0 && code <= 0x30FF) || // Katakana
            (code >= 0xAC00 && code <= 0xD7A3) || // Hangul Syllables
            (code >= 0xFF00 && code <= 0xFFEF)    // Halfwidth and Fullwidth Forms
        );
    }

    private isCJKPunctuation(char: string): boolean {
        if (!char) return false;
        const code = char.charCodeAt(0);
        return (
            (code >= 0x3000 && code <= 0x303F) // CJK Symbols and Punctuation (、。《》 etc.)
        );
    }

    check(entry: string): Diagnostic[] {
        // Classify each dash sequence as a dialog dash, a Latin dash, a (long) CJK dash, or
        // a CJK word connector, then normalize its form and surrounding spaces.
        //
        // - A dash is a *Latin* dash only if both of its (across-whitespace) neighbors are
        //   non-CJK. Otherwise, in a profile that checks CJK dashes, it lives in a CJK context.
        // - Real CJK dashes are always long (never a single em-dash) and never spaced; a short
        //   or spaced dash in a CJK context is therefore a dialog dash, not a broken CJK dash.
        // - Start of line, a space-subsuming punctuation on the left, and a preceding-space-
        //   subsuming punctuation on the right all count as spacing. End of line does not (a
        //   trailing dash can be a real CJK dash).
        // - Unspaced short dashes in a CJK context are ambiguous between dialog dashes and word
        //   connectors; the `wordConnectors` option decides, and neither is reported confidently.
        // - When `cjkDash` is undefined, no CJK logic applies: everything is plain non-CJK text.

        const cjk = this.config.cjkDash;
        const diagnostics: Diagnostic[] = [];
        const dialogRanges: {
            start: number,
            to: number,
            isStartOfLine: boolean,
            confident: boolean
        }[] = [];
        const dashRegex = /([ \t]*)([-－⸺\u2010-\u2015]+)([ \t]*)/g;
        let match;

        while ((match = dashRegex.exec(entry)) !== null) {
            const [fullMatch, leftSpaces, dashChars, rightSpaces] = match;
            const start = match.index;
            const to = start + fullMatch.length;

            const leftContext = entry.substring(0, start);
            const rightContext = entry.substring(to);

            const isStartOfLine = leftContext.length === 0 || leftContext.endsWith('\n');
            const isEndOfLine = rightContext.length === 0
                || rightContext.startsWith('\n') || rightContext.startsWith('\r');

            // Nearest non-space neighbors (leftSpaces/rightSpaces already consumed the spaces).
            const leftChar = leftContext.slice(-1);
            const rightChar = rightContext.slice(0, 1);

            const leftSubsumed = leftChar !== '' && FOLLOWING_SPACE_SUBSUMING.includes(leftChar);
            const rightSubsumed = rightChar !== '' && PRECEDING_SPACE_SUBSUMING.includes(rightChar);

            // Start of line and subsumed punctuation act like spacing on the left; a bare end
            // of line does not count as spacing (trailing CJK dashes are legitimate).
            const spacedLeft = leftSpaces.length > 0 || isStartOfLine || leftSubsumed;
            const spacedRight = rightSpaces.length > 0 || rightSubsumed;
            const spaced = spacedLeft || spacedRight;

            const isLong = dashChars === '⸺' || dashChars.length >= 2;

            // Emit a dialog-dash diagnostic, normalizing the dash form and its surrounding spaces.
            // A left space is never added at the start of a line or right after a space-subsuming
            // punctuation; a right space is never added at the end of a line or right before a
            // preceding-space-subsuming punctuation (in either case it is unavoidable/subsumed).
            const emitDialog = (confident: boolean) => {
                dialogRanges.push({ start, to, isStartOfLine, confident });
                // Only nag about newlines when we are sure this is a dialog dash, to avoid false
                // positives on ambiguous CJK guesses (which might actually be word connectors).
                if (confident && this.config.dialog.separateLines && !isStartOfLine) diagnostics.push({
                    start, to, type: 'format',
                    description: $_('dashlint.dialog-dashes-should-begin-on-a-new-line')
                });

                const expectedChar = DashType[this.config.dialog.type];
                const spaces = this.config.dialog.spaces;

                const expLeftSpace = (isStartOfLine || leftSubsumed) ? '' : (spaces ? ' ' : '');
                const expRightSpace = (isEndOfLine || rightSubsumed) ? '' : (spaces ? ' ' : '');
                const expectedSub = expLeftSpace + expectedChar + expRightSpace;

                if (fullMatch !== expectedSub) diagnostics.push({
                    start, to,
                    type: 'punctuation',
                    description: $_('dashlint.wrong-dialog-dash'),
                    fix: { substitute: expectedSub, confident }
                });
            }

            // A dash at the start of a line is a dialog dash.
            if (isStartOfLine) {
                emitDialog(true);
                continue;
            }

            const cjkContext = cjk !== undefined && (
                   this.isCJKGlyph(leftChar) || this.isCJKPunctuation(leftChar)
                || this.isCJKGlyph(rightChar) || this.isCJKPunctuation(rightChar)
                || dashChars === '——' || dashChars === '⸺');

            if (cjkContext) {
                // We check if both sides are CJK characters
                // If so, the dash is probably a true dash (long) or a word connector (short).
                // These are very rare in CJK subtitles so we can be stricter.

                // FIXME: There're cases where the hyphen-minus `-` is used in place of the middle
                // dot `·` in some old Chinese subtitles, this is not considered yet
                if (!spaced && this.isCJKGlyph(leftChar) && this.isCJKGlyph(rightChar)) {
                    if (isLong) {
                        if (cjk.type === 'forbidden') {
                            diagnostics.push({
                                start, to, type: 'punctuation',
                                description: $_('dashlint.cjk-dashes-forbidden')
                            });
                        } else {
                            const preferred = CJKDashType[cjk.type];
                            if (dashChars !== preferred) diagnostics.push({
                                start, to, type: 'punctuation',
                                description: $_('dashlint.wrong-cjk-dashes', { values: { preferred } }),
                                fix: { substitute: preferred, confident: true }
                            });
                        }
                        continue;
                    }

                    // Short and unspaced: a word connector or a dialog dash
                    // There isn't really a way to reliably distinguish, so not confident.
                    if (cjk.wordConnectors) {
                        // Prefer to report as connectors if enabled
                        if (dashChars !== CJK_WORD_CONNECTOR) diagnostics.push({
                            start, to, type: 'punctuation',
                            description: $_('regexlint.chinese-word-connector'),
                            fix: { substitute: CJK_WORD_CONNECTOR, confident: false }
                        });
                    } else {
                        emitDialog(false);
                    }
                    continue;
                }

                // Spaced dashes in a CJK context are dialog dashes. If it is both short and
                // spaced it certainly cannot be a CJK dash, so we can report it confidently;
                // otherwise (spaced but long, or unspaced and possibly a word connector) we
                // only guess.
                emitDialog(spaced && !isLong);
                continue;
            }

            // Non-CJK (Latin) context below.

            // Skip hyphenated words and standard ranges to avoid false positives.
            // Note: Does not skip double-hyphens (--), as they are strictly non-standard for
            // intra-word usage.
            if ((dashChars === '-' || dashChars === '–')
             && leftSpaces === '' && rightSpaces === ''
             && !isStartOfLine && !isEndOfLine
            ) continue;

            // Determine if the sequence is a dialog dash.
            const sentenceFinal = /[.?!]["'”’]*[ \t]*$/.test(leftContext);
            const capitalNext = /^[ \t]*["'“‘]*[A-Z]/.test(rightContext);
            if (sentenceFinal && capitalNext) {
                emitDialog(true);
                continue;
            }

            // Regular Latin dashes.
            if (this.config.dash.endOnly && !isEndOfLine) diagnostics.push({
                start, to,
                type: 'punctuation',
                description: $_('dashlint.no-midline-dashes')
            }); else {
                const expectedChar = DashType[this.config.dash.type];
                const spaces = this.config.dash.spaces;

                const expLeftSpace = isStartOfLine ? '' : (spaces ? ' ' : '');
                const expRightSpace = isEndOfLine ? '' : (spaces ? ' ' : '');
                const expectedSub = expLeftSpace + expectedChar + expRightSpace;

                if (fullMatch !== expectedSub) diagnostics.push({
                    start, to,
                    type: 'punctuation',
                    description: $_('dashlint.wrong-dash'),
                    fix: { substitute: expectedSub, confident: true }
                });
            }
        }

        // A dash at the very beginning of the entry marks the only speaker, so a single dialog
        // dash there is redundant: we report it and propose to remove it when asked. A single
        // dialog dash anywhere else means the entry starts without introducing the first
        // speaker: that is a missing dash at the beginning, handled below. Note that a dash at
        // the start of a *line* is not a lone dash when other lines precede it.
        if (this.config.dialog.reportLoneDash && dialogRanges.length === 1) {
            const { start, to } = dialogRanges[0];
            if (start === 0) diagnostics.push({
                start, to,
                type: 'punctuation',
                description: $_('dashlint.single-dialog-dash'),
                fix: { substitute: '', confident: true }
            });
        }

        // When dialog dashes are present but the entry itself does not begin with one, the
        // first speaker is missing their dash. Propose to insert it before the entry's text.
        // Only do this when at least one dialog dash was recognized confidently, since
        // ambiguous CJK dashes may actually be word connectors.
        const startsWithDash = dialogRanges.some((x) => x.start === 0);
        if (this.config.dialog.reportMissingDash
         && !startsWithDash
         && dialogRanges.some((x) => x.confident)) {
            const insertAt = /^[ \t]*/.exec(entry)![0].length;
            const expectedChar = DashType[this.config.dialog.type];
            const rightChar = entry.slice(insertAt, insertAt + 1);
            const rightSubsumed = rightChar !== ''
                && PRECEDING_SPACE_SUBSUMING.includes(rightChar);
            const expectedSub = expectedChar
                + ((this.config.dialog.spaces && !rightSubsumed) ? ' ' : '');
            diagnostics.push({
                start: insertAt, to: insertAt,
                type: 'punctuation',
                description: $_('dashlint.missing-dialog-dash'),
                fix: { substitute: expectedSub, confident: true }
            });
        }

        return diagnostics;
    }
}
