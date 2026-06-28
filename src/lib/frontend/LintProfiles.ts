import { Memorized } from "../config/MemorizedValue.svelte";
import { LintProfile } from "../core/LintProfile";

import * as z from "zod/v4-mini";

const defaultLintProfiles: [string, LintProfile][] = [
    ['简体中文（一般引号）', {
        bracketGroups: ['curlyQuotes', 'fullwidthParentheses'],
        regexes: ['noConsecutiveSpaces', 'noLeadingTrailingSpaces', 'spaceAfterLatinPunctuation', 'noSpaceBeforePunctuation', 'noSpaceAroundFullwidthPunctuation', 'useChineseWordConnector', 'useSingleEllipsis', 'noSpaceAroundEllipsis', 'useFullwidthPunctuationInCJK'],
        forbiddenPunctuation: '，、：；。',
        dashes: {
            dialog: { type: 'enDash', spaces: true, separateLines: false },
            dash: { type: 'emDash', spaces: true, endOnly: false },
            cjkDash: { type: 'standard' }
        }
    }],
    ['简体中文（方引号）', {
        bracketGroups: ['cornerQuotes', 'fullwidthParentheses'],
        regexes: ['noConsecutiveSpaces', 'noLeadingTrailingSpaces', 'spaceAfterLatinPunctuation', 'noSpaceBeforePunctuation', 'noSpaceAroundFullwidthPunctuation', 'useChineseWordConnector', 'useSingleEllipsis', 'noSpaceAroundEllipsis', 'useFullwidthPunctuationInCJK'],
        forbiddenPunctuation: '，、：；。',
        dashes: {
            dialog: { type: 'enDash', spaces: true, separateLines: false },
            dash: { type: 'emDash', spaces: true, endOnly: false },
            cjkDash: { type: 'standard' }
        }
    }],
    ['English (US)', {
        bracketGroups: ['curlyQuotes', 'halfwidthParentheses'],
        regexes: ['noConsecutiveSpaces', 'noLeadingTrailingSpaces', 'spaceAfterLatinPunctuation', 'noSpaceBeforePunctuation', 'useSingleEllipsis', 'spaceAroundEllipsis', 'useHalfwidthPunctuationInLatin', 'checkLatinDash'],
        forbiddenPunctuation: '',
        dashes: {
            dialog: { type: 'enDash', spaces: true, separateLines: false },
            dash: { type: 'emDash', spaces: true, endOnly: false },
        }
    }],
    ['English (US, Netflix)', {
        bracketGroups: ['curlyQuotes', 'halfwidthParentheses'],
        regexes: ['noConsecutiveSpaces', 'noLeadingTrailingSpaces', 'spaceAfterLatinPunctuation', 'noSpaceBeforePunctuation', 'useSingleEllipsis', 'spaceAroundEllipsis', 'useHalfwidthPunctuationInLatin', 'checkLatinDash'],
        forbiddenPunctuation: '—–', // en- and em-dashes
        dashes: {
            dialog: { type: 'hyphen', spaces: false, separateLines: true },
            dash: { type: 'doubleHyphen', spaces: false, endOnly: true },
        }
    }]
]

export const SavedLintProfiles = Memorized.$('lintProfilePresets',
    z.array(z.tuple([z.string(), LintProfile])), defaultLintProfiles);
