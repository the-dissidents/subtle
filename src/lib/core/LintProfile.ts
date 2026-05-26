import * as z from "zod/v4-mini";
import { BracketSetPresets } from "../linter/brackets/Presets";
import { BracketLinter } from "../linter/brackets/Brackets";
import type { Diagnostic } from "../linter/Common";

export const BracketPresetName =
    z.enum(Object.keys(BracketSetPresets) as (keyof typeof BracketSetPresets)[]);

export type BracketPresetName = z.infer<typeof BracketPresetName>;

export const LintProfile = z.object({
    bracketGroups: z._default(z.array(BracketPresetName), []),
});

export type LintProfile = z.infer<typeof LintProfile>;

export class CompiledLintProfile {
    #bracket: BracketLinter;

    constructor(p: LintProfile) {
        this.#bracket = new BracketLinter(p.bracketGroups.map((x) => BracketSetPresets[x]));
    }

    check(text: string) {
        const diags: Diagnostic[] = [];
        diags.push(...this.#bracket.check(text));

        return diags;
    }
}
