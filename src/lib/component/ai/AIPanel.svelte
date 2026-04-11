<script lang="ts">
import { onDestroy, untrack } from "svelte";
import { Collapsible, NumberInput, Tooltip } from "@the_dissidents/svelte-ui";
import { XIcon } from "@lucide/svelte";
import { _ } from "svelte-i18n";

import {
    BUILTIN_TEMPLATES,
    computeBatchSize,
    estimateTokensPerChunkRequest,
    type TranslationConfig,
    type TranslationTemplate,
} from "../../ai/PromptAssembler";
import { ProviderStore, type ProviderConfig } from "../../ai/ProviderConfig";
import { mergeEntries } from "../../ai/CrossLineMerger";
import {
    TranslationRun,
    type ChunkUiStatus,
    type TranslationProgress,
    TranslationStatusMap,
    type TranslationRunResult,
} from "../../ai/TranslationPipeline";
import { EventHost } from "../../details/EventHost";
import { Editing } from "../../frontend/Editing";
import { Source } from "../../frontend/Source";

type TemplateKind = "film" | "documentary" | "anime" | "custom";

const LANGUAGE_OPTIONS = [
    { value: "English", key: "ai.lang.english" },
    { value: "Chinese (Simplified)", key: "ai.lang.zh_cn" },
    { value: "Chinese (Traditional)", key: "ai.lang.zh_tw" },
    { value: "Japanese", key: "ai.lang.japanese" },
    { value: "Korean", key: "ai.lang.korean" },
    { value: "French", key: "ai.lang.french" },
    { value: "German", key: "ai.lang.german" },
    { value: "Spanish", key: "ai.lang.spanish" },
    { value: "Portuguese", key: "ai.lang.portuguese" },
    { value: "Italian", key: "ai.lang.italian" },
    { value: "Russian", key: "ai.lang.russian" },
    { value: "Arabic", key: "ai.lang.arabic" },
    { value: "Thai", key: "ai.lang.thai" },
    { value: "Vietnamese", key: "ai.lang.vietnamese" },
] as const;

type PanelUi = "config" | "running" | "results";

interface Props {
    open?: boolean;
    onClose?: () => void;
    /** Optional hook when Start is pressed (before the in-panel run begins). */
    onStart?: (detail: { config: TranslationConfig; provider: ProviderConfig }) => void;
}

let { open = $bindable(false), onClose, onStart }: Props = $props();

let panelUi = $state<PanelUi>("config");
let progressSnapshot = $state<TranslationProgress | null>(null);
let translationRun = $state<TranslationRun | null>(null);
let lastResult = $state<TranslationRunResult | null>(null);
let rawDialog: HTMLDialogElement | undefined = $state();
let rawModalText = $state("");
const progressListener = {};

let providers = $state(ProviderStore.loadProviders());
let selectedProviderName = $state(ProviderStore.activeProviderName.get());

let configureOpen = $state(false);
let pfName = $state("");
let pfEndpoint = $state("");
let pfApiKey = $state("");
let pfModel = $state("");
let pfMaxContext = $state(128_000);

let sourceLang = $state(LANGUAGE_OPTIONS[0].value);
let targetLang = $state(LANGUAGE_OPTIONS[1].value);
let filmTitle = $state("");
let templateKind = $state<TemplateKind>("film");
let specialInstructions = $state("");

let customStyle = $state("");
let customTone = $state("");

let advancedOpen = $state(false);
let advStyle = $state("");
let advTone = $state("");

let subsTick = $state(0);
let wasOpen = false;
const me = {};
onDestroy(() => {
    EventHost.unbind(me);
    EventHost.unbind(progressListener);
});

Source.onSubtitlesChanged.bind(me, () => {
    subsTick++;
});
Source.onSubtitleObjectReload.bind(me, () => {
    subsTick++;
});

function refreshProviders(): void {
    providers = ProviderStore.loadProviders();
    const active = ProviderStore.activeProviderName.get();
    selectedProviderName = active || providers[0]?.name || "";
}

async function closePanel(): Promise<void> {
    if (panelUi === "running" && translationRun) {
        translationRun.cancel();
    }
    if (panelUi === "results") {
        TranslationStatusMap.clear();
    }
    open = false;
    panelUi = "config";
    progressSnapshot = null;
    translationRun = null;
    lastResult = null;
    onClose?.();
}

function showRawResponse(text: string): void {
    rawModalText = text;
    rawDialog?.showModal();
}

