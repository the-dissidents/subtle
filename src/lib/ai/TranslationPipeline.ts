import { Basic } from "../Basic";
import { RichText } from "../core/RichText";
import type { SubtitleEntry } from "../core/Subtitles.svelte";
import { EventHost } from "../details/EventHost";
import { MAPI } from "../API";
import { ChangeType, Source } from "../frontend/Source";
import { mergeEntries, splitTranslation, type MergedUnit } from "./CrossLineMerger";
import { GlossaryStore } from "./GlossaryStore";
import type { ProviderConfig } from "./ProviderConfig";
import {
    assemblePrompt,
    computeBatchSize,
    type ChunkPayload,
    type ContextLine,
    type TranslationConfig,
} from "./PromptAssembler";
import type { ValidationResult } from "./Validator";
import { validateResponse } from "./Validator";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EntryTranslationStatus = "success" | "warning" | "failed";
export type TranslationStatusItem = {
    status: EntryTranslationStatus;
    message?: string;
};

/** Shared table status map: entry index -> translation status. */
export const TranslationStatusMap = {
    map: new Map<number, TranslationStatusItem>(),
    onChanged: new EventHost<[]>(),
    clear(): void {
        if (this.map.size === 0) return;
        this.map.clear();
        this.onChanged.dispatch();
    },
    set(index: number, value: TranslationStatusItem): void {
        this.map.set(index, value);
        this.onChanged.dispatch();
    },
    get(index: number): TranslationStatusItem | undefined {
        return this.map.get(index);
    },
};

export type PerEntryResult = {
    index: number;
    status: EntryTranslationStatus;
    messages: string[];
};

export type TranslationRunResult = {
    entries: PerEntryResult[];
    cancelled: boolean;
    /** Successful `Source.markChanged` calls (undo once per commit for full revert). */
    commitsApplied: number;
    /** Last raw LLM response text for a chunk that ultimately failed (for debugging). */
    failedChunkRawResponses: Record<number, string>;
};

/** Per logical chunk (one slice of merged units) for the Running UI. */
export type ChunkUiStatus = "queued" | "translating" | "validating" | "done" | "failed";

export type TranslationProgress = {
    phase:
        | "starting"
        | "slice"
        | "enrich"
        | "invoke"
        | "validate"
        | "reconcile"
        | "commit"
        | "chunk_failed"
        | "complete";
    chunkIndex: number;
    /** Best-effort total; may differ slightly if batch size changes with glossary growth. */
    totalChunks: number;
    mergedTotal: number;
    detail?: string;
    /** Snapshot of per-chunk pipeline status for the progress panel. */
    chunkStatuses?: ChunkUiStatus[];
    /** Index of the chunk currently being processed (if any). */
    activeChunkIndex?: number;
    /** Cumulative glossary terms after the last committed chunk. */
    glossaryPreview?: Record<string, string>;
};

type ChunkTranslateOk = {
    translations: Array<{ id: number | number[]; text: string }>;
    warnings: ValidationResult["warnings"];
};

function idKey(id: number | number[]): string {
    return Array.isArray(id) ? JSON.stringify(id) : String(id);
}

function getEntryPlainText(entry: SubtitleEntry): string {
    const first = entry.texts.values().next();
    if (first.done) return "";
    return RichText.toString(first.value);
}

function combinePrompt(system: string, user: string): string {
    return `${system}\n\n---\n\n${user}`;
}

function payloadIdForUnit(u: MergedUnit): number | number[] {
    return u.ids.length === 1 ? u.ids[0] : [...u.ids].sort((a, b) => a - b);
}

