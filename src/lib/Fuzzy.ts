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


export const SyllableTokenizer = new RegexTokenizer(
    [/(?<![\p{L}\d])|(?![\p{L}\d])|(?<=[\u4E00-\u9FFF])|(?=[\u4E00-\u9FFF])/u,
    /(?<!^[bcdfghjklmnpqrstvwxzßñç])(?=[bcdfghjklmnpqrstvwxzßñç][^bcdfghjklmnpqrstvwxzßñç])/]);

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

    search(term: string, maxSkip: number)
    : [start: number, end: number, match: number, total: number] | undefined {
        let [tt, _] = this.tokenizer.tokenize(term);
        let [__, syns, array] = preprocess(this.#tokens, tt);
        let result = LLIS(array, syns, maxSkip);
        if (!result) return undefined;
        let [i0, i1, n] = result;
        return [this.#prefix[i0], this.#prefix[i1+1], n, i1-i0+1];
    }
}

function preprocess(w: string[], x: string[]) {
    let words = new Map<string, number[]>();
    x.forEach((word, i) => {
        let ids = words.get(word);
        if (ids === undefined)
            words.set(word, [i]);
        else
            ids.push(i);
    });

    let a = w.map((word) => (words.get(word) ?? [-1])[0]);
    let minwords = new Map([...words].map(([word, ids]) => [word, ids[0]]));
    let synonyms = new Map([...words.values()].map((syns) => [syns[0], syns]));
    return [minwords, synonyms, a] as const;
}

function LLIS(a: number[], synonyms: Map<number, number[]>, maxSkip: number) {
    const n = a.length;
    let d = new Array(n);
    let prev = new Array(n);
    for (let i = 0; i < n; i++)
        d[i] = 1;

    // let synomax = new Map([...synonyms].map(([a, b]) => [a, Math.max(...b)]));
    // let synomin = new Map([...synonyms].map(([a, b]) => [a, Math.min(...b)]));

    for (let i = 0; i < n; i++) {
        if (a[i] < 0) continue;
        const syns = synonyms.get(a[i])!;
        // const max = synomax.get(a[i])!;
        for (let j = Math.max(0, i-maxSkip-1); j < i; j++) {
            if (a[j] < 0) continue;
            if (d[i] >= d[j] + 1) continue;
            let usable = syns.find((value) => value > a[j]);
            if (usable !== undefined) {
            // if (max > synomin.get(a[j])!) {
                d[i] = d[j] + 1;
                prev[i] = j;
                // TODO: I don't really know if this is correct!
                a[i] = usable;
            }
        }
    }
    let dmax = Math.max(...d);
    if (dmax == 1) return undefined;
    let idx = d.indexOf(dmax);
    let first = idx;
    while (prev[first] !== undefined)
        first = prev[first];
    return [first, idx, dmax] as const;
}