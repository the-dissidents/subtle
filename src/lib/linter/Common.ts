export type DiagnosticType = 'punctuation' | 'format' | 'spelling';

export type Diagnostic = {
    start: number,
    to: number,
    type: DiagnosticType,
    description: string,
    fix?: {
        substitute: string,
        confident: boolean
    }
};

export namespace Diagnostic {
    export function prettyPrint(diag: Diagnostic, source: string) {
        return source + '\n'
            + ' '.repeat(diag.start) + '^'.repeat(diag.to - diag.start) + '\n'
            + `[${diag.type}] ${diag.description}` + (diag.fix
                ? '\nfix to: `' + diag.fix.substitute + '`'
                : '');
    }

    export function getNonOverlappingFixes(diag: Diagnostic[]): {
        start: number,
        to: number,
        substitute: string
    }[] {
        return diag
            .filter((x) => x.fix && !diag.find((y) => x !== y && x.start < y.to && x.to > y.start))
            .map((x) => ({ start: x.start, to: x.to, substitute: x.fix!.substitute }))
            .sort((a, b) => b.start - a.start);
    }
}
