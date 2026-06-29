import type { Diagnostic } from "./Common";

import { unwrapFunctionStore, _ } from 'svelte-i18n';
const $_ = unwrapFunctionStore(_);

export class ForbidPunctuationLinter {
    constructor(private chars: string) {}

    check(text: string): Diagnostic[] {
        const result: Diagnostic[] = [];
        let i = 0;
        for (const ch of Array.from(text)) {
            if (this.chars.includes(ch)) result.push({
                start: i, to: i + ch.length,
                type: 'punctuation',
                description: $_('forbidlint.forbidden'),
                fix: {
                    substitute: ' ',
                    confident: false
                }
            })
            i += ch.length;
        }
        return result;
    }
}
