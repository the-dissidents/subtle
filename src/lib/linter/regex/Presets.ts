import type { RegexLintRule } from "./Regex";

import { unwrapFunctionStore, _ } from 'svelte-i18n';
const $_ = unwrapFunctionStore(_);

export const RegexLintPresets = {
    // todo: spaces around ellipses/dashes; enforce correct dashes

    noLeadingTrailingSpaces: [{
        type: 'format',
        pattern: /^[ ]+|[ ]+$/ug,
        description: () => $_('regexlint.leading-trailing-spaces'),
        fix: () => '',

        overrides: ['consecutiveSpaces']
    }],
    noConsecutiveSpaces: [{
        type: 'format',
        pattern: /[ ]{2,}/ug,
        description: () => $_('regexlint.consecutive-spaces'),
        fix: () => ' ',

        id: 'consecutiveSpaces',
    }],
    spaceAfterLatinPunctuation: [{
        type: 'punctuation',
        pattern: /(?<=\p{Script=Latin}|^)([,;?!”](?=\p{Script=Latin})|[.:](?=\p{Script=Latin}+ ))/ug,
        description: () => $_('regexlint.space-after-latin-punct'),
        fix: (m) => `${m[0]} `,
    }],
    noSpaceBeforePunctuation: [{
        type: 'punctuation',
        pattern: /\s+([,;?!”.:])/ug,
        description: () => $_('regexlint.no-space-before-latin-punct'),
        fix: (m) => `${m[1]}`,
    }],
    spaceAroundFullwidthPunctuation: [{
        type: 'punctuation',
        pattern: /([\u3000-\u303F|\uFF00-\uFF5A]|——|……)[ ]+/ug,
        description: () => $_('regexlint.no-space-after-fullwidth-punct'),
        fix: (m) => `${m[1]}`,
    }, {
        type: 'punctuation',
        pattern: /[ ]+([\u3000-\u303F|\uFF00-\uFF5A])/ug,
        description: () => $_('regexlint.no-space-before-fullwidth-punct'),
        fix: (m) => `${m[1]}`,
    }],
    useChineseWordConnector: [{
        type: 'punctuation',
        pattern: /(?<=\p{Script=Han})(-)(?=\p{Script=Han})/ug,
        description: () => $_('regexlint.chinese-word-connector'),
        fix: () => `–`,
    }],
    useSingleEllipsis: [{
        type: 'punctuation',
        pattern: /(\.[ ]?){2,}|(·){3,}/ug,
        description: () => $_('regexlint.non-preferred-ellipsis'),
        fix: () => `…`,
    }, {
        type: 'punctuation',
        pattern: /…{2,}/ug,
        description: () => $_('regexlint.non-preferred-ellipsis'),
        fix: () => `…`,
    }],
    useDoubleEllipsis: [{
        type: 'punctuation',
        pattern: /(\.[ ]?){2,}|(·){3,}/ug,
        description: () => $_('regexlint.non-preferred-ellipsis'),
        fix: () => `……`,
    }, {
        type: 'punctuation',
        pattern: /…{3,}/ug,
        description: () => $_('regexlint.non-preferred-ellipsis'),
        fix: () => `……`,
    }, {
        type: 'punctuation',
        pattern: /(?<!…)…(?!…)/ug,
        description: () => $_('regexlint.non-preferred-ellipsis'),
        fix: () => `……`,
    }],
} satisfies Record<string, RegexLintRule[]>;
