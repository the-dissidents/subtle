/**
 * Cumulative glossary of source→target proper noun translations,
 * accumulated across chunks during a translation run and injected
 * into every subsequent chunk's system prompt.
 */
export class GlossaryStore {
    #entries = new Map<string, string>();

    add(source: string, target: string): void {
        const key = source.trim();
        const val = target.trim();
        if (key.length > 0 && val.length > 0) {
            this.#entries.set(key, val);
        }
    }

    has(source: string): boolean {
        return this.#entries.has(source.trim());
    }

    lookup(source: string): string | undefined {
        return this.#entries.get(source.trim());
    }

    getAll(): Record<string, string> {
        return Object.fromEntries(this.#entries);
    }

    get size(): number {
        return this.#entries.size;
    }

    clear(): void {
        this.#entries.clear();
    }

    toPromptString(): string {
        if (this.#entries.size === 0) return '';
        return Array.from(this.#entries)
            .map(([src, tgt]) => `${src} = ${tgt}`)
            .join('\n');
    }

    /**
     * Extract likely proper nouns from parallel source/translated texts
     * and add them to the glossary.
     *
     * Current heuristic: find capitalized multi-word sequences in source
     * text (e.g. "Manhattan Project") and estimate their translation by
     * positional alignment in the translated text.
     *
     * This is a best-effort placeholder — a future version may use the
     * LLM itself or NER to extract terms more accurately.
     */
    extractFromTranslation(sourceTexts: string[], translatedTexts: string[]): void {
        const len = Math.min(sourceTexts.length, translatedTexts.length);

        for (let i = 0; i < len; i++) {
            const names = extractProperNouns(sourceTexts[i]);
            if (names.length === 0) continue;

            for (const name of names) {
                if (this.has(name)) continue;
                const aligned = alignByPosition(
                    name, sourceTexts[i], translatedTexts[i]
                );
                if (aligned) {
                    this.add(name, aligned);
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Proper noun extraction heuristics
// ---------------------------------------------------------------------------

const CAPITALIZED_SEQUENCE =
    /\b([A-Z][a-zA-Z'-]*(?:\s+(?:of|the|and|de|von|van|for|in)\s+)?(?:[A-Z][a-zA-Z'-]*(?:\s+|$))*)/g;

const STOP_WORDS = new Set([
    'I', 'A', 'An', 'The', 'In', 'On', 'At', 'To', 'Is', 'It',
    'He', 'She', 'We', 'My', 'Do', 'If', 'So', 'No', 'Or', 'As',
    'But', 'Not', 'You', 'All', 'Can', 'Her', 'Was', 'One', 'Our',
    'Out', 'Are', 'Has', 'His', 'How', 'Its', 'May', 'New', 'Now',
    'Old', 'See', 'Way', 'Who', 'Did', 'Get', 'Let', 'Say', 'Too',
    'Use', 'Yes', 'Yet',
]);

function isStopWord(word: string): boolean {
    return STOP_WORDS.has(word);
}

/**
 * Find capitalized multi-word sequences that likely represent proper nouns.
 * Single capitalized words at the start of a sentence are excluded unless
 * they also appear mid-sentence elsewhere.
 */
export function extractProperNouns(text: string): string[] {
    const results: string[] = [];
    const seen = new Set<string>();

    let match: RegExpExecArray | null;
    while ((match = CAPITALIZED_SEQUENCE.exec(text)) !== null) {
        const raw = match[1].trim();
        if (raw.length === 0) continue;

        const words = raw.split(/\s+/).filter(w => w.length > 0);
        const meaningful = words.filter(w => !isStopWord(w));
        if (meaningful.length === 0) continue;

        const candidate = words.join(' ');

        if (words.length === 1) {
            const word = words[0];
            if (isStopWord(word)) continue;
            if (match.index === 0 || text[match.index - 1] === '.' ||
                text[match.index - 1] === '!' || text[match.index - 1] === '?' ||
                text[match.index - 2] === '.' || text.substring(0, match.index).endsWith('. ')) {
                const midSentence = new RegExp(
                    `[a-z,;]\\s+${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`
                );
                if (!midSentence.test(text)) continue;
            }
        }

        if (!seen.has(candidate)) {
            seen.add(candidate);
            results.push(candidate);
        }
    }

    return results;
}

/**
 * Estimate the translation of a source term by positional alignment.
 *
 * Finds where the term sits proportionally in the source text, then
 * extracts a corresponding window from the translated text. The window
 * size is scaled by the character-count ratio of the two texts.
 */
export function alignByPosition(
    term: string,
    sourceText: string,
    translatedText: string
): string | null {
    const srcIdx = sourceText.indexOf(term);
    if (srcIdx < 0) return null;

    const srcLen = sourceText.length;
    const tgtLen = translatedText.length;
    if (srcLen === 0 || tgtLen === 0) return null;

    const relStart = srcIdx / srcLen;
    const relEnd = (srcIdx + term.length) / srcLen;

    const charRatio = tgtLen / srcLen;
    const estLen = Math.max(1, Math.round(term.length * charRatio));

    const tgtCenter = Math.round(((relStart + relEnd) / 2) * tgtLen);
    const halfLen = Math.ceil(estLen / 2);
    const windowStart = Math.max(0, tgtCenter - halfLen);
    const windowEnd = Math.min(tgtLen, tgtCenter + halfLen);

    let start = windowStart;
    let end = windowEnd;

    const CJK_OR_PUNCT = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
    const BOUNDARY = /[\s,.:;!?，。：；！？、""''«»\-—()（）[\]]/;

    if (!CJK_OR_PUNCT.test(translatedText.slice(windowStart, windowEnd))) {
        while (start > 0 && !BOUNDARY.test(translatedText[start - 1])) start--;
        while (end < tgtLen && !BOUNDARY.test(translatedText[end])) end++;
    }

    const result = translatedText.slice(start, end).trim();
    if (result.length === 0) return null;

    const stripped = result.replace(/^[\s,.:;!?，。：；！？、""''«»\-—()（）[\]]+/, '')
                          .replace(/[\s,.:;!?，。：；！？、""''«»\-—()（）[\]]+$/, '');
    return stripped.length > 0 ? stripped : null;
}
