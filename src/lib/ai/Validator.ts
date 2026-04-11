import type { GlossaryStore } from "./GlossaryStore";

export type ValidationResult = {
    success: boolean;
    translations: Array<{ id: number | number[]; text: string }> | null;
    warnings: Array<{ id: number | number[]; type: string; message: string }>;
    failureLayer: number | null;
    retryHint: string | null;
};

function stripJsonFences(raw: string): string {
    let s = raw.trim();
    if (s.charCodeAt(0) === 0xfeff) {
        s = s.slice(1);
    }
    const fence = /^```(?:json)?\s*([\s\S]*?)```$/im;
    const m = s.match(fence);
    if (m) s = m[1].trim();
    if (s.charCodeAt(0) === 0xfeff) {
        s = s.slice(1);
    }
    return s;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
    return typeof v === "object" && v !== null && !Array.isArray(v);
}

function normalizeId(value: unknown): number | number[] | null {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (Array.isArray(value)) {
        const nums = value.filter((x): x is number => typeof x === "number" && Number.isFinite(x));
        if (nums.length !== value.length || nums.length === 0) return null;
        return [...nums].sort((a, b) => a - b);
    }
    return null;
}

function idKey(id: number | number[]): string {
    return Array.isArray(id) ? JSON.stringify(id) : String(id);
}

function parseTranslationsLayer1(raw: string): {
    items: Array<{ id: number | number[]; text: string; extras: Record<string, unknown> }>;
} | { error: string } {
    let parsed: unknown;
    try {
        parsed = JSON.parse(stripJsonFences(raw));
    } catch {
        return { error: "JSON.parse failed" };
    }
    if (!isPlainObject(parsed)) {
        return { error: "Root must be a JSON object" };
    }
    const arr = parsed["translations"];
    if (!Array.isArray(arr)) {
        return { error: 'Missing or invalid "translations" array' };
    }
    const items: Array<{ id: number | number[]; text: string; extras: Record<string, unknown> }> = [];
    for (let i = 0; i < arr.length; i++) {
        const el = arr[i];
        if (!isPlainObject(el)) {
            return { error: `translations[${i}] must be an object` };
        }
        if (!("id" in el) || !("text" in el)) {
            return { error: `translations[${i}] must have "id" and "text"` };
        }
        const id = normalizeId(el["id"]);
        if (id === null) {
            return { error: `translations[${i}].id must be a number or array of numbers` };
        }
        const textVal = el["text"];
        if (typeof textVal !== "string") {
            return { error: `translations[${i}].text must be a string` };
        }
        items.push({ id, text: textVal, extras: el });
    }
    return { items };
}

function layer2Check(
    items: Array<{ id: number | number[]; text: string }>,
    expectedIds: (number | number[])[],
): { ok: true } | { ok: false; reason: string; outputCount: number; expectedCount: number } {
    const expectedKeys = new Set(expectedIds.map(idKey));
    const seen = new Set<string>();

    if (expectedKeys.size !== expectedIds.length) {
        return {
            ok: false,
            reason: "Duplicate IDs in expectedIds",
            outputCount: items.length,
            expectedCount: expectedIds.length,
        };
    }

    if (items.length !== expectedIds.length) {
        return {
            ok: false,
            reason: "Translation count does not match expected ID count",
            outputCount: items.length,
            expectedCount: expectedIds.length,
        };
    }

    for (const it of items) {
        const k = idKey(it.id);
        if (seen.has(k)) {
            return {
                ok: false,
                reason: "Duplicate IDs in output",
                outputCount: items.length,
                expectedCount: expectedIds.length,
            };
        }
        seen.add(k);
    }

    if (seen.size !== expectedKeys.size) {
        return {
            ok: false,
            reason: "ID set size mismatch",
            outputCount: items.length,
            expectedCount: expectedIds.length,
        };
    }

    for (const k of seen) {
        if (!expectedKeys.has(k)) {
            return {
                ok: false,
                reason: "Output ID set does not match expected IDs",
                outputCount: items.length,
                expectedCount: expectedIds.length,
            };
        }
    }

    return { ok: true };
}

function discardTimecodes(
    items: Array<{ id: number | number[]; text: string; extras: Record<string, unknown> }>,
): Array<{ id: number | number[]; text: string }> {
    return items.map(({ id, text }) => ({ id, text }));
}

const HALF_TO_FULL: Record<string, string> = {
    ",": "，",
    ".": "。",
    "!": "！",
    "?": "？",
};

function cleanupChinesePunctuation(text: string): string {
    let out = "";
    for (const ch of text) {
        out += HALF_TO_FULL[ch] ?? ch;
    }
    return out;
}