function buildChunkPayload(
    units: MergedUnit[],
    entries: SubtitleEntry[],
): { payload: ChunkPayload; expectedIds: (number | number[])[]; sourceTexts: string[] } {
    const payloadEntries: ChunkPayload["entries"] = [];
    const expectedIds: (number | number[])[] = [];
    const sourceTexts: string[] = [];

    for (const u of units) {
        const firstIdx = u.ids[0];
        const lastIdx = u.ids[u.ids.length - 1];
        const gapAfter =
            lastIdx >= entries.length - 1
                ? 0
                : Math.max(0, entries[lastIdx + 1].start - entries[lastIdx].end);

        payloadEntries.push({
            id: payloadIdForUnit(u),
            text: u.text,
            start: Basic.formatTimestamp(entries[firstIdx].start, 3, ","),
            end: Basic.formatTimestamp(entries[lastIdx].end, 3, ","),
            gap_after: gapAfter,
        });
        expectedIds.push(payloadIdForUnit(u));
        sourceTexts.push(u.text);
    }

    return { payload: { entries: payloadEntries }, expectedIds, sourceTexts };
}

function applyWarningsToPerEntry(
    perEntry: PerEntryResult[],
    warnings: ValidationResult["warnings"],
): void {
    for (const w of warnings) {
        const ids = Array.isArray(w.id) ? w.id : [w.id];
        const msg = `${w.type}: ${w.message}`;
        for (const idx of ids) {
            if (idx < 0 || idx >= perEntry.length) continue;
            if (perEntry[idx].status === "failed") continue;
            perEntry[idx].status = "warning";
            perEntry[idx].messages.push(msg);
        }
    }
}

// ---------------------------------------------------------------------------
// TranslationRun
// ---------------------------------------------------------------------------

export class TranslationRun {
    readonly onProgress = new EventHost<[TranslationProgress]>();

    #config: TranslationConfig;
    #provider: ProviderConfig;
    #cancelled = false;
    #running = false;
    #failedChunkRaw = new Map<number, string>();

    constructor(config: TranslationConfig, provider: ProviderConfig) {
        this.#config = config;
        this.#provider = provider;
    }

    cancel(): void {
        this.#cancelled = true;
    }

