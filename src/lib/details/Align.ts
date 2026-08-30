import { Basic } from "$lib/Basic";
import type { SubtitleEntry } from "$lib/core/Subtitles.svelte";
import * as z from "zod/v4-mini";

export const ZAlignmentOptions = z.object({
    weightOnset: z.number(),
    weightEnd: z.number(),
    penaltySkip: z.number(),
    penaltyMerge: z.number(),
    penaltySplit: z.number(),
    windowMs: z.number(),
});

export type AlignmentOptions = z.infer<typeof ZAlignmentOptions>;

export const DefaultAlignmentOptions: AlignmentOptions = {
    weightOnset: 0.8,
    weightEnd: 0.2,
    penaltySkip: 10,
    penaltyMerge: 5,
    penaltySplit: 5,
    windowMs: 5000,
};

// Backpointer operations
const OP_NONE = 0;
const OP_MATCH = 1;
const OP_SKIP_A = 2; // Delete A / Unmapped
const OP_SKIP_B = 3; // Insert B / Unmapped
const OP_MERGE = 4;  // N-to-1: Advance A, keep B
const OP_SPLIT = 5;  // 1-to-N: Keep A, advance B

export interface AlignmentResult {
    matches: [number, number][];      // 1-to-1
    merges: [number[], number][];     // N-to-1 (Multiple A's to one B)
    splits: [number, number[]][];     // 1-to-N (One A to multiple B's)
    unmappedA: number[];
    unmappedB: number[];
}

function getDistance(
    a: SubtitleEntry,
    b: SubtitleEntry,
    opts: AlignmentOptions
): number {
    if (Math.abs(a.start - b.start) > opts.windowMs) {
        return Infinity;
    }
    return (opts.weightOnset * Math.abs(a.start - b.start)) +
           (opts.weightEnd * Math.abs(a.end - b.end));
}

export async function alignSubtitles(
    trackA: SubtitleEntry[],
    trackB: SubtitleEntry[],
    options: Partial<AlignmentOptions> = {},
    reportProgress?: (p: number) => void
): Promise<AlignmentResult> {
    const N = trackA.length;
    const M = trackB.length;

    const opts: AlignmentOptions = {
        ...DefaultAlignmentOptions,
        ...options
    };

    // Initialize DP matrices
    // Float64Array and Uint8Array are used for memory efficiency given potential N,M sizes > 1000
    const costs = Array.from({ length: N + 1 }, () => new Float64Array(M + 1).fill(Infinity));
    const ops = Array.from({ length: N + 1 }, () => new Uint8Array(M + 1).fill(OP_NONE));

    // Base conditions (0,0 is 0 cost; edges accumulate skip penalties)
    costs[0][0] = 0;
    for (let i = 1; i <= N; i++) {
        costs[i][0] = i * opts.penaltySkip;
        ops[i][0] = OP_SKIP_A;
    }
    for (let j = 1; j <= M; j++) {
        costs[0][j] = j * opts.penaltySkip;
        ops[0][j] = OP_SKIP_B;
    }

    let time = performance.now();

    // Forward pass: Populate cost matrix
    for (let i = 1; i <= N; i++) {
        for (let j = 1; j <= M; j++) {
            const entryA = trackA[i - 1];
            const entryB = trackB[j - 1];

            const dist = getDistance(entryA, entryB, opts);

            // 1. 1-to-1 Match (Diagonal)
            let minCost = costs[i - 1][j - 1] + dist;
            let bestOp = OP_MATCH;

            // 2. Skip A (Vertical)
            const costSkipA = costs[i - 1][j] + opts.penaltySkip;
            if (costSkipA < minCost) {
                minCost = costSkipA;
                bestOp = OP_SKIP_A;
            }

            // 3. Skip B (Horizontal)
            const costSkipB = costs[i][j - 1] + opts.penaltySkip;
            if (costSkipB < minCost) {
                minCost = costSkipB;
                bestOp = OP_SKIP_B;
            }

            // If dist is Infinity, don't bother evaluating Merge/Split constraints
            if (dist !== Infinity) {
                // 4. Merge: Many A to one B (Vertical map)
                const costMerge = costs[i - 1][j] + dist + opts.penaltyMerge;
                if (costMerge < minCost) {
                    minCost = costMerge;
                    bestOp = OP_MERGE;
                }

                // 5. Split: One A to many B (Horizontal map)
                const costSplit = costs[i][j - 1] + dist + opts.penaltySplit;
                if (costSplit < minCost) {
                    minCost = costSplit;
                    bestOp = OP_SPLIT;
                }
            }

            costs[i][j] = minCost;
            ops[i][j] = bestOp;
        }

        const now = performance.now();
        if (now > time + 50) {
            reportProgress?.(i / N);
            time = now;
        }
        await Basic.wait(0);
    }

    // Backward pass: Trace path to extract alignments
    const rawMatches: Array<[number, number]> = [];
    const unmappedA: number[] = [];
    const unmappedB: number[] = [];

    let i = N;
    let j = M;

    while (i > 0 || j > 0) {
        const op = ops[i][j];

        if (op === OP_MATCH) {
            rawMatches.push([i - 1, j - 1]);
            i--;
            j--;
        } else if (op === OP_SKIP_A) {
            unmappedA.push(i - 1);
            i--;
        } else if (op === OP_SKIP_B) {
            unmappedB.push(j - 1);
            j--;
        } else if (op === OP_MERGE) {
            rawMatches.push([i - 1, j - 1]);
            i--; // A moves backward, B stays (N-to-1)
        } else if (op === OP_SPLIT) {
            rawMatches.push([i - 1, j - 1]);
            j--; // B moves backward, A stays (1-to-N)
        } else {
            throw new Error(`Invalid DP state at (${i}, ${j})`);
        }
    }

    reportProgress?.(1);

    rawMatches.reverse();
    unmappedA.reverse();
    unmappedB.reverse();

    const matches: [number, number][] = [];
    const merges: [number[], number][] = [];
    const splits: [number, number[]][] = [];

    if (rawMatches.length > 0) {
        let currentA = new Set([rawMatches[0][0]]);
        let currentB = new Set([rawMatches[0][1]]);
        let blockPairs = [rawMatches[0]];

        const flushBlock = () => {
            const arrA = Array.from(currentA);
            const arrB = Array.from(currentB);

            if (arrA.length === 1 && arrB.length === 1) {
                matches.push([arrA[0], arrB[0]]);
            } else if (arrA.length > 1 && arrB.length === 1) {
                merges.push([arrA, arrB[0]]);
            } else if (arrA.length === 1 && arrB.length > 1) {
                splits.push([arrA[0], arrB]);
            } else {
                // Fallback for N-to-M chaotic clusters (theoretically rare given DP penalties)
                // Degrades to explicit 1-to-1 pairings to preserve data integrity
                matches.push(...blockPairs);
            }
        };

        for (let k = 1; k < rawMatches.length; k++) {
            const [a, b] = rawMatches[k];

            if (currentA.has(a) || currentB.has(b)) {
                currentA.add(a);
                currentB.add(b);
                blockPairs.push([a, b]);
            } else {
                flushBlock();
                currentA = new Set([a]);
                currentB = new Set([b]);
                blockPairs = [[a, b]];
            }
        }
        flushBlock();
    }

    // Traceback builds arrays in reverse order
    return {
        matches,
        merges,
        splits,
        unmappedA,
        unmappedB
    };
}
