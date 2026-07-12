import type { RegexLintRule } from "./Regex";

import { unwrapFunctionStore, _ } from 'svelte-i18n';
const $_ = unwrapFunctionStore(_);

export const RegexLintPresets = {
    // todo: spaces around ellipses/dashes; enforce correct dashes

    noLeadingTrailingSpaces: [{
        type: 'format',
        pattern: /^[ ]+|[ ]+$/mug,
        description: () => $_('regexlint.leading-trailing-spaces'),
        fix: () => '',

        overrides: ['consecutiveSpaces', 'noSpaceAroundFullwidthPunctuation1', 'noSpaceAroundFullwidthPunctuation2', 'noSpaceAroundEllipsis']
    }],
    noConsecutiveSpaces: [{
        type: 'format',
        pattern: /[ ]{2,}/mug,
        description: () => $_('regexlint.consecutive-spaces'),
        fix: () => ' ',

        id: 'consecutiveSpaces',
    }],
    spaceAfterLatinPunctuation: [{
        type: 'format',
        pattern: /(?<=\p{Script=Latin}|^)([,;?!”](?=\p{Script=Latin})|[.:](?=\p{Script=Latin}+ ))/mug,
        description: () => $_('regexlint.space-after-latin-punct'),
        fix: (m) => `${m[0]} `,
        overrides: ['consecutiveSpaces'],
    }],
    noSpaceBeforePunctuation: [{
        type: 'format',
        pattern: /\s+([,;?!”.:])/mug,
        description: () => $_('regexlint.no-space-before-punct'),
        fix: (m) => `${m[1]}`,
        overrides: ['consecutiveSpaces'],
    }],
    useFullwidthPunctuationInCJK: [{
        type: 'punctuation',
        pattern: /(?<=\p{Script=Han})[ ]*[.,:;?!][ ]*(?=\p{Script=Han})/mug,
        description: () => $_('regexlint.use-fullwidth-punct'),
    }],
    useHalfwidthPunctuationInLatin: [{
        type: 'punctuation',
        pattern: /(?<=\p{Script=Latin})[ ]*[\u3000-\u303F\uFF00-\uFF5A][ ]*(?=\p{Script=Latin})/mug,
        description: () => $_('regexlint.use-halfwidth-punct'),
    }],
    spaceBetweenCJKAndNarrow: [{
        type: 'format',
        pattern: /(?<=\p{Script=Han})(?:[ ]{2,}|)[\p{Script=Latin}0-9]+/mug,
        description: () => $_('regexlint.space-between-cjk-and-narrow'),
        fix: (x) => ` ${x[0]}`,
        overrides: ['consecutiveSpaces'],
        id: 'spaceBetweenCJKAndNarrow1'
    }, {
        type: 'format',
        pattern: /[\p{Script=Latin}0-9]+(?:[ ]{2,}|)(?=\p{Script=Han})/mug,
        description: () => $_('regexlint.space-between-cjk-and-narrow'),
        fix: (x) => `${x[0]} `,
        overrides: ['consecutiveSpaces'],
        id: 'spaceBetweenCJKAndNarrow2'
    }, {
        type: 'format',
        pattern: /(?<=\p{Script=Han})(?:[ ]{2,}|)[\p{Script=Latin}0-9]+(?:[ ]{2,}|)(?=\p{Script=Han})/mug,
        description: () => $_('regexlint.space-between-cjk-and-narrow'),
        fix: (x) => ` ${x[0]} `,
        overrides: ['consecutiveSpaces', 'spaceBetweenCJKAndNarrow1', 'spaceBetweenCJKAndNarrow2'],
    }],
    noSpaceBetweenCJKAndNarrow: [{
        type: 'format',
        pattern: /(?<=\p{Script=Han})[ ]+[\p{Script=Latin}0-9]+|[\p{Script=Latin}0-9]+[ ]+(?=\p{Script=Han})/mug,
        description: () => $_('regexlint.no-space-between-cjk-and-narrow'),
        fix: (x) => `${x[0].trim()}`,
        overrides: ['consecutiveSpaces'],
    }],
    noSpaceAroundFullwidthPunctuation: [{
        type: 'format',
        pattern: /([\u3000-\u303F\uFF00-\uFF5A])[ ]+(?![-－⸺\u2010-\u2015])/mug,
        description: () => $_('regexlint.no-space-after-fullwidth-punct'),
        fix: (m) => `${m[1]}`,
        id: 'noSpaceAroundFullwidthPunctuation1',
        overrides: ['consecutiveSpaces'],
    }, {
        type: 'format',
        pattern: /[ ]+([\u3000-\u303F|\uFF00-\uFF5A])/mug,
        description: () => $_('regexlint.no-space-before-fullwidth-punct'),
        fix: (m) => `${m[1]}`,
        id: 'noSpaceAroundFullwidthPunctuation2',
        overrides: ['consecutiveSpaces'],
    }],
    spaceAroundEllipsis: [{
        type: 'format',
        pattern: /(?<!^|[、，。；：？！]|\s)…+/mug,
        description: () => $_('regexlint.space-around-ellipsis'),
        fix: () => ` …`,
        overrides: ['consecutiveSpaces'],
    }, {
        type: 'format',
        pattern: /…+(?!$|\s)/mug,
        description: () => $_('regexlint.space-around-ellipsis'),
        fix: () => `… `,
        overrides: ['consecutiveSpaces'],
    }],
    noSpaceAroundEllipsis: [{
        type: 'format',
        pattern: /\s+…+\s*|\s*…+\s+(?![-－⸺\u2010-\u2015])/mug,
        description: () => $_('regexlint.no-space-around-ellipsis'),
        fix: (m) => m[0].trim(),

        id: 'noSpaceAroundEllipsis',
        overrides: ['consecutiveSpaces'],
    }],
    useSingleEllipsis: [{
        type: 'punctuation',
        pattern: /(\.[ ]?){2,}|(·){3,}/mug,
        description: () => $_('regexlint.non-preferred-ellipsis'),
        fix: () => `…`,
    }, {
        type: 'punctuation',
        pattern: /…{2,}/mug,
        description: () => $_('regexlint.non-preferred-ellipsis'),
        fix: () => `…`,
    }],
    useDoubleEllipsis: [{
        type: 'punctuation',
        pattern: /(\.[ ]?){2,}|(·){3,}/mug,
        description: () => $_('regexlint.non-preferred-ellipsis'),
        fix: () => `……`,
    }, {
        type: 'punctuation',
        pattern: /…{3,}/mug,
        description: () => $_('regexlint.non-preferred-ellipsis'),
        fix: () => `……`,
    }, {
        type: 'punctuation',
        pattern: /(?<!…)…(?!…)/mug,
        description: () => $_('regexlint.non-preferred-ellipsis'),
        fix: () => `……`,
    }],
} satisfies Record<string, RegexLintRule[]>;