function translationLooksChinese(text: string): boolean {
    return /\p{Script=Han}/u.test(text);
}

function stripNewlines(text: string): string {
    return text.replace(/\r\n|\r|\n/g, " ").replace(/\s+/g, " ").trim();
}

/** Remove stray ASCII spaces immediately after full-width sentence punctuation. */
function tightenAfterFullWidthPunct(text: string): string {
    return text.replace(/([，。！？])\s+/g, "$1");
}

/**
 * Six-layer validation pipeline for LLM translation JSON (Section 5).
 * Layers 1–2 failures set success=false and retryHint. Layers 3–6 run on success path;
 * 4 and 6 add warnings; 5 mutates text in place.
 */
export function validateResponse(
    raw: string,
    expectedIds: (number | number[])[],
    sourceTexts: string[],
    glossary: GlossaryStore,
): ValidationResult {
    const warnings: ValidationResult["warnings"] = [];

    if (expectedIds.length !== sourceTexts.length) {
        return {
            success: false,
            translations: null,
            warnings: [],
            failureLayer: 1,
            retryHint:
                "Internal error: expectedIds and sourceTexts length mismatch. Fix the caller before retrying.",
        };
    }

    const p1 = parseTranslationsLayer1(raw);
    if ("error" in p1) {
        return {
            success: false,
            translations: null,
            warnings: [],
            failureLayer: 1,
            retryHint:
                'Your response must be valid JSON with a top-level object containing a "translations" array. ' +
                'Each element must have "id" (number or array of numbers) and "text" (string). ' +
                `Parse/structure error: ${p1.error}.`,
        };
    }

    const l2 = layer2Check(p1.items, expectedIds);
    if (!l2.ok) {
        const n = l2.outputCount;
        const m = l2.expectedCount;
        return {
            success: false,
            translations: null,
            warnings: [],
            failureLayer: 2,
            retryHint:
                `Your previous response had ${n} translation(s) but ${m} were expected. ` +
                "The set of output IDs must exactly match the input IDs (no missing, no extra, no duplicates). " +
                `${l2.reason}.`,
        };
    }

    let working = discardTimecodes(p1.items);

    const byId = new Map<string, { id: number | number[]; text: string }>();
    for (const it of working) {
        byId.set(idKey(it.id), it);
    }

    for (let i = 0; i < expectedIds.length; i++) {
        const id = expectedIds[i];
        const src = sourceTexts[i];
        const row = byId.get(idKey(id));
        if (!row) continue;

        const t = row.text;
        if (t.trim().length === 0) {
            warnings.push({
                id,
                type: "empty_translation",
                message: "Translation is empty",
            });
        }
        if (t === src) {
            warnings.push({
                id,
                type: "identical_to_source",
                message: "Translation is identical to source text",
            });
        }
        const srcLen = src.length;
        if (srcLen > 0 && t.length >= 3 * srcLen) {
            warnings.push({
                id,
                type: "length_ratio",
                message: `Translation length is at least 3× source (${t.length} vs ${srcLen} chars)`,
            });
        }
    }

    const textCount = new Map<string, number>();
    for (const it of working) {
        const key = it.text.trim();
        textCount.set(key, (textCount.get(key) ?? 0) + 1);
    }
    for (const it of working) {
        const key = it.text.trim();
        if (key.length > 0 && (textCount.get(key) ?? 0) > 1) {
            warnings.push({
                id: it.id,
                type: "repeated_block",
                message: "Same translated text appears more than once in this batch",
            });
        }
    }

    const applyChinesePunc = working.some((w) => translationLooksChinese(w.text));
    working = working.map((w) => {
        let text = stripNewlines(w.text);
        if (applyChinesePunc) {
            text = cleanupChinesePunctuation(text);
            text = tightenAfterFullWidthPunct(text);
        }
        return { id: w.id, text };
    });

    const glossaryEntries = Object.entries(glossary.getAll());
    for (let i = 0; i < expectedIds.length; i++) {
        const id = expectedIds[i];
        const src = sourceTexts[i];
        const row = byId.get(idKey(id));
        if (!row) continue;
        const translated = working.find((w) => idKey(w.id) === idKey(id))?.text ?? row.text;

        for (const [term, expected] of glossaryEntries) {
            if (term.length === 0) continue;
            if (!src.includes(term)) continue;
            if (!translated.includes(expected)) {
                warnings.push({
                    id,
                    type: "glossary_mismatch",
                    message: `Source contains glossary term "${term}" but translation does not include expected "${expected}"`,
                });
            }
        }
    }

    return {
        success: true,
        translations: working,
        warnings,
        failureLayer: null,
        retryHint: null,
    };
}
