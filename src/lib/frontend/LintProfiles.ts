import { Memorized } from "../config/MemorizedValue.svelte";
import { LintProfile } from "../core/LintProfile";

import * as z from "zod/v4-mini";

const defaultLintProfiles: [string, LintProfile][] = [
    ['简体中文（一般引号）', {
        bracketGroups: ['curlyQuotes', 'fullwidthParentheses'],
        regexes: ['noConsecutiveSpaces', 'noLeadingTrailingSpaces', 'spaceAfterLatinPunctuation', 'noSpaceBeforePunctuation', 'useSingleEllipsis', 'noSpaceAroundEllipsis', 'useFullwidthPunctuationInCJK'],
        forbiddenPunctuation: '，、：；。',
        dashes: {
            dialog: { type: 'horizontalBar', spaces: true, separateLines: false },
            dash: { type: 'emDash', spaces: false, endOnly: false },
            cjkDash: { type: 'standard', wordConnectors: true }
        },
    }],
    ['简体中文（方引号）', {
        bracketGroups: ['cornerQuotes', 'fullwidthParentheses'],
        regexes: ['noConsecutiveSpaces', 'noLeadingTrailingSpaces', 'spaceAfterLatinPunctuation', 'noSpaceBeforePunctuation', 'useSingleEllipsis', 'noSpaceAroundEllipsis', 'useFullwidthPunctuationInCJK'],
        forbiddenPunctuation: '，、：；。',
        dashes: {
            dialog: { type: 'horizontalBar', spaces: true, separateLines: false },
            dash: { type: 'emDash', spaces: false, endOnly: false },
            cjkDash: { type: 'standard', wordConnectors: true }
        },
    }],
    ['English (US)', {
        bracketGroups: ['curlyQuotes', 'halfwidthParentheses'],
        regexes: ['noConsecutiveSpaces', 'noLeadingTrailingSpaces', 'spaceAfterLatinPunctuation', 'noSpaceBeforePunctuation', 'useSingleEllipsis', 'spaceAroundEllipsis', 'useHalfwidthPunctuationInLatin'],
        forbiddenPunctuation: '',
        dashes: {
            dialog: { type: 'horizontalBar', spaces: true, separateLines: false },
            dash: { type: 'emDash', spaces: false, endOnly: false },
        }
    }],
    ['English (US, Netflix)', {
        bracketGroups: ['curlyQuotes', 'halfwidthParentheses'],
        regexes: ['noConsecutiveSpaces', 'noLeadingTrailingSpaces', 'spaceAfterLatinPunctuation', 'noSpaceBeforePunctuation', 'useSingleEllipsis', 'spaceAroundEllipsis', 'useHalfwidthPunctuationInLatin'],
        forbiddenPunctuation: '—–', // en- and em-dashes
        dashes: {
            dialog: { type: 'hyphenMinus', spaces: false, separateLines: true },
            dash: { type: 'doubleHyphenMinus', spaces: false, endOnly: true },
        }
    }]
]

export const SavedLintProfiles = Memorized.$('lintProfilePresets',
    z.array(z.tuple([z.string(), LintProfile])), defaultLintProfiles);

export function resetSavedLintProfiles() {
    SavedLintProfiles.set(defaultLintProfiles);
}
