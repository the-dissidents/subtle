import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { TranslationConfig } from "./PromptAssembler";
import type { ProviderConfig } from "./ProviderConfig";
import { TranslationRun, TranslationStatusMap } from "./TranslationPipeline";
import { MAPI } from "../API";
import { ChangeType, Source } from "../frontend/Source";

vi.mock("../Basic", () => ({
    Basic: {
        formatTimestamp: (s: number) => `${s.toFixed(3)}`,
    },
}));

vi.mock("../API", () => ({
    MAPI: {
        translateChunk: vi.fn(),
    },
}));

vi.mock("../frontend/Source", () => ({
    ChangeType: {
        General: 6,
    },
    Source: {
        subs: {
            entries: [],
            defaultStyle: "Default",
        },
        markChanged: vi.fn(async () => {}),
    },
}));

const baseConfig: TranslationConfig = {
    sourceLang: "English",
    targetLang: "Chinese (Simplified)",
    filmTitle: "Test",
    specialInstructions: "",
    template: {
        name: "Film Subtitle",
        style: "Natural",
        tone: "Conversational",
    },
};

function provider(maxContext: number): ProviderConfig {
    return {
        name: "mock",
        endpoint: "https://example.com/v1",
        model: "mock-model",
        maxContext,
    };
}

function entry(start: number, end: number, text: string) {
    return {
        start,
        end,
        texts: new Map([[Source.subs.defaultStyle, text]]),
    };
}

function asResponse(items: Array<{ id: number | number[]; text: string }>): string {
    return JSON.stringify({ translations: items });
}

beforeEach(() => {
    Source.subs.entries = [];
    TranslationStatusMap.clear();
    vi.mocked(MAPI.translateChunk).mockReset();
    vi.mocked(Source.markChanged).mockReset();
    vi.mocked(Source.markChanged).mockResolvedValue(undefined);
});

afterEach(() => {
    vi.restoreAllMocks();
});

test("full pipeline commit: invoke -> validate -> reconcile -> commit", async () => {
    Source.subs.entries = [entry(0, 1, "Hello"), entry(1, 2, "World")];
    vi.mocked(MAPI.translateChunk).mockResolvedValue(
        asResponse([{ id: 0, text: "你好" }, { id: 1, text: "世界" }]),
    );

    const run = new TranslationRun(baseConfig, provider(820)); // batch ~= 2
    const result = await run.start();

    expect(result.cancelled).toBe(false);
    expect(result.entries.map((x) => x.status)).toEqual(["success", "success"]);
    expect(Source.subs.entries[0].texts.get(Source.subs.defaultStyle)).toBe("你好");
    expect(Source.subs.entries[1].texts.get(Source.subs.defaultStyle)).toBe("世界");
    expect(MAPI.translateChunk).toHaveBeenCalledTimes(1);
    expect(Source.markChanged).toHaveBeenCalledTimes(1);
    expect(Source.markChanged).toHaveBeenCalledWith(ChangeType.General, "AI translate chunk 1");
    expect(result.commitsApplied).toBe(1);
});

test("commitsApplied matches markChanged calls across multiple chunks", async () => {
    Source.subs.entries = [entry(0, 1, "A"), entry(1, 2, "B"), entry(2, 3, "C")];
    vi.mocked(MAPI.translateChunk).mockImplementation(async (prompt: string) => {
        if (prompt.includes('"id": 0')) return asResponse([{ id: 0, text: "甲" }]);
        if (prompt.includes('"id": 1')) return asResponse([{ id: 1, text: "乙" }]);
        return asResponse([{ id: 2, text: "丙" }]);
    });

    const run = new TranslationRun(baseConfig, provider(760)); // batch = 1 -> 3 commits
    const result = await run.start();
    expect(result.cancelled).toBe(false);
    expect(Source.markChanged).toHaveBeenCalledTimes(3);
    expect(result.commitsApplied).toBe(3);
});

test("progressive retry: wrong ID count -> hint retry -> halved batch retry", async () => {
    Source.subs.entries = [entry(0, 1, "A"), entry(1, 2, "B")];
    const prompts: string[] = [];
    vi.mocked(MAPI.translateChunk).mockImplementation(async (prompt: string) => {
        prompts.push(prompt);
        const n = prompts.length;
        if (n <= 2) {
            // Layer-2 mismatch (count=1 while expected=2), first without hint then with hint.
            return asResponse([{ id: 0, text: "甲" }]);
        }
        // Halved branch (left then right)
        if (n === 3) return asResponse([{ id: 0, text: "甲" }]);
        return asResponse([{ id: 1, text: "乙" }]);
    });

    const run = new TranslationRun(baseConfig, provider(820)); // batch ~= 2
    const result = await run.start();

    expect(result.cancelled).toBe(false);
    expect(result.entries.every((x) => x.status === "success")).toBe(true);
    expect(prompts.length).toBe(4);
    expect(prompts[1]).toContain("Your previous response had");
    expect(Source.subs.entries[0].texts.get(Source.subs.defaultStyle)).toBe("甲");
    expect(Source.subs.entries[1].texts.get(Source.subs.defaultStyle)).toBe("乙");
});

