import { Debug } from "../../Debug";
import type { Diagnostic } from "../Common";

import { unwrapFunctionStore, _ } from 'svelte-i18n';
const $_ = unwrapFunctionStore(_);

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
type CharacterConfig = {
    groupId: number;
    level: 'primary' | 'secondary';
    classification: 'preferred' | 'nonPreferred';
    intrinsicDirection: 'open' | 'close' | 'identical';
    assumeDirection: boolean;
    ignoreContext?: (text: string, index: number) => boolean;
    preferred: BracketPair;
    preferredPrimary: BracketPair;
    preferredSecondary?: BracketPair;
    deepNestingPolicy?: DeepNestingPolicy;
};

type Token = {
    char: string;
    index: number;
    config: CharacterConfig;
    activeDirection: 'open' | 'close';
    nestingDepth: number; // State memory for stack unwinding
};

/**
 * General purpose bracket checker.
 *
 * Bracket here applies to quotation marks and parentheses etc. The following diagnostics are emitted:
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
    private charMap: Map<string, CharacterConfig> = new Map();

    static validateSettings(groups: BracketSet[]) {
        const [_, overwritten] = BracketLinter.compileGroups(groups);
        return { overwritten };
    }

    constructor(groups: BracketSet[]) {
        const [m, _] = BracketLinter.compileGroups(groups);
        this.charMap = m;
    }

    public check(text: string): Diagnostic[] {
        const diagnostics: Diagnostic[] = [];
        const tokens = this.tokenize(text);
        this.disambiguate(text, tokens, diagnostics);
        this.resolve(tokens, diagnostics);
        return diagnostics.sort((a, b) => a.start - b.start);
    }

    private static compileGroups(groups: BracketSet[]) {
        const charMap: Map<string, CharacterConfig> = new Map();
        const overwritten = new Set<string>();
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

                    const baseConfig: Omit<CharacterConfig, 'intrinsicDirection'> = {
                        groupId, level,
                        classification,
                        assumeDirection,
                        ignoreContext: brackets.ignoreContext,
                        preferred: prefPair,
                        preferredPrimary: group.preferred.primary,
                        preferredSecondary: group.preferred.secondary,
                        deepNestingPolicy: group.deepNestingPolicy
                    };

                    if (charMap.has(open)) {
                        void Debug.warn(`BracketLinter: overwriting ${open}`);
                        overwritten.add(open);
                    }
                    if (charMap.has(close) && close !== open) {
                        void Debug.warn(`BracketLinter: overwriting ${close}`);
                        overwritten.add(close);
                    }

                    if (open === close) {
                        charMap.set(open, { ...baseConfig, intrinsicDirection: 'identical' });
                    } else {
                        charMap.set(open, { ...baseConfig, intrinsicDirection: 'open' });
                        charMap.set(close, { ...baseConfig, intrinsicDirection: 'close' });
                    }
                });
            };

            processBrackets(group.preferred, 'preferred');
            group.nonPreferred.forEach(np => processBrackets(np, 'nonPreferred'));
        });
        return [charMap, overwritten] as const;
    }

    private tokenize(text: string): Token[] {
        const tokens: Token[] = [];
        const textArray = Array.from(text);

        let utf16idx = 0;
        for (let i = 0; i < textArray.length; i++) {
            const char = textArray[i];
            const config = this.charMap.get(char);

            if (config && !config.ignoreContext?.(text, utf16idx)) tokens.push({
                char, index: i, config,
                activeDirection: config.intrinsicDirection === 'close' ? 'close' : 'open',
                nestingDepth: 0 // Initialized at 0; assigned dynamically during resolution
            });

            utf16idx += char.length;
        }
        return tokens;
    }

    private disambiguate(text: string, tokens: Token[], diagnostics: Diagnostic[]) {
        const isBoundary = (c?: string) => !c || /[\s]/u.test(c);

        for (const token of tokens) {
            const { config } = token;

            if (!config.assumeDirection || config.intrinsicDirection === 'identical') {
                const left = text[token.index - 1], right = text[token.index + 1];
                const leftIsBoundary = isBoundary(left);
                const rightIsBoundary = isBoundary(right);

                let deducedDirection: 'open' | 'close' = token.activeDirection;
                if      (!left && right) deducedDirection = 'open';
                else if (left && !right) deducedDirection = 'close';
                else if (leftIsBoundary && !rightIsBoundary) deducedDirection = 'open';
                else if (!leftIsBoundary && rightIsBoundary) deducedDirection = 'close';

                if (config.intrinsicDirection !== 'identical' && deducedDirection !== config.intrinsicDirection) {
                    diagnostics.push({
                        start: token.index,
                        to: token.index + 1,
                        type: 'punctuation',
                        description: $_('brackets.incorrect-direction', { values: {a: token.char} }),
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
            const maxDepth = config.preferredSecondary ? 2 : 1;
            const currentDepth = stack.filter(t => t.config.groupId === config.groupId).length;
            let hasFix = false, tooDeep = false;

            if (token.activeDirection === 'open') {
                token.nestingDepth = currentDepth;
                tooDeep = config.deepNestingPolicy === 'forbid' && currentDepth >= maxDepth;

                const expectedLevel =
                    (currentDepth % 2 !== 0 && config.preferredSecondary?.[1])
                    ? 'secondary' : 'primary';

                if (config.level !== expectedLevel && !tooDeep) {
                    const expectedChar = expectedLevel === 'primary'
                        ? config.preferredPrimary[0]
                        : config.preferredSecondary![0];

                    diagnostics.push({
                        start: index, to: index + 1, type: 'punctuation',
                        description: expectedLevel === 'primary'
                            ? $_('brackets.expected-primary-opening')
                            : $_('brackets.expected-secondary-opening'),
                        fix: { substitute: expectedChar, confident: true }
                    });
                    hasFix = true;
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
                    tooDeep = config.deepNestingPolicy === 'forbid' && matchDepth >= maxDepth;

                    if (tooDeep) diagnostics.push({
                        start: matchToken.index, to: index + 1, type: 'punctuation',
                        description: $_('brackets.too-deeply-nested')
                    });

                    const expectedLevel =
                        (matchDepth % 2 !== 0 && config.preferredSecondary?.[1])
                        ? 'secondary' : 'primary';

                    if (config.level !== expectedLevel && !tooDeep) {
                        const expectedChar = expectedLevel === 'primary'
                            ? config.preferredPrimary[1]
                            : config.preferredSecondary![1];

                        diagnostics.push({
                            start: index, to: index + 1, type: 'punctuation',
                            description: expectedLevel === 'primary'
                                ? $_('brackets.expected-primary-closing')
                                : $_('brackets.expected-secondary-closing'),
                            fix: { substitute: expectedChar, confident: true }
                        });
                        hasFix = true;
                    }

                    // Unwind interruptions
                    for (let i = stack.length - 1; i > matchIndex; i--) {
                        const unclosed = stack.pop()!;
                        diagnostics.push({
                            start: unclosed.index,
                            to: unclosed.index + 1,
                            type: 'punctuation',
                            description: $_('bracket.stray-unclosed', {values: {a: unclosed.char}})
                        });
                    }
                    stack.pop();
                } else diagnostics.push({
                    start: index, to: index + 1, type: 'punctuation',
                    description: $_('brackets.stray-closing', {values: {a: char}})
                });
            }

            // non-preferred
            if (config.classification === 'nonPreferred' && !hasFix && !tooDeep) diagnostics.push({
                start: index, to: index + 1, type: 'format',
                description: $_('brackets.non-preferred', {values: {a: char}}),
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
                description: $_('bracket.stray-unclosed', {values: {a: unclosed.char}})
            });
        }
    }
}
