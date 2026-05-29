import { Memorized } from "../config/MemorizedValue.svelte";
import { LintProfile } from "../core/LintProfile";

import * as z from "zod/v4-mini";

const defaultLintProfiles: [string, LintProfile][] = [
    ['简体中文（一般引号）', {
        bracketGroups: ['curlyQuotes', 'fullwidthParentheses'],
        regexes: ['noConsecutiveSpaces', 'noLeadingTrailingSpaces', 'spaceAfterLatinPunctuation', 'noSpaceBeforePunctuation', 'spaceAroundFullwidthPunctuation', 'useChineseWordConnector', 'useSingleEllipsis'],
    }],
    ['简体中文（方引号）', {
        bracketGroups: ['cornerQuotes', 'fullwidthParentheses'],
        regexes: ['noConsecutiveSpaces', 'noLeadingTrailingSpaces', 'spaceAfterLatinPunctuation', 'noSpaceBeforePunctuation', 'spaceAroundFullwidthPunctuation', 'useChineseWordConnector', 'useSingleEllipsis'],
    }],
    ['English (US)', {
        bracketGroups: ['curlyQuotes', 'halfwidthParentheses'],
        regexes: ['noConsecutiveSpaces', 'noLeadingTrailingSpaces', 'spaceAfterLatinPunctuation', 'noSpaceBeforePunctuation', 'useSingleEllipsis'],
    }]
]

export const SavedLintProfiles = Memorized.$('savedLintProfiles',
    z.array(z.tuple([z.string(), LintProfile])), defaultLintProfiles);
