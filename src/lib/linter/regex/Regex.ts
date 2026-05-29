import type { Diagnostic, DiagnosticType } from "../Common";

export type RegexLintRule = {
    pattern: RegExp,
    type: DiagnosticType,
    fix?: (match: RegExpExecArray) => string | Diagnostic['fix'],
    description: (match: RegExpExecArray) => string,

    id?: string,
    overrides?: string[]
};

export class RegexLinter {
    // we can topologically sort the rules based on override order etc
    // but let's avoid premature optimization
    constructor(private rules: readonly RegexLintRule[]) {}

    check(text: string): Diagnostic[] {
        const diags = this.rules.flatMap((rule) => [...text.matchAll(rule.pattern)].map((x) => {
            const fix = rule.fix?.(x);
            return {
                rule,
                start: x.index,
                to: x.index + x[0].length,
                type: rule.type,
                description: rule.description(x),
                fix: typeof fix === 'string' ? {
                    substitute: fix,
                    confident: true
                } : typeof fix === 'object' ? fix : undefined
            };
        }));

        return diags.filter((x) => !x.rule.id || !diags.find(
            (y) => y !== x && y.start == x.start && y.to == x.to
                && y.rule.overrides?.includes(x.rule.id!)));
    }
}
