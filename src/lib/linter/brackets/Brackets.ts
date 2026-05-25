import { Debug } from "../../Debug";
import type { Diagnostic } from "../Common";

export type DeepNestingPolicy = 'forbid' | 'cycle';

export type BracketPair = [start: string, end: string];

export type Brackets = {
    primary: BracketPair;
    secondary?: BracketPair;
    assumeDirection?: boolean;
    ignoreContext?: (text: string, index: number) => boolean;
};

export type BracketSet = {
    preferred: Brackets;
    nonPreferred: Brackets[];
    deepNestingPolicy?: DeepNestingPolicy;
};

// Internal configuration extended to hold full context
type CharConfig = {
    groupId: number;
    level: 'primary' | 'secondary';
    classification: 'preferred' | 'nonPreferred';
    intrinsicDirection: 'open' | 'close' | 'identical';
    assumeDirection: boolean;
    ignoreContext?: (text: string, index: number) => boolean;
    preferred: BracketPair;

    // Properties for resolving cyclic policies
    preferredPrimary: BracketPair;
    preferredSecondary?: BracketPair;
    deepNestingPolicy?: DeepNestingPolicy;
};

type Token = {
    char: string;
    index: number;
    config: CharConfig;
    activeDirection: 'open' | 'close';
    nestingDepth: number; // State memory for stack unwinding
};

/**
 * General purpose bracket checker.
 *
 * Bracket here applies to quotation marks and parentheses etc. An example of `groups` for Chinese texts might be:
 * ```
 * [
 *   {
 *     preferred: { primary: ['“', '”'], secondary: ['‘', '’'] },
 *     nonPreferred: [
 *       { primary: ['"', '"'], secondary: ["'", "'"] },
 *       { primary: ['「', '」'], secondary: ['『', '』'] }
 *     ],
 *   },
 *   {
 *     preferred: { primary: ['（', '）'], assumeDirection: true },
 *     nonPreferred: [{ primary: ['(', ')'], assumeDirection: true }],
 *   },
 *   {
 *     preferred: { primary: ['《', '》'], secondary: ['〈', '〉'], assumeDirection: true },
 *     nonPreferred: []
 *   },
 * ]
 * ```
 *
 * The following diagnostics are emitted:
 *
 * 1. Stray `${character}`
 *    After a conflict, the nearest offender to the left is flagged:
 *    ```text
 *    e.g. “text ‘text text”
 *                         | conflict occurs here (interruption by a primary bracket)
 *               ^---------/
 *
 *         (text “text) text”
 *                    | conflict occurs here (interruption by another group of bracket)
 *               ^----|
 *                    \-----^ the parser continues to the right
 *
 *         (text (nested) text
 *                            | conflict occurs at EOF
 *         ^------------------/
 *    ```
 *
 * 2. Incorrect nesting
 *    ```text
 *    e.g. ‘“text”’
 *         ^      ^ met secondary brackets without a bracket context
 *         “text “text” text”
 *               ^    ^
 *    ```
 *
 * 3. Incorrect direction
 *    ```text
 *    e.g. ”text”   ”text“   “text“
 *         ^        ^    ^        ^
 *    ```
 *
 *    The parser will attempt to correct their directions to reduce extra errors.
 *    This diagnostic only applies to brackets
 *      - that has a falsy `assumeDirection`
 *      - and whose actual direction can be deduced from the context
 *      - and whose actual direction is different from the apparent one
 *
 *    Context clues include whitespaces or line start/ends:
 *    ```text
 *         text ”text“ text
 *              ^    ^ Incorrect direction
 *         ”text“
 *         ^    ^ Incorrect direction
 *    ```
 *
 *    Compare with:
 *    ```text
 *         )text(
 *         ^ Stray `)`
 *              ^ Stray `(`
 *         note: `assumeDirection` is true for parentheses
 *
 *         text” text “text
 *             ^ Stray `”`
 *                    ^ Stray `“`
 *    ```
 *
 * 4. Use of non-preferred form
 *    ```text
 *    e.g. “text"
 *              ^ note: alternative forms are coerced to preferred versions
 *                      and this is understood as a closing bracket
 *    ```
 *
 * Brackets with identical opening and ending forms are interpreted with guessed directions.
 *
 * ```text
 * e.g. "text"
 *      ^ Use of non-preferred form (fix to `“`)
 *           ^ Use of non-preferred form (fix to `”`)
 *      "text "text"
 *      | guessed as opening
 *            | guessed as opening
 *                 | guessed as closing
 *                  | conflict at EOF
 *      ^-----------/ Stray `"`; Use of non-preferred form
 *            ^ Use of non-preferred form
 *                 ^ Use of non-preferred form
 * ```
 */
