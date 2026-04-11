import type { GlossaryStore } from "./GlossaryStore";

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface TranslationTemplate {
    name: string;
    style: string;
    tone: string;
}

export interface TranslationConfig {
    sourceLang: string;
    targetLang: string;
    filmTitle: string;
    specialInstructions: string;
    template: TranslationTemplate;
}

export interface ChunkPayload {
    entries: Array<{
        id: number | number[];
        text: string;
        start: string;
        end: string;
        gap_after: number;
    }>;
}

export interface ContextLine {
    id: number;
    source: string;
    target: string;
}

// ---------------------------------------------------------------------------
// Built-in templates
// ---------------------------------------------------------------------------

export const BUILTIN_TEMPLATES: readonly TranslationTemplate[] = [
    {
        name: "Film Subtitle",
        style: "Natural, idiomatic film subtitle translation. Prioritize readability and spoken rhythm over literal accuracy. Keep lines concise for on-screen display.",
        tone: "Conversational and dramatic where appropriate, matching the emotional register of each scene.",
    },
    {
        name: "Documentary",
        style: "Clear, informative documentary subtitle translation. Preserve factual precision and technical terminology. Maintain a neutral, authoritative voice.",
        tone: "Formal and measured, suitable for narration and interview content.",
    },
    {
        name: "Anime",
        style: "Vivid anime subtitle translation that captures character personality and genre conventions. Adapt cultural references and honorifics according to target-language norms.",
        tone: "Expressive and energetic, reflecting character archetypes and comedic or dramatic beats.",
    },
] as const;

// ---------------------------------------------------------------------------
// Prompt assembly
// ---------------------------------------------------------------------------

function buildContextBlock(contextWindow: ContextLine[]): string {
    const recent = contextWindow.slice(-5);
    if (recent.length === 0) return '';

    const lines = recent.map(
        c => `[${c.id}] ${c.source} → ${c.target}`
    );
    return `Previous context (for continuity — do NOT re-translate these):\n${lines.join('\n')}`;
}

export function assemblePrompt(
    config: TranslationConfig,
    chunk: ChunkPayload,
    glossary: GlossaryStore,
    contextWindow: ContextLine[],
): { system: string; user: string } {
    const n = chunk.entries.length;

    const systemParts: string[] = [
        'You are a subtitle translation engine.',
        '',
        'Output MUST be a JSON object with a "translations" array.',
        'Each element MUST have "id" (number or number[]) and "text" (string).',
        `The "translations" array MUST contain exactly ${n} elements.`,
        'Do NOT include any text outside the JSON object.',
    ];

    const glossaryStr = glossary.toPromptString();
    if (glossaryStr) {
        systemParts.push('', 'Glossary (use these established translations):', glossaryStr);
    }

    const contextBlock = buildContextBlock(contextWindow);
    if (contextBlock) {
        systemParts.push('', contextBlock);
    }

    const userParts: string[] = [];

    userParts.push(`Style: ${config.template.style}`);
    userParts.push(`Tone: ${config.template.tone}`);

    userParts.push('');
    userParts.push(`Source: ${config.sourceLang} → Target: ${config.targetLang}`);
    if (config.filmTitle) {
        userParts.push(`Film: ${config.filmTitle}`);
    }
    if (config.specialInstructions) {
        userParts.push(`Special: ${config.specialInstructions}`);
    }

    userParts.push('');
    userParts.push('Subtitles:');
    userParts.push(JSON.stringify(chunk.entries, null, 2));

    return {
        system: systemParts.join('\n'),
        user: userParts.join('\n'),
    };
}

// ---------------------------------------------------------------------------
// Dynamic batch sizing (Section 6.3)
// ---------------------------------------------------------------------------

const TOKENS_PER_LINE = 30;
const SYSTEM_PROMPT_TOKENS = 500;
const CONTEXT_TOKENS = 200;
const TOKENS_PER_GLOSSARY_ENTRY = 15;

export function computeBatchSize(maxContext: number, glossarySize: number): number {
    const glossaryTokens = glossarySize * TOKENS_PER_GLOSSARY_ENTRY;
    const available = maxContext - SYSTEM_PROMPT_TOKENS - CONTEXT_TOKENS - glossaryTokens;
    // ×2 accounts for both input and output tokens
    const batch = Math.floor(available / (TOKENS_PER_LINE * 2));
    return Math.max(1, batch);
}

/** Rough input+output token budget for one chunk request (Section 6.3 heuristics). */
export function estimateTokensPerChunkRequest(
    batchSize: number,
    glossaryEntryCount: number,
): number {
    const glossaryTokens = glossaryEntryCount * TOKENS_PER_GLOSSARY_ENTRY;
    return (
        SYSTEM_PROMPT_TOKENS +
        CONTEXT_TOKENS +
        glossaryTokens +
        batchSize * TOKENS_PER_LINE * 2
    );
}
