import * as z from "zod/v4-mini";
import { BracketSetPresets } from "../linter/brackets/Presets";
import { BracketLinter } from "../linter/brackets/Brackets";
import type { Diagnostic } from "../linter/Common";
import { zx } from '@traversable/zod';
import { RegexLintPresets } from "../linter/regex/Presets";
import { RegexLinter, type RegexLintRule } from "../linter/regex/Regex";
import { ForbidPunctuationLinter } from "../linter/ForbidCharacters";

export const BracketPresetName =
    z.enum(Object.keys(BracketSetPresets) as (keyof typeof BracketSetPresets)[]);

export type BracketPresetName = z.infer<typeof BracketPresetName>;

export const RegexLintPresetName =
    z.enum(Object.keys(RegexLintPresets) as (keyof typeof RegexLintPresets)[]);

export type RegexLintPresetName = z.infer<typeof RegexLintPresetName>;

export const LintProfile = z.object({
    bracketGroups: z._default(z.array(BracketPresetName), []),
    regexes: z._default(z.array(RegexLintPresetName), []),
    forbiddenPunctuation: z._default(z.string(), ''),
});

export type LintProfile = z.infer<typeof LintProfile>;

export const lintProfileEquals = zx.deepEqual(LintProfile);

export class CompiledLintProfile {
    #bracket: BracketLinter;
    #regex: RegexLinter;
    #forbid: ForbidPunctuationLinter;

    constructor(p: LintProfile) {
        this.#bracket = new BracketLinter(p.bracketGroups.map((x) => BracketSetPresets[x]));
        this.#regex = new RegexLinter(
            p.regexes.flatMap((x) => RegexLintPresets[x] as RegexLintRule[]));
        this.#forbid = new ForbidPunctuationLinter(p.forbiddenPunctuation);
    }

    check(text: string) {
        const diags: Diagnostic[] = [];
        diags.push(
            ...this.#bracket.check(text),
            ...this.#regex.check(text),
            ...this.#forbid.check(text)
        );
        return diags.sort((a, b) => a.to - b.to);
    }
}