export class BracketLinter {
    private charMap: Map<string, CharConfig> = new Map();

    constructor(groups: BracketSet[]) {
        this.compileGroups(groups);
    }

    public check(text: string): Diagnostic[] {
        const diagnostics: Diagnostic[] = [];
        const tokens = this.tokenize(text);
        this.disambiguate(text, tokens, diagnostics);
        Debug.info(tokens);
        this.resolve(tokens, diagnostics);
        return diagnostics.sort((a, b) => a.start - b.start);
    }

    private compileGroups(groups: BracketSet[]) {
        groups.forEach((group, groupId) => {
            const processBrackets = (
                brackets: Brackets,
                classification: 'preferred' | 'nonPreferred'
            ) => {
                const levels: ('primary' | 'secondary')[] = ['primary', 'secondary'];

                levels.forEach(level => {
                    const pair = brackets[level];
                    if (!pair) return;

                    const assumeDirection = brackets.assumeDirection ?? false;
                    const [open, close] = pair;
                    const prefPair = group.preferred[level]!;

                    const baseConfig: Omit<CharConfig, 'intrinsicDirection'> = {
                        groupId, level,
                        classification,
                        assumeDirection,
                        ignoreContext: brackets.ignoreContext,
                        preferred: prefPair,
                        preferredPrimary: group.preferred.primary,
                        preferredSecondary: group.preferred.secondary,
                        deepNestingPolicy: group.deepNestingPolicy
                    };

                    if (this.charMap.has(open)) {
                        Debug.warn(`BracketLinter: overwriting ${open}`);
                    }
                    if (this.charMap.has(close) && close !== open) {
                        Debug.warn(`BracketLinter: overwriting ${close}`);
                    }

                    if (open === close) {
                        this.charMap.set(open, { ...baseConfig, intrinsicDirection: 'identical' });
                    } else {
                        this.charMap.set(open, { ...baseConfig, intrinsicDirection: 'open' });
                        this.charMap.set(close, { ...baseConfig, intrinsicDirection: 'close' });
                    }
                });
            };

            processBrackets(group.preferred, 'preferred');
            group.nonPreferred.forEach(np => processBrackets(np, 'nonPreferred'));
        });
    }

    private tokenize(text: string): Token[] {
        const tokens: Token[] = [];
        for (let i = 0; i < text.length; i++) {
            const char = text[i];
            const config = this.charMap.get(char);

            if (config) {
                if (config.ignoreContext?.(text, i)) continue;

                tokens.push({
                    char, index: i, config,
                    activeDirection: config.intrinsicDirection === 'close' ? 'close' : 'open',
                    nestingDepth: 0 // Initialized at 0; assigned dynamically during resolution
                });
            }
        }
        return tokens;
    }

    private disambiguate(text: string, tokens: Token[], diagnostics: Diagnostic[]) {
        const isBoundary = (c?: string) => !c || /[\s\p{P}]/u.test(c);

        for (const token of tokens) {
            const { config } = token;

            if (!config.assumeDirection || config.intrinsicDirection === 'identical') {
                const leftIsBoundary = isBoundary(text[token.index - 1]);
                const rightIsBoundary = isBoundary(text[token.index + 1]);

                let deducedDirection: 'open' | 'close' = token.activeDirection;
                if (leftIsBoundary && !rightIsBoundary) deducedDirection = 'open';
                else if (!leftIsBoundary && rightIsBoundary) deducedDirection = 'close';

                if (config.intrinsicDirection !== 'identical' && deducedDirection !== config.intrinsicDirection) {
                    diagnostics.push({
                        start: token.index,
                        to: token.index + 1,
                        type: 'punctuation',
                        description: `Incorrect direction for '${token.char}'. Appears to act as a ${deducedDirection}ing bracket.`,
                        fix: {
                            substitute: deducedDirection === 'open'
                                ? config.preferred[0] : config.preferred[1],
                            confident: true
                        }
                    });
                }
                token.activeDirection = deducedDirection;
            }
        }
    }

