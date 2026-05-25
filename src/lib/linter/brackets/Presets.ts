import type { Brackets, BracketSet } from "./Brackets";

export const BracketPresets = {
    straightQuotes: { primary: ['"', '"'] as const, secondary: ["'", "'"] as const },
    invertedStraightQuotes: { primary: ["'", "'"] as const, secondary: ['"', '"'] as const },

    curlyQuotes: { primary: ['“', '”'] as const, secondary: ['‘', '’'] as const },
    invertedCurlyQuotes: { primary: ['‘', '’'] as const, secondary: ['“', '”'] as const },

    germanQuotes: { primary: ['„', '“'] as const, secondary: ["‚", "‘"] as const },
    inwardGuillemets: { primary: ['»', '«'] as const, secondary: ["›", "‹"] as const },
    outwardGuillemets: { primary: ['«', '»'] as const, secondary: ["‹", "›"] as const },

    cornerQuotes: { primary: ['「', '」'] as const, secondary: ['『', '』'] as const },

    parentheses: { primary: ['(', ')'] as const, assumeDirection: true },
    squareBrackets: { primary: ['[', ']'] as const, assumeDirection: true },
    curlyBrackets: { primary: ['{', '}'] as const, assumeDirection: true },

    fullwidthParentheses: { primary: ['（', '）'] as const, assumeDirection: true },
    fullwidthSquareParentheses: { primary: ['【', '】'] as const, assumeDirection: true },
} satisfies Record<string, Brackets>;

export const BracketSetPresets = {
    curlyQuotes: {
        preferred: BracketPresets.curlyQuotes,
        nonPreferred: [
            BracketPresets.straightQuotes,
            BracketPresets.cornerQuotes,
        ],
    },
    invertedCurlyQuotes: {
        preferred: BracketPresets.invertedCurlyQuotes,
        nonPreferred: [
            BracketPresets.invertedStraightQuotes,
        ],
    },
    germanQuotes: {
        preferred: BracketPresets.germanQuotes,
        nonPreferred: [
            BracketPresets.inwardGuillemets,
        ],
    },
    germanGuillemetQuotes: {
        preferred: BracketPresets.inwardGuillemets,
        nonPreferred: [
            BracketPresets.germanQuotes,
        ],
    },
    frenchGuillemetQuotes: {
        preferred: BracketPresets.outwardGuillemets,
        nonPreferred: [
            BracketPresets.curlyQuotes,
            BracketPresets.straightQuotes,
        ],
    },
    cornerQuotes: {
        preferred: BracketPresets.cornerQuotes,
        nonPreferred: [
            BracketPresets.curlyQuotes,
            BracketPresets.straightQuotes,
        ],
    },

    halfwidthParentheses: {
        preferred: BracketPresets.parentheses,
        nonPreferred: [
            BracketPresets.fullwidthParentheses
        ],
    },

    fullwidthParentheses: {
        preferred: BracketPresets.fullwidthParentheses,
        nonPreferred: [
            BracketPresets.parentheses
        ],
    },
} satisfies Record<string, BracketSet>;
