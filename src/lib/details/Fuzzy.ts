import { Debug } from "../Debug";

type Operation = 0 | 1 | 2 | 3;
const MATCH = 0;
const DELETE = 1;
const INSERT = 2;
const SUBSITUTE = 3;

type SolutionToken = {
    op: Operation,
    i: number, j: number
};

export type FuzzyMatchOptions = {
    insertionPenalty?: number,
    deletionPenalty?: number,
    substitutionPenalty?: number,
};

export type FuzzyMatchResult = {
    visualization: string,
    start: number,
    end: number,
    score: number,
    matchRatio: number
};

function match(A: number[], Z: number[], opt: FuzzyMatchOptions) {
    const m = A.length;
    const n = Z.length;

    const DPOp: Operation[][] = new Array(m+1).fill(null)
        .map(() => new Array(n+1).fill(0));
    const DPScore: number[][] = new Array(m+1).fill(null)
        .map(() => new Array(n+1).fill(Infinity));
    for (let i = 0; i <= m; i++) {
        DPOp[i][0] = DELETE;
        DPScore[i][0] = i;
    }
    for (let j = 0; j <= n; j++){
        DPOp[0][j] = MATCH;
        DPScore[0][j] = 0;
    }

    for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++) {
        const Ai = A[i-1]; // A and Z are zero-based
        const Zi = Z[j-1];
        if (Ai == Zi) {
            DPOp[i][j] = MATCH;
            DPScore[i][j] = DPScore[i-1][j-1];
        } else {
            const [si, sd, ss] = [ 
                DPScore[i][j-1]   + (opt.insertionPenalty ?? 1), 
                DPScore[i-1][j]   + (opt.deletionPenalty ?? 1),
                DPScore[i-1][j-1] + (opt.substitutionPenalty ?? 1)];
            const minimum = Math.min(si, sd, ss);
            let op: Operation = 0;
            if (minimum == si) op = INSERT; 
            else if (minimum == sd) op = DELETE; 
            else op = SUBSITUTE; 
            DPOp[i][j] = op;
            DPScore[i][j] = minimum;
        }
    }

    // backtrack
    let current_j = 0;
    let bestScore = Infinity;
    for (let j = 0; j <= n; j++)
        if (DPScore[m][j] < bestScore) {
            current_j = j;
            bestScore = DPScore[m][j];
        }
    if (current_j == 0) return null;

    const tokens: SolutionToken[] = [];
    let current_i = m;
    while (current_i > 0 && current_j > 0) {
        const op = DPOp[current_i][current_j];
        tokens.push({ op, i: current_i-1, j: current_j-1 });
        switch (op) {
            case SUBSITUTE:
            case MATCH:
                current_i -= 1;
                current_j -= 1;
                break;
            case INSERT:
                current_j -= 1;
                break;
            case DELETE:
                current_i -= 1;
                break;
            default:
                Debug.never(op);
        }
    }
    return {score: bestScore, tokens: tokens.reverse()};
}


export interface Tokenizer {
    tokenize(str: string): [tokens: string[], prefixLen: number[]]
}

export class RegexTokenizer implements Tokenizer {
    constructor(private passes: RegExp[]) {}

    tokenize(str: string): [tokens: string[], prefixLen: number[]] {
        let tokens = [str.toLowerCase()];
        for (const regex of this.passes) {
            tokens = tokens.flatMap((x) => x.split(regex));
        }
        const prefix = tokens.reduce<number[]>((p, c) => {
            p.push(p.at(-1)! + c.length);
            return p;
        }, [0]);
        return [tokens, prefix];
    }
}

export const DefaultTokenizer = new RegexTokenizer(
    [/(?<![\p{L}\d])|(?![\p{L}\d])|(?<=[\u4E00-\u9FFF])|(?=[\u4E00-\u9FFF])/u]);

export const CharacterTokenizer = new RegexTokenizer([/(?=.)/]);

export const SyllableTokenizer = new RegexTokenizer(
    [/(?<![\p{L}\d])|(?![\p{L}\d])|(?<=[\u4E00-\u9FFF])|(?=[\u4E00-\u9FFF])/u,
    /(?<!^[bcdfghjklmnpqrstvwxzßñç])(?=[bcdfghjklmnpqrstvwxzßñç][^bcdfghjklmnpqrstvwxzßñç])/]);

function preprocess(w: string[], x: string[]) {
    const dict = new Map<string, number>();
    x.forEach((word, i) => {
        if (dict.get(word) === undefined)
            dict.set(word, i);
    });

    const A = x.map((word) => dict.get(word)!);
    const Z = w.map((word) => dict.get(word) ?? -1);
    return [A, Z, dict] as const;
}

export class Searcher {
    #tokens: string[];
    #prefix: number[];

    constructor(private text: string, private tokenizer: Tokenizer) {
        [this.#tokens, this.#prefix] = tokenizer.tokenize(text);
    }

    tokenList(): ReadonlyArray<string> {
        return this.#tokens;
    }

    prefixLengthList(): ReadonlyArray<number> {
        return this.#prefix;
    }

    search(term: string, opts: FuzzyMatchOptions = {}): FuzzyMatchResult | null {
        const [tTerm, termPrefix] = this.tokenizer.tokenize(term);
        const [A, Z, _] = preprocess(this.#tokens, tTerm);

        const getTextToken = (x: SolutionToken) => 
            this.text.slice(this.#prefix[x.j], this.#prefix[x.j+1]);
        const getTermToken = (x: SolutionToken) => 
            term.slice(termPrefix[x.i], termPrefix[x.i+1]);

        const result = match(A, Z, opts);
        if (result === null || result.tokens.length == 0) return null;

        let nMatched = 0;
        const visualization = result.tokens.map((x) => {
            switch (x.op) {
                case MATCH:
                    nMatched += 1;
                    return getTermToken(x);
                case DELETE:
                    return `<${getTermToken(x)}>`;
                case INSERT:
                    return `[${getTextToken(x)}]`;
                case SUBSITUTE:
                    return `{${getTermToken(x)}|${getTextToken(x)}}`;
                default:
                    Debug.never(x.op);
            }
        }).join('').replaceAll(/\]\[|></g, '');

        return {
            visualization,
            score: result.score,
            start: this.#prefix[result.tokens[0].j],
            end: this.#prefix[result.tokens.at(-1)!.j + 1],
            matchRatio: nMatched / result.tokens.length
        };
    }
}