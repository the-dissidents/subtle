type Operation = 0 | 1 | 2 | 3;
const MATCH = 0;
const DELETE = 1;
const INSERT = 2;
const SUBSITUTE = 3;

const OperationName = ['match', 'del', 'ins', 'sub'] as const;

type SolutionToken = {
    op: typeof OperationName[Operation],
    i: number, j: number
}

type TokenClass = {
    regex: RegExp,
    termWeight: number,
    textWeight: number
}

type FuzzyMatchOptions = {
    insertionPenalty: number,
    deletionPenalty: number,
    substitutionPenalty: number,
}

function match(A: number[], Z: number[]) {
    const m = A.length;
    const n = Z.length;

    let DPOp: Operation[][] = new Array(m+1).fill(null).map(
        () => new Array(n+1).fill(0));
    let DPScore: number[][] = new Array(m+1).fill(null).map(
        () => new Array(n+1).fill(Infinity));
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
        let Ai = A[i-1]; // A and Z are zero-based
        let Zi = Z[j-1];
        if (Ai == Zi) {
            DPOp[i][j] = MATCH;
            DPScore[i][j] = DPScore[i-1][j-1];
        } else {
            let [si, sd, ss] = [ 
                DPScore[i][j-1] + 1, 
                DPScore[i-1][j] + 1,
                DPScore[i-1][j-1] + 1];
            const minimum = Math.min(si, sd, ss);
            let op: Operation = 0;
            if (minimum == si) op = INSERT; 
            else if (minimum == sd) op = DELETE; 
            else op = SUBSITUTE; 
            DPOp[i][j] = op;
            DPScore[i][j] = minimum;
        }
    }

    // for (let i = 0; i <= m; i++) {
    //     console.log(DP[i].map((x) => x!.op[0] + x!.score.toString()))
    // }

    // backtrack
    let current_j = 0;
    let bestScore = Infinity;
    for (let j = 0; j <= n; j++)
        if (DPScore[m][j] < bestScore) {
            current_j = j;
            bestScore = DPScore[m][j];
        }
    if (current_j == 0) return null;

    let tokens: SolutionToken[] = [];
    let current_i = m;
    while (current_i > 0 && current_j > 0) {
        let op = DPOp[current_i][current_j];
        tokens.push({ op: OperationName[op], i: current_i-1, j: current_j-1 });
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
            throw Error('should not happen');
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
        let prefix = tokens.reduce<number[]>((p, c) => {
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
    let words = new Map<string, number>();
    x.forEach((word, i) => {
        let ids = words.get(word);
        if (ids === undefined)
            words.set(word, i);
    });

    let A = x.map((word) => words.get(word)!);
    let Z = w.map((word) => words.get(word) ?? -1);
    return [A, Z, words] as const;
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

    search(term: string, maxSkip: number) {
        let [tTerm, termPrefix] = this.tokenizer.tokenize(term);
        let [A, Z, dict] = preprocess(this.#tokens, tTerm);

        const getTextToken = (i: number) => 
            this.text.slice(this.#prefix[i], this.#prefix[i+1]);
        const getTermToken = (i: number) => 
            term.slice(termPrefix[i], termPrefix[i+1]);

        let result = match(A, Z);
        if (result === null) return null;

        let nMatched = 0;
        let visual = result.tokens.map((x) => {
            switch (x.op) {
            case 'match':
                nMatched += 1;
                return getTermToken(x.i);
            case 'del':
                return `<${getTermToken(x.i)}>`;
            case 'ins':
                return `[${getTextToken(x.j)}]`;
            case 'sub':
                return `{${getTermToken(x.i)}|${getTextToken(x.j)}}`;
            default:
                throw Error('should not happen')
            }
        }).join('').replaceAll(/\]\[|\>\</g, '');
        return [visual, nMatched / result.tokens.length] as const;
    }
}