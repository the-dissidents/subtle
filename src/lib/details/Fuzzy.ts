import { Debug } from "../Debug";

type Operation = 0 | 1 | 2 | 3;
const MATCH = 0;
const DELETE = 1;
const INSERT = 2;
const SUBSITUTE = 3;

export type MatchType = 'match' | 'subtitute' | 'delete' | 'insert';

export type SolutionToken = {
    type: MatchType,
    i: number, j: number
};

export type FuzzyMatchOptions<T> = {
    equality?: (a: T, b: T, i: number, j: number) => boolean,
    insertionPenalty?: (value: T, i: number, j: number) => number,
    deletionPenalty?: (value: T, i: number, j: number) => number,
    substitutionPenalty?: (a: T, b: T, i: number, j: number) => number,
    wholeSequence?: boolean,
    reportProgress?: (progress: number) => void,
};

/**
 * Matches sequence `A` against sequence `Z` using an edit-distance algorithm. If `wholeSequence` is not set to `true` in `opt`, `A` is treated as the needle and `Z` the haystack. Returns the score (lower is better) and the computed operations of the match.
 */
export function match<T>(A: T[], Z: T[], opt: FuzzyMatchOptions<T>) {
    const m = A.length;
    const n = Z.length;

    const DPOp: Operation[][] = new Array(m+1).fill(null)
        .map(() => new Array(n+1).fill(MATCH));
    const DPScore: number[][] = new Array(m+1).fill(null)
        .map(() => new Array(n+1).fill(Infinity));
    DPScore[0][0] = 0;

    for (let i = 1; i <= m; i++) {
        DPOp[i][0] = DELETE;
        DPScore[i][0] = DPScore[i-1][0] + (opt.deletionPenalty?.(A[i-1], i, 0) ?? 1);
    }

    for (let j = 1; j <= n; j++){
        if (opt.wholeSequence) {
            DPOp[0][j] = INSERT;
            DPScore[0][j] = DPScore[0][j-1] + (opt.insertionPenalty?.(Z[j-1], 0, j) ?? 1);
        } else {
            DPOp[0][j] = MATCH;
            DPScore[0][j] = 0;
        }
    }

    for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++) {
        const Ai = A[i-1]; // A and Z are zero-based
        const Zj = Z[j-1];
        if (opt.equality?.(Ai, Zj, i-1, j-1) ?? (Ai === Zj)) {
            DPOp[i][j] = MATCH;
            DPScore[i][j] = DPScore[i-1][j-1];
        } else {
            const [si, sd, ss] = [
                DPScore[i][j-1]   + (opt.insertionPenalty?.(Zj, i-1, j-1) ?? 1),
                DPScore[i-1][j]   + (opt.deletionPenalty?.(Ai, i-1, j-1) ?? 1),
                DPScore[i-1][j-1] + (opt.substitutionPenalty?.(Ai, Zj, i-1, j-1) ?? 1)];
            const minimum = Math.min(si, sd, ss);
            DPOp[i][j] = minimum == si ? INSERT
                       : minimum == sd ? DELETE
                       :                 SUBSITUTE;
            DPScore[i][j] = minimum;
        }
    }

    // backtrack
    let current_i = m;
    let current_j = n;
    let bestScore = Infinity;

    if (opt.wholeSequence) {
        bestScore = DPScore[m][n];
    } else {
        for (let j = 0; j <= n; j++) {
            if (DPScore[m][j] < bestScore) {
                current_j = j;
                bestScore = DPScore[m][j];
            }
        }
        if (current_j === 0) return null;
    }

    const tokens: SolutionToken[] = [];
    while (current_i > 0 || (opt.wholeSequence && current_j > 0)) {
        const op = DPOp[current_i][current_j];
        const [i, j] = [current_i-1, current_j-1];
        let type: MatchType;
        switch (op) {
            case SUBSITUTE:
                type = 'subtitute';
                current_i -= 1;
                current_j -= 1;
                break;
            case MATCH:
                type = 'match';
                current_i -= 1;
                current_j -= 1;
                break;
            case INSERT:
                type = 'insert';
                current_j -= 1;
                break;
            case DELETE:
                type = 'delete';
                current_i -= 1;
                break;
            default:
                Debug.never(op);
        }
        tokens.push({ type, i, j });
    }
    return { score: bestScore, tokens: tokens.reverse() };
}

export interface Tokenizer<Orig, T> {
    tokenize(input: Orig): [tokens: T[], prefixLen: number[]]
}

export class RegexTokenizer implements Tokenizer<string, string> {
    constructor(private passes: RegExp[], private isCaseSensitive: boolean = false) {}

    caseSensitive(v: boolean) {
        return new RegexTokenizer(this.passes, v);
    }

    tokenize(str: string): [tokens: string[], prefixLen: number[]] {
        let tokens = [this.isCaseSensitive ? str : str.toLowerCase()];
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

export type MergedDiffPart<T> = {
    type: MatchType,
    first: T[], second: T[]
};

export type SearchResult<T> = {
    merged: MergedDiffPart<T>[],
    start: number,
    end: number,
    matchRatio: number
};

export class Searcher<Orig, T> {
    #tokens: T[];
    #prefix: number[];

    constructor(text: Orig, private tokenizer: Tokenizer<Orig, T>) {
        [this.#tokens, this.#prefix] = tokenizer.tokenize(text);
    }

    tokenList(): ReadonlyArray<T> {
        return this.#tokens;
    }

    prefixLengthList(): ReadonlyArray<number> {
        return this.#prefix;
    }

    search(term: Orig, opts: FuzzyMatchOptions<T> = {}): SearchResult<T> | null {
        const [tTerm, _] = this.tokenizer.tokenize(term);

        const result = match(tTerm, this.#tokens, opts);
        if (result === null || result.tokens.length == 0) return null;

        const merged: MergedDiffPart<T>[] = [];
        let nMatched = 0;

        result.tokens.forEach((x) => {
            if (x.type == 'match') nMatched++;

            const last = merged.at(-1);
            if (last?.type == x.type) {
                last.first.push(tTerm[x.i]);
                last.second.push(this.#tokens[x.j]);
            } else merged.push({
                type: x.type,
                first: [tTerm[x.i]],
                second: [this.#tokens[x.j]]
            });
        });

        return {
            merged,
            start: this.#prefix[result.tokens[0].j],
            end: this.#prefix[result.tokens.at(-1)!.j + 1],
            matchRatio: nMatched / result.tokens.length
        };
    }
}