    private resolve(tokens: Token[], diagnostics: Diagnostic[]) {
        const stack: Token[] = [];

        for (const token of tokens) {
            const { config, index, char } = token;
            let hasFix = false;

            const currentDepth = stack.filter(t => t.config.groupId === config.groupId).length;

            if (token.activeDirection === 'open') {
                token.nestingDepth = currentDepth;

                const expectedLevel =
                    (currentDepth % 2 !== 0 && config.preferredSecondary?.[1])
                    ? 'secondary' : 'primary';

                if (config.level !== expectedLevel) {
                    const expectedChar = expectedLevel === 'primary'
                        ? config.preferredPrimary[0]
                        : config.preferredSecondary![0];

                    diagnostics.push({
                        start: index, to: index + 1, type: 'punctuation',
                        description: `Expected a ${expectedLevel} opening bracket.`,
                        fix: { substitute: expectedChar, confident: true }
                    });
                    hasFix = true;
                }

                if (config.deepNestingPolicy === 'forbid') {
                    const maxDepth = config.preferredSecondary ? 2 : 1;
                    if (currentDepth >= maxDepth) diagnostics.push({
                        start: index, to: index + 1, type: 'punctuation',
                        description: `Brackets are too deeply nested.`
                    });
                }
                stack.push(token);
            } else {
                // met a closing bracket

                let matchIndex = -1;
                for (let i = stack.length - 1; i >= 0; i--) {
                    const stackToken = stack[i];
                    if (stackToken.config.groupId === config.groupId
                     && stackToken.config.level === config.level
                    ) {
                        matchIndex = i;
                        break;
                    }
                }

                if (matchIndex !== -1) {
                    const matchToken = stack[matchIndex];
                    const matchDepth = matchToken.nestingDepth;

                    // Apply symmetric closing diagnostics based on the matched open bracket's depth
                    const expectedLevel =
                        (matchDepth % 2 !== 0 && config.preferredSecondary?.[1])
                        ? 'secondary' : 'primary';

                    if (config.level !== expectedLevel) {
                        const expectedChar = expectedLevel === 'primary'
                            ? config.preferredPrimary[1]
                            : config.preferredSecondary![1];

                        diagnostics.push({
                            start: index, to: index + 1, type: 'punctuation',
                            description: `Expected a ${expectedLevel} closing bracket.`,
                            fix: { substitute: expectedChar, confident: true }
                        });
                        hasFix = true;
                    }

                    if (config.deepNestingPolicy === 'forbid') {
                        const maxDepth = config.preferredSecondary ? 2 : 1;
                        if (matchDepth >= maxDepth) diagnostics.push({
                            start: index, to: index + 1, type: 'punctuation',
                            description: `Brackets are too deeply nested.`
                        });
                    }

                    // Unwind interruptions
                    for (let i = stack.length - 1; i > matchIndex; i--) {
                        const unclosed = stack.pop()!;
                        diagnostics.push({
                            start: unclosed.index,
                            to: unclosed.index + 1,
                            type: 'punctuation',
                            description: `Stray '${unclosed.char}'. Bracket was left unclosed.`
                        });
                    }
                    stack.pop();
                } else diagnostics.push({
                    start: index, to: index + 1, type: 'punctuation',
                    description: `Stray '${char}'. Closing bracket without a matching open bracket.`
                });
            }

            // non-preferred forms
            if (config.classification === 'nonPreferred' && !hasFix) diagnostics.push({
                start: index, to: index + 1, type: 'format',
                description: `Use of non-preferred bracket form '${char}'.`,
                fix: {
                    substitute: token.activeDirection === 'open'
                        ? config.preferred[0] : config.preferred[1],
                    confident: true
                }
            });
        }

        while (stack.length > 0) {
            const unclosed = stack.pop()!;
            diagnostics.push({
                start: unclosed.index,
                to: unclosed.index + 1,
                type: 'punctuation',
                description: `Stray '${unclosed.char}'. Bracket was left unclosed at the end.`
            });
        }
    }
}