function builtinForKind(kind: TemplateKind): TranslationTemplate {
    if (kind === "film") return { ...BUILTIN_TEMPLATES[0] };
    if (kind === "documentary") return { ...BUILTIN_TEMPLATES[1] };
    if (kind === "anime") return { ...BUILTIN_TEMPLATES[2] };
    return {
        name: "Custom",
        style: customStyle,
        tone: customTone,
    };
}

function buildTemplate(): TranslationTemplate | null {
    const base = builtinForKind(templateKind);
    if (templateKind === "custom" && (!customStyle.trim() || !customTone.trim())) {
        return null;
    }
    if (advancedOpen) {
        const style = advStyle.trim() || base.style;
        const tone = advTone.trim() || base.tone;
        if (!style || !tone) return null;
        return { name: base.name, style, tone };
    }
    if (!base.style.trim() || !base.tone.trim()) return null;
    return base;
}

const activeProvider = $derived(
    providers.find((p) => p.name === selectedProviderName),
);

const entryCount = $derived.by(() => {
    void subsTick;
    return Source.subs.entries.length;
});

const mergedUnitCount = $derived.by(() => {
    void subsTick;
    return mergeEntries(Source.subs.entries).length;
});

const batchEstimate = $derived(
    activeProvider
        ? computeBatchSize(activeProvider.maxContext, 0)
        : 1,
);

const chunkCountEstimate = $derived(
    Math.max(1, Math.ceil(Math.max(1, mergedUnitCount) / batchEstimate)),
);

const tokensPerChunkEstimate = $derived(
    estimateTokensPerChunkRequest(batchEstimate, 0),
);

const canStart = $derived.by(() => {
    if (!activeProvider) return false;
    if (!sourceLang || !targetLang) return false;
    if (!filmTitle.trim()) return false;
    return buildTemplate() !== null;
});

const CONFIGURE_SENTINEL = "__configure__";

function syncActiveProvider(): void {
    if (selectedProviderName === CONFIGURE_SENTINEL || selectedProviderName === "") return;
    try {
        ProviderStore.setActiveProvider(selectedProviderName);
    } catch {
        selectedProviderName = ProviderStore.activeProviderName.get();
    }
}

function onProviderChange(): void {
    if (selectedProviderName === CONFIGURE_SENTINEL) {
        const prev = ProviderStore.activeProviderName.get();
        openConfigureNew();
        selectedProviderName = prev;
        return;
    }
    syncActiveProvider();
}

function openConfigureNew(): void {
    configureOpen = true;
    pfName = "";
    pfEndpoint = "";
    pfApiKey = "";
    pfModel = "";
    pfMaxContext = 128_000;
}

function onAdvancedChanged(active: boolean): void {
    advancedOpen = active;
    if (active) {
        const b = builtinForKind(templateKind);
        if (!advStyle.trim()) advStyle = b.style;
        if (!advTone.trim()) advTone = b.tone;
    }
}

async function saveProviderForm(): Promise<void> {
    const name = pfName.trim();
    const endpoint = pfEndpoint.trim();
    const model = pfModel.trim();
    if (!name || !endpoint || !model || pfMaxContext < 1) return;

    ProviderStore.saveProvider({
        name,
        endpoint,
        model,
        maxContext: Math.floor(pfMaxContext),
    });
    if (pfApiKey.trim()) {
        await ProviderStore.storeApiKey(endpoint, pfApiKey.trim());
    }
    pfApiKey = "";
    ProviderStore.setActiveProvider(name);
    refreshProviders();
    configureOpen = false;
}

async function startTranslation(): Promise<void> {
    const provider = activeProvider;
    const template = buildTemplate();
    if (!provider || !template) return;

    const config: TranslationConfig = {
        sourceLang,
        targetLang,
        filmTitle: filmTitle.trim(),
        specialInstructions: specialInstructions.trim(),
        template,
    };
    onStart?.({ config, provider });

    TranslationStatusMap.clear();
    panelUi = "running";
    progressSnapshot = null;
    lastResult = null;

    const run = new TranslationRun(config, provider);
    translationRun = run;
    run.onProgress.bind(progressListener, (p: TranslationProgress) => {
        progressSnapshot = p;
    });

    try {
        const result = await run.start();
        lastResult = result;
        panelUi = result.cancelled ? "config" : "results";
        if (result.cancelled) {
            progressSnapshot = null;
        }
    } catch (e) {
        console.error(e);
        panelUi = "config";
    } finally {
        translationRun = null;
        EventHost.unbind(progressListener);
    }
}

