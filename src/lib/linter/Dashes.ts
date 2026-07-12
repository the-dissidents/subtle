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
        separateLines: z.boolean()
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

// Wide CJK punctuations that subsume a following space, so a dash right after them is
// effectively spaced and no missing space should be reported there.
const SPACE_SUBSUMING = '、，。；：！？';

export class DashLinter {
    constructor(private config: DashesConfig) {}

    private isCJKChar(char: string): boolean {
        if (!char) return false;
        const code = char.charCodeAt(0);
        return (
            (code >= 0x4E00 && code <= 0x9FFF) || // CJK Unified Ideographs
            (code >= 0x3400 && code <= 0x4DBF) || // CJK Extension A
            (code >= 0x3000 && code <= 0x303F) || // CJK Symbols and Punctuation (、。《》 etc.)
            (code >= 0x3040 && code <= 0x309F) || // Hiragana
            (code >= 0x30A0 && code <= 0x30FF) || // Katakana
            (code >= 0xAC00 && code <= 0xD7A3) || // Hangul Syllables
            (code >= 0xFF00 && code <= 0xFFEF)    // Halfwidth and Fullwidth Forms
        );
    }

    // Emit a dialog-dash diagnostic, normalizing the dash form and its surrounding spaces.
    // A left space is never added at the start of a line or right after a space-subsuming
    // punctuation (it is unavoidable/subsumed); likewise no right space at the end of a line.
    private emitDialog(
        diagnostics: Diagnostic[],
        start: number, to: number, fullMatch: string,
        isStartOfLine: boolean, isEndOfLine: boolean, leftSubsumed: boolean,
        confident: boolean
    ): void {
        // Only nag about newlines when we are sure this is a dialog dash, to avoid false
        // positives on ambiguous CJK guesses (which might actually be word connectors).
        if (confident && this.config.dialog.separateLines && !isStartOfLine) diagnostics.push({
            start, to, type: 'format',
            description: $_('dashlint.dialog-dashes-should-begin-on-a-new-line')
        });

        const expectedChar = DashType[this.config.dialog.type];
        const spaces = this.config.dialog.spaces;

        const expLeftSpace = (isStartOfLine || leftSubsumed) ? '' : (spaces ? ' ' : '');
        const expRightSpace = isEndOfLine ? '' : (spaces ? ' ' : '');
        const expectedSub = expLeftSpace + expectedChar + expRightSpace;

        if (fullMatch !== expectedSub) diagnostics.push({
            start, to,
            type: 'punctuation',
            description: $_('dashlint.wrong-dialog-dash'),
            fix: { substitute: expectedSub, confident }
        });
    }

    check(entry: string): Diagnostic[] {
        // Classify each dash sequence as a dialog dash, a Latin dash, a (long) CJK dash, or
        // a CJK word connector, then normalize its form and surrounding spaces.
        //
        // - A dash is a *Latin* dash only if both of its (across-whitespace) neighbors are
        //   non-CJK. Otherwise, in a profile that checks CJK dashes, it lives in a CJK context.
        // - Real CJK dashes are always long (never a single em-dash) and never spaced; a short
        //   or spaced dash in a CJK context is therefore a dialog dash, not a broken CJK dash.
        // - Start of line, and (as spacing) right after a space-subsuming punctuation, count the
        //   same as being spaced. End of line does not (a trailing dash can be a real CJK dash).
        // - Unspaced short dashes in a CJK context are ambiguous between dialog dashes and word
        //   connectors; the `wordConnectors` option decides, and neither is reported confidently.
        // - When `cjkDash` is undefined, no CJK logic applies: everything is plain non-CJK text.

        const cjk = this.config.cjkDash;
        const diagnostics: Diagnostic[] = [];
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

            const leftSubsumed = leftChar !== '' && SPACE_SUBSUMING.includes(leftChar);
            // Start of line and subsumed punctuation act like spacing on the left; a bare end
            // of line does not count as spacing (trailing CJK dashes are legitimate).
            const spacedLeft = leftSpaces.length > 0 || isStartOfLine || leftSubsumed;
            const spacedRight = rightSpaces.length > 0;
            const spaced = spacedLeft || spacedRight;

            const isLong = dashChars === '⸺' || dashChars.length >= 2;

            const cjkContext = cjk !== undefined && (
                this.isCJKChar(leftChar) || this.isCJKChar(rightChar)
                || dashChars === '——' || dashChars === '⸺');

            if (cjkContext) {
                // A dash at the start of a line is a dialog dash.
                if (isStartOfLine) {
                    this.emitDialog(diagnostics, start, to, fullMatch,
                        isStartOfLine, isEndOfLine, leftSubsumed, true);
                    continue;
                }

                // Unspaced dashes: could be a real CJK dash (long) or a word connector (short).
                if (!spaced) {
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

                    // Short and unspaced: a word connector if enabled, else a dialog dash.
                    // Either way we cannot be sure, so do not report confidently.
                    if (cjk.wordConnectors) {
                        if (dashChars !== CJK_WORD_CONNECTOR) diagnostics.push({
                            start, to, type: 'punctuation',
                            description: $_('regexlint.chinese-word-connector'),
                            fix: { substitute: CJK_WORD_CONNECTOR, confident: false }
                        });
                    } else {
                        this.emitDialog(diagnostics, start, to, fullMatch,
                            isStartOfLine, isEndOfLine, leftSubsumed, false);
                    }
                    continue;
                }

                // Spaced dashes in a CJK context are dialog dashes. If it is both short and
                // spaced it certainly cannot be a CJK dash, so we can report it confidently;
                // otherwise (spaced but long) we only guess.
                this.emitDialog(diagnostics, start, to, fullMatch,
                    isStartOfLine, isEndOfLine, leftSubsumed, !isLong);
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
            let isDialog = isStartOfLine;
            if (!isDialog) {
                const sentenceFinal = /[.?!]["'”’]*[ \t]*$/.test(leftContext);
                const capitalNext = /^[ \t]*["'“‘]*[A-Z]/.test(rightContext);
                if (sentenceFinal && capitalNext) {
                    isDialog = true;
                }
            }

            if (isDialog) {
                this.emitDialog(diagnostics, start, to, fullMatch,
                    isStartOfLine, isEndOfLine, leftSubsumed, true);
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
        return diagnostics;
    }
}
