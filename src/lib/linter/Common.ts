export type Diagnostic = {
    start: number,
    to: number,
    type: 'punctuation' | 'format' | 'spelling',
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
            + diag.description + (diag.fix
                ? '\nfix to: `' + diag.fix.substitute + '`'
                : '');
    }
}