function cancelRunning(): void {
    translationRun?.cancel();
}

async function revertAll(): Promise<void> {
    const n = lastResult?.commitsApplied ?? 0;
    for (let i = 0; i < n; i++) {
        if (!Source.canUndo()) break;
        await Source.undo();
    }
    TranslationStatusMap.clear();
    lastResult = null;
    panelUi = "config";
}

function acceptAll(): void {
    TranslationStatusMap.clear();
    lastResult = null;
    panelUi = "config";
    open = false;
    onClose?.();
}

function focusEntryRow(index: number): void {
    Editing.focusEntryForAiReview(index);
}

const resultCounts = $derived.by(() => {
    const r = lastResult;
    if (!r) return { ok: 0, warn: 0, fail: 0 };
    let ok = 0,
        warn = 0,
        fail = 0;
    for (const e of r.entries) {
        if (e.status === "success") ok++;
        else if (e.status === "warning") warn++;
        else fail++;
    }
    return { ok, warn, fail };
});

function chunkDotClass(s: ChunkUiStatus): string {
    return `ai-dot ai-dot--${s}`;
}

function chunkStatusLabel(s: ChunkUiStatus): string {
    return $_(`ai.chunk_${s}`);
}

$effect.pre(() => {
    if (open && !wasOpen) {
        // Avoid subscribing this effect to provider-related state it writes.
        untrack(() => refreshProviders());
    }
    wasOpen = open;
});
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
{#if open}
    <div class="ai-backdrop" onclick={closePanel} role="presentation"></div>
{/if}

<aside class={["ai-panel", open && "ai-panel--open"]}>
    <header class="ai-header hlayout">
        <h2 class="ai-title">{$_("ai.panel_title")}</h2>
        <Tooltip text={$_("ai.close_panel")} position="bottom">
            <button type="button" class="ai-icon-btn" onclick={closePanel} aria-label={$_("ai.close_panel")}>
                <XIcon size={18} />
            </button>
        </Tooltip>
    </header>

    <div class="ai-body vlayout">
        {#if panelUi === "config"}
        <section class="ai-section">
            <h3 class="ai-section-title">{$_("ai.section_provider")}</h3>
            <label class="ai-label" for="ai-provider">{$_("ai.provider")}</label>
            {#if providers.length === 0}
                <p class="ai-hint">{$_("ai.no_providers")}</p>
            {/if}
            <select
                id="ai-provider"
                class="ai-select stretch"
                bind:value={selectedProviderName}
                onchange={onProviderChange}
            >
                {#if providers.length === 0}
                    <option value="">{$_("ai.provider_placeholder")}</option>
                {:else}
                    {#each providers as p (p.name)}
                        <option value={p.name}>{p.name}</option>
                    {/each}
                {/if}
                <option value={CONFIGURE_SENTINEL}>{$_("ai.configure")}</option>
            </select>
            <button type="button" class="ai-secondary" onclick={openConfigureNew}>
                {$_("ai.add_provider")}
            </button>

            {#if configureOpen}
                <div class="ai-config-form vlayout">
                    <label class="ai-label" for="ai-pf-name">{$_("ai.provider_name")}</label>
                    <input id="ai-pf-name" type="text" class="ai-input" bind:value={pfName} />

                    <label class="ai-label" for="ai-pf-endpoint">{$_("ai.endpoint")}</label>
                    <input
                        id="ai-pf-endpoint"
                        type="text"
                        class="ai-input"
                        bind:value={pfEndpoint}
                        placeholder="https://api.openai.com/v1"
                    />

                    <label class="ai-label" for="ai-pf-key">{$_("ai.api_key")}</label>
                    <input id="ai-pf-key" type="password" class="ai-input" bind:value={pfApiKey} autocomplete="off" />

                    <label class="ai-label" for="ai-pf-model">{$_("ai.model")}</label>
                    <input id="ai-pf-model" type="text" class="ai-input" bind:value={pfModel} />

                    <label class="ai-label" for="ai-pf-ctx">{$_("ai.max_context")}</label>
                    <NumberInput class="ai-num" bind:value={pfMaxContext} />

                    <div class="hlayout ai-form-actions">
                        <button type="button" class="ai-secondary" onclick={() => (configureOpen = false)}>
                            {$_("cancel")}
                        </button>
                        <button type="button" class="ai-primary" onclick={() => void saveProviderForm()}>
                            {$_("ai.save_provider")}
                        </button>
                    </div>
                </div>
            {/if}
        </section>

        <section class="ai-section">
            <h3 class="ai-section-title">{$_("ai.section_languages")}</h3>
            <label class="ai-label" for="ai-src-lang">{$_("ai.source_language")}</label>
            <select id="ai-src-lang" class="ai-select stretch" bind:value={sourceLang}>
                {#each LANGUAGE_OPTIONS as opt (opt.value)}
                    <option value={opt.value}>{$_(opt.key)}</option>
                {/each}
            </select>

            <label class="ai-label" for="ai-tgt-lang">{$_("ai.target_language")}</label>
            <select id="ai-tgt-lang" class="ai-select stretch" bind:value={targetLang}>
                {#each LANGUAGE_OPTIONS as opt (opt.value)}
                    <option value={opt.value}>{$_(opt.key)}</option>
                {/each}
            </select>
        </section>

        <section class="ai-section">
            <h3 class="ai-section-title">{$_("ai.section_document")}</h3>
            <label class="ai-label" for="ai-film">{$_("ai.film_title")}</label>
            <input id="ai-film" type="text" class="ai-input stretch" bind:value={filmTitle} />

            <label class="ai-label" for="ai-template">{$_("ai.template")}</label>
            <select id="ai-template" class="ai-select stretch" bind:value={templateKind}>
                <option value="film">{$_("ai.template_film")}</option>
                <option value="documentary">{$_("ai.template_documentary")}</option>
                <option value="anime">{$_("ai.template_anime")}</option>
                <option value="custom">{$_("ai.template_custom")}</option>
            </select>

            {#if templateKind === "custom"}
                <label class="ai-label" for="ai-cust-style">{$_("ai.custom_style")}</label>
                <textarea id="ai-cust-style" class="ai-textarea" rows="3" bind:value={customStyle}></textarea>
                <label class="ai-label" for="ai-cust-tone">{$_("ai.custom_tone")}</label>
                <textarea id="ai-cust-tone" class="ai-textarea" rows="3" bind:value={customTone}></textarea>
            {/if}

            <label class="ai-label" for="ai-special">{$_("ai.special_instructions")}</label>
            <textarea id="ai-special" class="ai-textarea" rows="3" bind:value={specialInstructions}></textarea>
        </section>

        <Collapsible
            header={$_("ai.advanced")}
            active={advancedOpen}
            checked={advancedOpen}
            onActiveChanged={onAdvancedChanged}
        >
            <div class="ai-advanced-inner vlayout">
                <p class="ai-hint">{$_("ai.advanced_hint")}</p>
                <label class="ai-label" for="ai-adv-style">{$_("ai.template_style_field")}</label>
                <textarea id="ai-adv-style" class="ai-textarea" rows="4" bind:value={advStyle}></textarea>
                <label class="ai-label" for="ai-adv-tone">{$_("ai.template_tone_field")}</label>
                <textarea id="ai-adv-tone" class="ai-textarea" rows="4" bind:value={advTone}></textarea>
            </div>
        </Collapsible>

        <section class="ai-section ai-estimate">
            <h3 class="ai-section-title">{$_("ai.token_estimate_title")}</h3>
            <ul class="ai-estimate-list">
                <li>{$_("ai.estimate_entries", { values: { n: entryCount } })}</li>
                <li>{$_("ai.estimate_merged", { values: { n: mergedUnitCount } })}</li>
                <li>
                    {$_("ai.estimate_batch", {
                        values: { n: batchEstimate },
                    })}
                </li>
                <li>{$_("ai.estimate_chunks", { values: { n: chunkCountEstimate } })}</li>
                <li>
                    {$_("ai.estimate_tokens", {
                        values: { n: tokensPerChunkEstimate },
                    })}
                </li>
            </ul>
            <p class="ai-hint">{$_("ai.estimate_disclaimer")}</p>
        </section>

        <div class="ai-footer">
            <button type="button" class="ai-primary stretch" disabled={!canStart} onclick={() => void startTranslation()}>
                {$_("ai.start_translation")}
            </button>
        </div>
        {:else if panelUi === "running"}
        <section class="ai-section">
            <h3 class="ai-section-title">{$_("ai.state_running")}</h3>
            {#if progressSnapshot}
                <p class="ai-chunk-label">
                    {$_("ai.chunk_progress", {
                        values: {
                            current: (progressSnapshot.activeChunkIndex ?? progressSnapshot.chunkIndex) + 1,
                            total: progressSnapshot.totalChunks,
                        },
                    })}
                </p>
                <progress
                    class="ai-progress"
                    max={Math.max(1, progressSnapshot.totalChunks)}
                    value={Math.min(
                        progressSnapshot.totalChunks,
                        (progressSnapshot.activeChunkIndex ?? progressSnapshot.chunkIndex) + 1,
                    )}
                ></progress>
                <p class="ai-hint">{progressSnapshot.detail ?? ""}</p>
            {:else}
                <p class="ai-hint">{$_("ai.preparing")}</p>
            {/if}
        </section>

        <section class="ai-section">
            <h3 class="ai-section-title">{$_("ai.chunk_status_title")}</h3>
            <ul class="ai-chunk-list">
                {#each progressSnapshot?.chunkStatuses ?? [] as st, i (i)}
                    <li class="ai-chunk-row">
                        <span class={chunkDotClass(st)} title={chunkStatusLabel(st)}></span>
                        <span class="ai-chunk-idx">#{i + 1}</span>
                        <span class="ai-chunk-st">{chunkStatusLabel(st)}</span>
                    </li>
                {/each}
            </ul>
        </section>

        <section class="ai-section">
            <h3 class="ai-section-title">{$_("ai.glossary_preview")}</h3>
            <div class="ai-glossary-scroll">
                {#each Object.entries(progressSnapshot?.glossaryPreview ?? {}) as [src, tgt] (src)}
                    <div class="ai-glossary-line"><span class="ai-glossary-src">{src}</span> = {tgt}</div>
                {:else}
                    <p class="ai-hint">{$_("ai.glossary_empty")}</p>
                {/each}
            </div>
        </section>

        <div class="ai-footer">
            <button type="button" class="ai-secondary stretch" onclick={cancelRunning}>
                {$_("ai.cancel_translation")}
            </button>
        </div>
        {:else}
        <section class="ai-section">
            <h3 class="ai-section-title">{$_("ai.state_results")}</h3>
            <p class="ai-summary">
                {$_("ai.results_summary", {
                    values: {
                        ok: resultCounts.ok,
                        warn: resultCounts.warn,
                        fail: resultCounts.fail,
                    },
                })}
            </p>
        </section>

        {#if lastResult && Object.keys(lastResult.failedChunkRawResponses).length > 0}
            <section class="ai-section">
                <h3 class="ai-section-title">{$_("ai.failed_raw_title")}</h3>
                {#each Object.entries(lastResult.failedChunkRawResponses) as [idx, raw] (idx)}
                    <button
                        type="button"
                        class="ai-secondary stretch"
                        onclick={() => showRawResponse(raw)}
                    >
                        {$_("ai.view_raw_chunk", { values: { n: Number(idx) + 1 } })}
                    </button>
                {/each}
            </section>
        {/if}

        <section class="ai-section">
            <h3 class="ai-section-title">{$_("ai.flagged_entries")}</h3>
            <ul class="ai-flag-list">
                {#if lastResult}
                    {@const flagged = lastResult.entries.filter((e) => e.status !== "success")}
                    {#if flagged.length === 0}
                        <li class="ai-hint">{$_("ai.no_flagged")}</li>
                    {:else}
                        {#each flagged as e (e.index)}
                            <li>
                                <button
                                    type="button"
                                    class="ai-linkish"
                                    onclick={() => focusEntryRow(e.index)}
                                >
                                    {'#'}{e.index + 1} — {e.status}
                                    {#if e.messages.length}
                                        ({e.messages[0]})
                                    {/if}
                                </button>
                            </li>
                        {/each}
                    {/if}
                {/if}
            </ul>
        </section>

        <div class="ai-footer vlayout">
            <button type="button" class="ai-primary stretch" onclick={acceptAll}>
                {$_("ai.accept_all")}
            </button>
            <button type="button" class="ai-secondary stretch" onclick={() => void revertAll()}>
                {$_("ai.revert_all")}
            </button>
        </div>
        {/if}
    </div>

    <dialog bind:this={rawDialog} class="ai-raw-dialog">
        <form method="dialog" class="ai-raw-form">
            <h3>{$_("ai.raw_response_title")}</h3>
            <textarea class="ai-raw-text" readonly rows="16">{rawModalText}</textarea>
            <button type="submit" class="ai-primary">{$_("ok")}</button>
        </form>
    </dialog>
</aside>

<style lang="scss">
    .ai-backdrop {
        position: absolute;
        inset: 0;
        z-index: 900;
        background: color-mix(in oklab, var(--uchu-yin-1) 35%, transparent);
    }

    .ai-panel {
        position: absolute;
        top: 0;
        right: 0;
        bottom: 0;
        z-index: 901;
        display: flex;
        flex-direction: column;
        width: var(--ai-panel-width, min(28rem, 48vw));
        max-width: 100%;
        max-height: 100%;
        pointer-events: none;
        background: var(--uchu-yin-4);
        border-left: 1px solid var(--uchu-yin-6);
        box-shadow: -4px 0 24px color-mix(in oklab, var(--uchu-yin-1) 25%, transparent);
        transform: translateX(100%);
        transition: transform 0.22s ease-out;
    }

    .ai-panel--open {
        transform: translateX(0);
        pointer-events: auto;
    }

    .ai-header {
        flex-shrink: 0;
        align-items: center;
        justify-content: space-between;
        padding: 0.65rem 0.75rem;
        border-bottom: 1px solid var(--uchu-yin-6);
    }

    .ai-title {
        margin: 0;
        font-size: 1.05rem;
        font-weight: 600;
    }

    .ai-icon-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 0.35rem;
        border: none;
        border-radius: 6px;
        background: transparent;
        color: inherit;
        cursor: pointer;
    }

    .ai-icon-btn:hover {
        background: var(--uchu-yin-5);
    }

    .ai-body {
        flex: 1;
        min-height: 0;
        overflow-y: auto;
        padding: 0.6rem 0.75rem 1rem;
        gap: 0.75rem;
    }

    .ai-section {
        display: flex;
        flex-direction: column;
        gap: 0.35rem;
    }

    .ai-section-title {
        margin: 0 0 0.15rem;
        font-size: 0.85rem;
        font-weight: 600;
        opacity: 0.92;
    }

    .ai-label {
        font-size: 0.8rem;
        margin-top: 0.25rem;
    }

    .ai-input,
    .ai-select,
    .ai-textarea {
        font: inherit;
        font-size: var(--fontSize, 13px);
        padding: 0.35rem 0.45rem;
        border: 1px solid var(--uchu-yin-6);
        border-radius: 4px;
        background: var(--uchu-yin-3);
        color: inherit;
    }

    .ai-textarea {
        resize: vertical;
        min-height: 3rem;
    }

    .stretch {
        width: 100%;
        box-sizing: border-box;
    }

    :global(.ai-num) {
        width: 100%;
    }

    .ai-hint {
        margin: 0.15rem 0 0;
        font-size: 0.78rem;
        opacity: 0.8;
    }

    .ai-primary {
        padding: 0.45rem 0.75rem;
        border: none;
        border-radius: 6px;
        font-weight: 600;
        cursor: pointer;
        background: var(--uchu-blue-4, #3b82f6);
        color: var(--uchu-yin-1, #fff);
    }

    .ai-primary:disabled {
        opacity: 0.45;
        cursor: not-allowed;
    }

    .ai-secondary {
        margin-top: 0.35rem;
        padding: 0.35rem 0.55rem;
        border: 1px solid var(--uchu-yin-6);
        border-radius: 6px;
        background: var(--uchu-yin-5);
        color: inherit;
        cursor: pointer;
        font-size: 0.85rem;
        align-self: flex-start;
    }

    .ai-config-form {
        margin-top: 0.5rem;
        padding: 0.5rem;
        border-radius: 6px;
        background: var(--uchu-yin-3);
        border: 1px solid var(--uchu-yin-6);
        gap: 0.25rem;
    }

    .ai-form-actions {
        margin-top: 0.5rem;
        gap: 0.5rem;
        justify-content: flex-end;
    }

    .ai-advanced-inner {
        margin-top: 0.35rem;
        gap: 0.35rem;
    }

    .ai-estimate-list {
        margin: 0;
        padding-left: 1.1rem;
        font-size: 0.82rem;
    }

    .ai-estimate-list li {
        margin-bottom: 0.2rem;
    }

    .ai-footer {
        margin-top: auto;
        padding-top: 0.5rem;
    }

    .hlayout {
        display: flex;
        flex-direction: row;
    }

    .vlayout {
        display: flex;
        flex-direction: column;
    }
</style>