test("cancellation mid-run returns cancelled and avoids commit", async () => {
    Source.subs.entries = [entry(0, 1, "Line 1")];
    let resolveResponse: ((v: string) => void) | null = null;
    vi.mocked(MAPI.translateChunk).mockImplementation(
        () =>
            new Promise<string>((resolve) => {
                resolveResponse = resolve;
            }),
    );

    const run = new TranslationRun(baseConfig, provider(760)); // batch = 1
    const p = run.start();
    run.cancel();
    resolveResponse?.(asResponse([{ id: 0, text: "测试" }]));
    const result = await p;

    expect(result.cancelled).toBe(true);
    expect(result.commitsApplied).toBe(0);
    expect(Source.markChanged).toHaveBeenCalledTimes(0);
});

test("cross-line merge + split round-trip applies split parts", async () => {
    Source.subs.entries = [
        entry(0, 1.8, "I think that..."),
        entry(1.8, 4.4, "...we should go."),
    ];
    vi.mocked(MAPI.translateChunk).mockResolvedValue(
        asResponse([{ id: [0, 1], text: "我觉得我们应该走了。" }]),
    );

    const run = new TranslationRun(baseConfig, provider(820));
    const result = await run.start();

    expect(result.entries.map((x) => x.status)).toEqual(["success", "success"]);
    const t0 = Source.subs.entries[0].texts.get(Source.subs.defaultStyle) ?? "";
    const t1 = Source.subs.entries[1].texts.get(Source.subs.defaultStyle) ?? "";
    expect(t0.length).toBeGreaterThan(0);
    expect(t1.length).toBeGreaterThan(0);
    expect(t0 + t1).toBe("我觉得我们应该走了。");
});

test("glossary accumulates and sliding context carries last 5 lines", async () => {
    Source.subs.entries = [
        entry(0, 1, "Meet Alice now"),
        entry(1, 2, "Meet Bob now"),
        entry(2, 3, "Meet Carol now"),
        entry(3, 4, "Meet Dave now"),
        entry(4, 5, "Meet Eve now"),
        entry(5, 6, "Meet Frank now"),
    ];
    const prompts: string[] = [];
    vi.mocked(MAPI.translateChunk).mockImplementation(async (prompt: string) => {
        prompts.push(prompt);
        const i = prompts.length - 1;
        const names = ["爱丽丝", "鲍勃", "卡萝尔", "戴夫", "伊芙", "弗兰克"];
        return asResponse([{ id: i, text: `见到${names[i]}` }]);
    });

    const run = new TranslationRun(baseConfig, provider(760)); // batch = 1 => 6 chunks
    const result = await run.start();

    expect(result.cancelled).toBe(false);
    // 2nd prompt already gets glossary from 1st chunk.
    expect(prompts[1]).toContain("Alice = ");
    // 6th chunk should include exactly last 5 ids [0..4] as context.
    expect(prompts[5]).toContain("[0] Meet Alice now");
    expect(prompts[5]).toContain("[4] Meet Eve now");
    expect(prompts[5]).not.toContain("[5] Meet Frank now →");
});

test("empty/blank source handling and API error continuation", async () => {
    // Empty list => throw and no invoke
    Source.subs.entries = [];
    const invokeSpy = vi.mocked(MAPI.translateChunk);
    invokeSpy.mockResolvedValue(asResponse([]));
    const runEmpty = new TranslationRun(baseConfig, provider(760));
    await expect(runEmpty.start()).rejects.toThrow(/No subtitle entries/);
    expect(invokeSpy).toHaveBeenCalledTimes(0);

    // Blank text is skipped; first non-empty chunk fails, next chunk still proceeds.
    Source.subs.entries = [entry(0, 1, ""), entry(1, 2, "First"), entry(2, 3, "Second")];
    invokeSpy.mockReset();
    invokeSpy
        .mockRejectedValueOnce(new Error("timeout"))
        .mockResolvedValueOnce(asResponse([{ id: 2, text: "第二个" }]));

    const run = new TranslationRun(baseConfig, provider(760)); // batch = 1
    const result = await run.start();
    expect(result.cancelled).toBe(false);
    expect(result.entries[0].status).toBe("success"); // skipped blank entry
    expect(result.entries[1].status).toBe("failed"); // first translated chunk failed via API error
    expect(result.entries[2].status).toBe("success"); // second chunk continues and succeeds
});

