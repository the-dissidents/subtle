import { expect, test } from "vitest";
import { GlossaryStore } from "./GlossaryStore";
import { validateResponse } from "./Validator";

function okPayload(
    pairs: Array<{ id: number | number[]; text: string }>,
    extra?: Record<string, unknown>,
) {
    const translations = pairs.map((p) => ({ ...p, ...(extra ?? {}) }));
    return JSON.stringify({ translations });
}

test("Layer 1: pass — valid JSON and translations shape", () => {
    const glossary = new GlossaryStore();
    const raw = okPayload([
        { id: 1, text: "你好" },
        { id: 2, text: "再见" },
    ]);
    const r = validateResponse(raw, [1, 2], ["a", "b"], glossary);
    expect(r.success).toBe(true);
    expect(r.failureLayer).toBeNull();
    expect(r.retryHint).toBeNull();
    expect(r.translations).toHaveLength(2);
});

test("Layer 1: fail — invalid JSON", () => {
    const glossary = new GlossaryStore();
    const r = validateResponse("not json", [1], ["a"], glossary);
    expect(r.success).toBe(false);
    expect(r.failureLayer).toBe(1);
    expect(r.translations).toBeNull();
    expect(r.retryHint).toContain("valid JSON");
});

test("Layer 1: fail — missing translations array", () => {
    const glossary = new GlossaryStore();
    const r = validateResponse(JSON.stringify({ foo: [] }), [1], ["a"], glossary);
    expect(r.success).toBe(false);
    expect(r.failureLayer).toBe(1);
    expect(r.retryHint).toMatch(/translations/i);
});

test("Layer 1: fail — element missing text", () => {
    const glossary = new GlossaryStore();
    const raw = JSON.stringify({ translations: [{ id: 1 }] });
    const r = validateResponse(raw, [1], ["a"], glossary);
    expect(r.success).toBe(false);
    expect(r.failureLayer).toBe(1);
});

test("Layer 1: pass — strips markdown fences", () => {
    const glossary = new GlossaryStore();
    const raw = "```json\n" + okPayload([{ id: 0, text: "x" }]) + "\n```";
    const r = validateResponse(raw, [0], ["s"], glossary);
    expect(r.success).toBe(true);
});

test("Layer 1: pass — handles BOM + surrounding whitespace", () => {
    const glossary = new GlossaryStore();
    const raw = ` \n\uFEFF${okPayload([{ id: 0, text: "x" }])}\n `;
    const r = validateResponse(raw, [0], ["s"], glossary);
    expect(r.success).toBe(true);
});

test("Layer 2: pass — compound ids normalized (sorted)", () => {
    const glossary = new GlossaryStore();
    const raw = okPayload([
        { id: [1, 0], text: "merged" },
        { id: 2, text: "two" },
    ]);
    const r = validateResponse(raw, [[0, 1], 2], ["ab", "c"], glossary);
    expect(r.success).toBe(true);
});

test("Layer 2: fail — wrong count", () => {
    const glossary = new GlossaryStore();
    const raw = okPayload([{ id: 1, text: "only" }]);
    const r = validateResponse(raw, [1, 2], ["a", "b"], glossary);
    expect(r.success).toBe(false);
    expect(r.failureLayer).toBe(2);
    expect(r.retryHint).toContain("1 translation");
    expect(r.retryHint).toContain("2 were expected");
});

test("Layer 2: fail — duplicate output ids", () => {
    const glossary = new GlossaryStore();
    const raw = okPayload([
        { id: 1, text: "a" },
        { id: 1, text: "b" },
    ]);
    const r = validateResponse(raw, [1, 2], ["x", "y"], glossary);
    expect(r.success).toBe(false);
    expect(r.failureLayer).toBe(2);
    expect(r.retryHint).toMatch(/duplicate|Duplicate/i);
});

test("Layer 2: fail — extra id", () => {
    const glossary = new GlossaryStore();
    const raw = okPayload([
        { id: 1, text: "a" },
        { id: 99, text: "b" },
    ]);
    const r = validateResponse(raw, [1, 2], ["x", "y"], glossary);
    expect(r.success).toBe(false);
    expect(r.failureLayer).toBe(2);
});

test("Layer 3: timecode fields ignored — still succeeds", () => {
    const glossary = new GlossaryStore();
    const raw = okPayload(
        [{ id: 1, text: "t" }],
        { start: "00:00:01,000", end: "00:00:02,000", gap_after: 1.5 },
    );
    const r = validateResponse(raw, [1], ["src"], glossary);
    expect(r.success).toBe(true);
    expect(r.translations?.[0]).toEqual({ id: 1, text: "t" });
});

test("Layer 4: warnings — empty, identical, length ratio, repeated", () => {
    const glossary = new GlossaryStore();
    const raw = okPayload([
        { id: 1, text: "   " },
        { id: 2, text: "same" },
        { id: 3, text: "xxxxxxxxxxxxxxxxxxxxxxxxxxxx" },
        { id: 4, text: "dup" },
        { id: 5, text: "dup" },
    ]);
    const r = validateResponse(raw, [1, 2, 3, 4, 5], ["x", "same", "xx", "a", "b"], glossary);
    expect(r.success).toBe(true);
    const types = new Set(r.warnings.map((w) => w.type));
    expect(types.has("empty_translation")).toBe(true);
    expect(types.has("identical_to_source")).toBe(true);
    expect(types.has("length_ratio")).toBe(true);
    expect(types.has("repeated_block")).toBe(true);
});

test("Layer 5: strips newlines and applies Chinese punctuation when output has Han", () => {
    const glossary = new GlossaryStore();
    const raw = okPayload([{ id: 0, text: "你好,\n世界." }]);
    const r = validateResponse(raw, [0], ["hello, world."], glossary);
    expect(r.success).toBe(true);
    expect(r.translations?.[0].text).toBe("你好，世界。");
});

test("Layer 5: no full-width swap when translation has no Han", () => {
    const glossary = new GlossaryStore();
    const raw = okPayload([{ id: 0, text: "Hello,\nworld." }]);
    const r = validateResponse(raw, [0], ["src"], glossary);
    expect(r.success).toBe(true);
    expect(r.translations?.[0].text).toBe("Hello, world.");
});

test("Layer 6: glossary mismatch warning", () => {
    const glossary = new GlossaryStore();
    glossary.add("Oppenheimer", "奥本海默");
    const raw = okPayload([{ id: 1, text: "这是别人" }]);
    const r = validateResponse(raw, [1], ["Oppenheimer speaks."], glossary);
    expect(r.success).toBe(true);
    expect(r.warnings.some((w) => w.type === "glossary_mismatch")).toBe(true);
});

test("Layer 6: glossary satisfied — no mismatch warning", () => {
    const glossary = new GlossaryStore();
    glossary.add("Oppenheimer", "奥本海默");
    const raw = okPayload([{ id: 1, text: "奥本海默说话了" }]);
    const r = validateResponse(raw, [1], ["Oppenheimer speaks."], glossary);
    expect(r.success).toBe(true);
    expect(r.warnings.filter((w) => w.type === "glossary_mismatch")).toHaveLength(0);
});

test("caller mismatch: expectedIds vs sourceTexts length", () => {
    const glossary = new GlossaryStore();
    const raw = okPayload([{ id: 1, text: "a" }]);
    const r = validateResponse(raw, [1], ["a", "b"], glossary);
    expect(r.success).toBe(false);
    expect(r.failureLayer).toBe(1);
    expect(r.retryHint).toContain("expectedIds and sourceTexts");
});
