import type { Brackets, BracketSet } from "./Brackets";

function ignoreApostrophes(text: string, index: number) {
    const char = text[index];
    // Only apply heuristic to single quotes
    if (char !== '‘' && char !== '’' && char !== "'") return false;

    // Extract immediate neighbors
    const left = index > 0 ? text[index - 1] : '';
    const right = index < text.length - 1 ? text[index + 1] : '';

    const isLetter = (c: string) => /\p{L}/u.test(c);
    const isDigit = (c: string) => /\d/.test(c);
    const isBoundary = (c: string) => !c || /\W/.test(c);

    // 1. Infix Apostrophe (e.g., don't)
    if (isLetter(left) && isLetter(right)) return true;

    // 2. Suffix Possessive (e.g., dogs')
    if (left.toLowerCase() === 's' && isBoundary(right)) return true;

    // 3. Prefix Year Truncation (e.g., '99)
    if (isBoundary(left) && isDigit(right)) return true;

    return false; // Treat as a bracket candidate
}

export const BracketPresets = {
    straightQuotes: {
        primary: ['"', '"'] as const, secondary: ["'", "'"] as const,
        ignoreContext: ignoreApostrophes
    },
    invertedStraightQuotes: {
        primary: ["'", "'"] as const, secondary: ['"', '"'] as const,
        ignoreContext: ignoreApostrophes
    },

    curlyQuotes: {
        primary: ['“', '”'] as const, secondary: ['‘', '’'] as const,
        ignoreContext: ignoreApostrophes
     },
    invertedCurlyQuotes: {
        primary: ['‘', '’'] as const, secondary: ['“', '”'] as const,
        ignoreContext: ignoreApostrophes
    },

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