    #emit(p: TranslationProgress): void {
        this.onProgress.dispatch(p);
    }

    #ensureChunkSlots(chunkStatuses: ChunkUiStatus[], index: number): void {
        while (chunkStatuses.length <= index) {
            chunkStatuses.push("queued");
        }
    }

    async start(): Promise<TranslationRunResult> {
        if (this.#running) {
            throw new Error("TranslationRun.start() called while a run is already in progress");
        }
        this.#running = true;
        this.#cancelled = false;
        TranslationStatusMap.clear();

        const entries = Source.subs.entries;
        const nEntries = entries.length;
        if (nEntries === 0) {
            this.#emit({
                phase: "complete",
                chunkIndex: 0,
                totalChunks: 0,
                mergedTotal: 0,
                detail: "No subtitle entries to translate",
            });
            throw new Error("No subtitle entries to translate");
        }
        const perEntry: PerEntryResult[] = entries.map((_, i) => ({
            index: i,
            status: "success" as EntryTranslationStatus,
            messages: [] as string[],
        }));

        const glossary = new GlossaryStore();
        let contextWindow: ContextLine[] = [];
        const chunkStatuses: ChunkUiStatus[] = [];
        let commitsApplied = 0;
        this.#failedChunkRaw.clear();

        try {
            this.#emit({
                phase: "starting",
                chunkIndex: 0,
                totalChunks: 1,
                mergedTotal: 0,
                detail: "Preparing",
            });

            const merged = mergeEntries(entries).filter((u) => u.text.trim().length > 0);
            const initialBatch = Math.max(1, computeBatchSize(this.#provider.maxContext, 0));
            const totalChunks = Math.max(1, Math.ceil(Math.max(1, merged.length) / initialBatch));

            this.#emit({
                phase: "slice",
                chunkIndex: 0,
                totalChunks,
                mergedTotal: merged.length,
                detail: `${merged.length} merged units from ${nEntries} entries`,
            });

            if (merged.length === 0) {
                this.#emit({
                    phase: "complete",
                    chunkIndex: 0,
                    totalChunks: 0,
                    mergedTotal: 0,
                    detail: "No non-empty subtitle entries to translate",
                });
                throw new Error("No non-empty subtitle entries to translate");
            }

            let offset = 0;
            let chunkIndex = 0;

            while (offset < merged.length) {
                if (this.#cancelled) {
                    this.#emit({
                        phase: "complete",
                        chunkIndex,
                        totalChunks,
                        mergedTotal: merged.length,
                        detail: "Cancelled",
                        chunkStatuses: [...chunkStatuses],
                        activeChunkIndex: chunkIndex,
                        glossaryPreview: glossary.getAll(),
                    });
                    return {
                        entries: perEntry,
                        cancelled: true,
                        commitsApplied,
                        failedChunkRawResponses: Object.fromEntries(this.#failedChunkRaw),
                    };
                }

                const batchSize = Math.max(
                    1,
                    computeBatchSize(this.#provider.maxContext, glossary.size),
                );
                const chunkUnits = merged.slice(offset, offset + batchSize);
                offset += chunkUnits.length;

                this.#ensureChunkSlots(chunkStatuses, chunkIndex);
                chunkStatuses[chunkIndex] = "translating";

                this.#emit({
                    phase: "enrich",
                    chunkIndex,
                    totalChunks,
                    mergedTotal: merged.length,
                    detail: `Chunk ${chunkIndex + 1}: ${chunkUnits.length} unit(s)`,
                    chunkStatuses: [...chunkStatuses],
                    activeChunkIndex: chunkIndex,
                    glossaryPreview: glossary.getAll(),
                });

                let chunkResult: ChunkTranslateOk | null = null;
                try {
                    chunkResult = await this.#processUnitsWithRetries(
                        chunkUnits,
                        entries,
                        glossary,
                        contextWindow,
                        chunkIndex,
                        totalChunks,
                        chunkStatuses,
                        merged.length,
                    );
                } catch (e) {
                    chunkStatuses[chunkIndex] = "failed";
                    const msg = e instanceof Error ? e.message : String(e);
                    this.#emit({
                        phase: "chunk_failed",
                        chunkIndex,
                        totalChunks,
                        mergedTotal: merged.length,
                        detail: `Chunk failed with API error: ${msg}`,
                        chunkStatuses: [...chunkStatuses],
                        activeChunkIndex: chunkIndex,
                        glossaryPreview: glossary.getAll(),
                    });
                    for (const u of chunkUnits) {
                        for (const idx of u.ids) {
                            perEntry[idx].status = "failed";
                            perEntry[idx].messages.push(`API error: ${msg}`);
                        }
                    }
                    chunkIndex++;
                    continue;
                }

                if (!chunkResult) {
                    if (this.#cancelled) {
                        this.#emit({
                            phase: "complete",
                            chunkIndex,
                            totalChunks,
                            mergedTotal: merged.length,
                            detail: "Cancelled",
                            chunkStatuses: [...chunkStatuses],
                            activeChunkIndex: chunkIndex,
                            glossaryPreview: glossary.getAll(),
                        });
                        return {
                            entries: perEntry,
                            cancelled: true,
                            commitsApplied,
                            failedChunkRawResponses: Object.fromEntries(this.#failedChunkRaw),
                        };
                    }
                    chunkStatuses[chunkIndex] = "failed";
                    this.#emit({
                        phase: "chunk_failed",
                        chunkIndex,
                        totalChunks,
                        mergedTotal: merged.length,
                        detail: "Chunk failed after progressive retries",
                        chunkStatuses: [...chunkStatuses],
                        activeChunkIndex: chunkIndex,
                        glossaryPreview: glossary.getAll(),
                    });
                    for (const u of chunkUnits) {
                        for (const idx of u.ids) {
                            perEntry[idx].status = "failed";
                            perEntry[idx].messages.push("Translation failed after retries");
                        }
                    }
                    chunkIndex++;
                    continue;
                }

                const { translations, warnings } = chunkResult;
                applyWarningsToPerEntry(perEntry, warnings);

                const tmap = new Map<string, string>();
                for (const t of translations) {
                    tmap.set(idKey(t.id), t.text);
                }

                chunkStatuses[chunkIndex] = "validating";
                this.#emit({
                    phase: "reconcile",
                    chunkIndex,
                    totalChunks,
                    mergedTotal: merged.length,
                    chunkStatuses: [...chunkStatuses],
                    activeChunkIndex: chunkIndex,
                    glossaryPreview: glossary.getAll(),
                });

                const extractSrc: string[] = [];
                const extractTgt: string[] = [];
                const newContextLines: ContextLine[] = [];
                let committedAny = false;

                for (const u of chunkUnits) {
                    const key = idKey(payloadIdForUnit(u));
                    const full = tmap.get(key);
                    if (full === undefined) {
                        for (const idx of u.ids) {
                            perEntry[idx].status = "failed";
                            perEntry[idx].messages.push("Missing translation for merged unit");
                        }
                        continue;
                    }

                    const parts =
                        u.ids.length === 1 ? [full] : splitTranslation({ ...u, text: u.text }, full);

                    if (parts.length !== u.ids.length) {
                        for (const idx of u.ids) {
                            perEntry[idx].status = "failed";
                            perEntry[idx].messages.push("Split count mismatch after translation");
                        }
                        continue;
                    }

                    const sourcesBefore = u.ids.map((idx) => getEntryPlainText(entries[idx]));

                    for (let j = 0; j < u.ids.length; j++) {
                        const idx = u.ids[j];
                        const style = Source.subs.defaultStyle;
                        entries[idx].texts.set(style, parts[j]);
                        extractSrc.push(sourcesBefore[j]);
                        extractTgt.push(parts[j]);
                        newContextLines.push({
                            id: idx,
                            source: sourcesBefore[j],
                            target: parts[j],
                        });
                        committedAny = true;
                    }
                }

                if (committedAny) {
                    await Source.markChanged(
                        ChangeType.General,
                        `AI translate chunk ${chunkIndex + 1}`,
                    );
                    commitsApplied++;
                    glossary.extractFromTranslation(extractSrc, extractTgt);
                    for (const line of newContextLines) {
                        contextWindow.push(line);
                    }
                    contextWindow = contextWindow.slice(-5);
                }

                chunkStatuses[chunkIndex] = "done";
                this.#emit({
                    phase: "commit",
                    chunkIndex,
                    totalChunks,
                    mergedTotal: merged.length,
                    detail: `Chunk ${chunkIndex + 1} finished`,
                    chunkStatuses: [...chunkStatuses],
                    activeChunkIndex: chunkIndex,
                    glossaryPreview: glossary.getAll(),
                });

                chunkIndex++;
            }

            this.#emit({
                phase: "complete",
                chunkIndex: Math.max(0, chunkIndex - 1),
                totalChunks,
                mergedTotal: merged.length,
                detail: "Done",
                chunkStatuses: [...chunkStatuses],
                glossaryPreview: glossary.getAll(),
            });

            return {
                entries: perEntry,
                cancelled: false,
                commitsApplied,
                failedChunkRawResponses: Object.fromEntries(this.#failedChunkRaw),
            };
        } finally {
            if (!this.#cancelled) {
                for (const e of perEntry) {
                    const message = e.messages.length > 0 ? e.messages[0] : undefined;
                    TranslationStatusMap.set(e.index, { status: e.status, message });
                }
            }
            this.#running = false;
        }
    }

    async #processUnitsWithRetries(
        units: MergedUnit[],
        entries: SubtitleEntry[],
        glossary: GlossaryStore,
        contextWindow: ContextLine[],
        chunkIndex: number,
        totalChunks: number,
        chunkStatuses: ChunkUiStatus[],
        mergedTotal: number,
    ): Promise<ChunkTranslateOk | null> {
        type TryResult =
            | { ok: true; translations: ChunkTranslateOk["translations"]; warnings: ChunkTranslateOk["warnings"] }
            | { ok: false; retryHint: string | null; raw: string };

        let lastFailedRaw = "";

        const tryOnce = async (hint: string | null): Promise<TryResult | null> => {
            if (this.#cancelled) return null;

            const { payload, expectedIds, sourceTexts } = buildChunkPayload(units, entries);

            this.#ensureChunkSlots(chunkStatuses, chunkIndex);
            chunkStatuses[chunkIndex] = "translating";

            this.#emit({
                phase: "enrich",
                chunkIndex,
                totalChunks,
                mergedTotal,
                detail: hint ? "Re-enrich with correction hint" : "Assemble prompt",
                chunkStatuses: [...chunkStatuses],
                activeChunkIndex: chunkIndex,
                glossaryPreview: glossary.getAll(),
            });

            const { system, user } = assemblePrompt(
                this.#config,
                payload,
                glossary,
                contextWindow,
            );
            const userPart = hint ? `${user}\n\n---\n\n${hint}` : user;
            const prompt = combinePrompt(system, userPart);

            this.#emit({
                phase: "invoke",
                chunkIndex,
                totalChunks,
                mergedTotal,
                detail: "Calling model",
                chunkStatuses: [...chunkStatuses],
                activeChunkIndex: chunkIndex,
                glossaryPreview: glossary.getAll(),
            });

            const raw = await MAPI.translateChunk(
                prompt,
                this.#provider.endpoint,
                this.#provider.model,
            );
            if (this.#cancelled) return null;
            lastFailedRaw = raw;

            chunkStatuses[chunkIndex] = "validating";
            this.#emit({
                phase: "validate",
                chunkIndex,
                totalChunks,
                mergedTotal,
                detail: "Validating response",
                chunkStatuses: [...chunkStatuses],
                activeChunkIndex: chunkIndex,
                glossaryPreview: glossary.getAll(),
            });

            const v = validateResponse(raw, expectedIds, sourceTexts, glossary);
            if (v.success && v.translations) {
                return { ok: true, translations: v.translations, warnings: v.warnings };
            }
            return { ok: false, retryHint: v.retryHint, raw };
        };

        const first = await tryOnce(null);
        if (this.#cancelled) return null;
        if (first?.ok) {
            return { translations: first.translations, warnings: first.warnings };
        }

        const hint = first && !first.ok ? first.retryHint : null;
        if (first && !first.ok) lastFailedRaw = first.raw;
        if (hint) {
            const second = await tryOnce(hint);
            if (this.#cancelled) return null;
            if (second?.ok) {
                return { translations: second.translations, warnings: second.warnings };
            }
            if (second && !second.ok) lastFailedRaw = second.raw;
        }

        if (units.length <= 1) {
            this.#failedChunkRaw.set(chunkIndex, lastFailedRaw);
            return null;
        }

        const mid = Math.ceil(units.length / 2);
        const left = await this.#processUnitsWithRetries(
            units.slice(0, mid),
            entries,
            glossary,
            contextWindow,
            chunkIndex,
            totalChunks,
            chunkStatuses,
            mergedTotal,
        );
        if (this.#cancelled || !left) {
            this.#failedChunkRaw.set(chunkIndex, lastFailedRaw);
            return null;
        }

        const right = await this.#processUnitsWithRetries(
            units.slice(mid),
            entries,
            glossary,
            contextWindow,
            chunkIndex,
            totalChunks,
            chunkStatuses,
            mergedTotal,
        );
        if (this.#cancelled || !right) {
            this.#failedChunkRaw.set(chunkIndex, lastFailedRaw);
            return null;
        }

        return {
            translations: [...left.translations, ...right.translations],
            warnings: [...left.warnings, ...right.warnings],
        };
    }
}
