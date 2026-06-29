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
    unicode: '⸺'
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
    }))
});

export type DashesConfig = z.infer<typeof DashesConfig>;

export class DashLinter {
    constructor(private config: DashesConfig) {}

    private isCJKChar(char: string): boolean {
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

    check(entry: string): Diagnostic[] {
        // correct non-preferred dash forms to the preferred one, fix spaces around them, and warn if a dash is not allowed (because of `endOnly`)
        // - to avoid false positives, we give up checking hyphens and en-dashes if there is no space around them (they can be legitimate hyphens and en-dashes)
        // - don't add spaces at the beginning or end of a line if a dash appears there

        // if a dash appears at the start of a line (possibly with spaces), it is a dialog-dash.
        // occasionally, dialog-dashes appear in the middle of a line; if it is after a sentence-final punctuation (with optionally spaces) and before a capital letter it is likely a dialog-dash.
        // otherwise, assume a regular dash.

        // CJK dashes are two em-dashes in a row, or rarely the Unicode 'two-em dash". No spaces are allowed around them. Incorrect forms include two or more hyphens.
        // We check CJK dashes only around fullwidth characters and if the option is enabled.

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
            const isEndOfLine = rightContext.length === 0 || rightContext.startsWith('\n') || rightContext.startsWith('\r');

            // Skip hyphenated words and standard ranges to avoid false positives.
            // Note: Does not skip double-hyphens (--), as they are strictly non-standard for intra-word usage.
            if ((dashChars === '-' || dashChars === '–')
             && leftSpaces === '' && rightSpaces === ''
             && !isStartOfLine && !isEndOfLine
            ) continue;

            // try to determine if the sequence is a dialog dash
            let isDialog = isStartOfLine;
            if (!isDialog) {
                const sentenceFinal = /[.?!]["'”’]*[ \t]*$/.test(leftContext);
                const capitalNext = /^[ \t]*["'“‘]*[A-Z]/.test(rightContext);
                if (sentenceFinal && capitalNext) {
                    isDialog = true;
                }
            }

            // dialog dashes
            if (isDialog) {
                if (this.config.dialog.separateLines && !isStartOfLine) diagnostics.push({
                    start, to, type: 'format',
                    description: $_('dashlint.dialog-dashes-should-begin-on-a-new-line')
                });

                const expectedChar = DashType[this.config.dialog.type];
                const spaces = this.config.dialog.spaces;

                // Do not prepend/append space if adjacent to line boundaries
                const expLeftSpace = isStartOfLine ? '' : (spaces ? ' ' : '');
                const expRightSpace = isEndOfLine ? '' : (spaces ? ' ' : '');
                const expectedSub = expLeftSpace + expectedChar + expRightSpace;

                if (fullMatch !== expectedSub) diagnostics.push({
                    start, to,
                    type: 'punctuation',
                    description: $_('dashlint.wrong-dialog-dash'),
                    fix: { substitute: expectedSub, confident: true }
                });
                continue;
            }

            // CJK dashes
            if (this.config.cjkDash !== undefined
            && (this.isCJKChar(leftContext.trim().slice(-1)) ||
                this.isCJKChar(rightContext.trim().charAt(0)) ||
                dashChars === '——' || dashChars === '⸺')
            ) {
                const preferred = CJKDashType[this.config.cjkDash.type];
                if (dashChars !== preferred || leftSpaces.length > 0 || rightSpaces.length > 0) {
                    diagnostics.push({
                        start, to,
                        type: 'punctuation',
                        description: $_('dashlint.wrong-cjk-dashes', { values: { preferred } }),
                        fix: { substitute: preferred, confident: true }
                    });
                }
                continue;
            }

            // regular dashes
            {
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
        }
        return diagnostics;
    }
}
