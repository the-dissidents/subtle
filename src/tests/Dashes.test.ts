import { expect, test, beforeAll } from 'vitest';
import { addMessages, init } from 'svelte-i18n';
import en from '../locales/en.json';
import { DashLinter, type DashesConfig } from '../lib/linter/Dashes';

beforeAll(() => {
    addMessages('en', en);
    void init({ fallbackLocale: 'en', initialLocale: 'en' });
});

function make(config: DashesConfig) {
    const linter = new DashLinter(config);
    return (text: string) => linter.check(text);
}

const baseDialog = { type: 'emDash', spaces: false, separateLines: false } as const;
const baseLatin = { type: 'emDash', spaces: false, endOnly: false } as const;

// ---------------------------------------------------------------------------
// CJK context: short unspaced dashes are dialog dashes, not broken CJK dashes
// ---------------------------------------------------------------------------

test('CJK short unspaced dash is treated as dialog, not wrong CJK dash', () => {
    const check = make({
        dialog: { type: 'horizontalBar', spaces: false, separateLines: false },
        dash: baseLatin,
        cjkDash: { type: 'standard', wordConnectors: false }
    });
    // '你好—世界': previously flagged as wrong CJK dash; now a (non-confident) dialog dash
    const diags = check('你好—世界');
    expect(diags).toHaveLength(1);
    expect(diags[0].description).toBe('use of non-preferred form of dialog dash');
    expect(diags[0].fix).toEqual({ substitute: '―', confident: false });
});

test('CJK correct long dash produces no diagnostic', () => {
    const check = make({
        dialog: baseDialog, dash: baseLatin,
        cjkDash: { type: 'standard', wordConnectors: false }
    });
    expect(check('你好——世界')).toHaveLength(0);
});

test('CJK long dash of wrong form is a confident CJK dash fix', () => {
    const check = make({
        dialog: baseDialog, dash: baseLatin,
        cjkDash: { type: 'standard', wordConnectors: false }
    });
    const diags = check('你好⸺世界');
    expect(diags).toHaveLength(1);
    expect(diags[0].fix).toEqual({ substitute: '——', confident: true });
});

test('CJK short spaced dash is a confident dialog dash', () => {
    const check = make({
        dialog: { type: 'emDash', spaces: false, separateLines: false },
        dash: baseLatin,
        cjkDash: { type: 'standard', wordConnectors: false }
    });
    // short + spaced cannot be a CJK dash, so we are confident it is a dialog dash
    const diags = check('你好 — 世界');
    expect(diags).toHaveLength(1);
    expect(diags[0].fix).toEqual({ substitute: '—', confident: true });
});

test('CJK long spaced dash is a non-confident dialog dash', () => {
    const check = make({
        dialog: { type: 'emDash', spaces: false, separateLines: false },
        dash: baseLatin,
        cjkDash: { type: 'standard', wordConnectors: false }
    });
    // long but spaced: guessed dialog dash, reported without confidence
    const diags = check('你好 —— 世界');
    expect(diags).toHaveLength(1);
    expect(diags[0].fix).toEqual({ substitute: '—', confident: false });
});

// ---------------------------------------------------------------------------
// A Latin dash requires both sides to be non-CJK
// ---------------------------------------------------------------------------

test('dash with one CJK side is not a plain Latin dash', () => {
    const check = make({
        dialog: { type: 'horizontalBar', spaces: false, separateLines: false },
        dash: { type: 'enDash', spaces: true, endOnly: false },
        cjkDash: { type: 'standard', wordConnectors: false }
    });
    // right side is CJK -> CJK context, short unspaced -> dialog (not confident)
    const diags = check('word—你好');
    expect(diags).toHaveLength(1);
    expect(diags[0].fix).toEqual({ substitute: '―', confident: false });
});

// ---------------------------------------------------------------------------
// Space-subsuming punctuation
// ---------------------------------------------------------------------------

test('no left space is required after a space-subsuming punctuation', () => {
    const check = make({
        dialog: { type: 'emDash', spaces: true, separateLines: false },
        dash: baseLatin,
        cjkDash: { type: 'standard', wordConnectors: false }
    });
    // '。' subsumes a following space, so we only add the right space, never the left one
    const diags = check('好。—世界');
    expect(diags).toHaveLength(1);
    expect(diags[0].fix).toEqual({ substitute: '— ', confident: true });
});

test('dash right after space-subsuming punctuation counts as spaced', () => {
    const check = make({
        dialog: { type: 'emDash', spaces: false, separateLines: false },
        dash: baseLatin,
        cjkDash: { type: 'standard', wordConnectors: false }
    });
    // short + subsumed-space -> confident dialog dash; already correct form -> no diagnostic
    expect(check('好。—世界')).toHaveLength(0);
});

// ---------------------------------------------------------------------------
// Preceding-space-subsuming punctuation
// ---------------------------------------------------------------------------

test('no right space is required before a preceding-space-subsuming punctuation', () => {
    const check = make({
        dialog: { type: 'emDash', spaces: true, separateLines: false },
        dash: baseLatin,
        cjkDash: { type: 'standard', wordConnectors: false }
    });
    // '「' subsumes a preceding space, so we only add the left space, never the right one
    const diags = check('你好—「世界」');
    expect(diags).toHaveLength(1);
    expect(diags[0].fix).toEqual({ substitute: ' —', confident: true });
});

test('dash right before preceding-space-subsuming punctuation counts as spaced', () => {
    const check = make({
        dialog: { type: 'emDash', spaces: true, separateLines: false },
        dash: baseLatin,
        cjkDash: { type: 'standard', wordConnectors: false }
    });
    // at start of line and subsumed on the right -> no space needed on either side
    expect(check('—「你好」')).toHaveLength(0);
});

// ---------------------------------------------------------------------------
// CJK word connectors
// ---------------------------------------------------------------------------

test('word connector checking flags hyphen as en-dash (not confident)', () => {
    const check = make({
        dialog: baseDialog, dash: baseLatin,
        cjkDash: { type: 'standard', wordConnectors: true }
    });
    const diags = check('让-吕克');
    expect(diags).toHaveLength(1);
    expect(diags[0].fix).toEqual({ substitute: '–', confident: false });
});

test('word connector already correct produces no diagnostic', () => {
    const check = make({
        dialog: baseDialog, dash: baseLatin,
        cjkDash: { type: 'standard', wordConnectors: true }
    });
    expect(check('让–吕克')).toHaveLength(0);
});

test('with word connectors off, short unspaced CJK dash is a dialog dash', () => {
    const check = make({
        dialog: { type: 'horizontalBar', spaces: false, separateLines: false },
        dash: baseLatin,
        cjkDash: { type: 'standard', wordConnectors: false }
    });
    const diags = check('让-吕克');
    expect(diags).toHaveLength(1);
    expect(diags[0].description).toBe('use of non-preferred form of dialog dash');
    expect(diags[0].fix).toEqual({ substitute: '―', confident: false });
});

// ---------------------------------------------------------------------------
// forbidden long CJK dashes
// ---------------------------------------------------------------------------

test('forbidden CJK dash type reports long dashes with no fix', () => {
    const check = make({
        dialog: baseDialog, dash: baseLatin,
        cjkDash: { type: 'forbidden', wordConnectors: false }
    });
    const diags = check('你好——世界');
    expect(diags).toHaveLength(1);
    expect(diags[0].description).toBe('Long CJK dashes are disallowed here.');
    expect(diags[0].fix).toBeUndefined();
});

// ---------------------------------------------------------------------------
// Beginning of line dialog dash in a CJK context is confident
// ---------------------------------------------------------------------------

test('start-of-line CJK dash is a confident dialog dash', () => {
    const check = make({
        dialog: { type: 'horizontalBar', spaces: false, separateLines: false },
        dash: baseLatin,
        cjkDash: { type: 'standard', wordConnectors: false }
    });
    const diags = check('—你好');
    expect(diags).toHaveLength(1);
    expect(diags[0].fix).toEqual({ substitute: '―', confident: true });
});

// ---------------------------------------------------------------------------
// cjkDash undefined: assume plain non-CJK text
// ---------------------------------------------------------------------------

test('with cjkDash undefined, hyphens inside CJK text are ignored', () => {
    const check = make({ dialog: baseDialog, dash: baseLatin });
    expect(check('你好-世界')).toHaveLength(0);
});

// ---------------------------------------------------------------------------
// Latin behavior is preserved
// ---------------------------------------------------------------------------

test('Latin dialog dash at start of line stays confident', () => {
    const check = make({
        dialog: { type: 'emDash', spaces: true, separateLines: false },
        dash: baseLatin
    });
    const diags = check('- Hello');
    expect(diags).toHaveLength(1);
    expect(diags[0].fix).toEqual({ substitute: '— ', confident: true });
});

test('Latin unspaced hyphen inside a word is ignored', () => {
    const check = make({ dialog: baseDialog, dash: baseLatin });
    expect(check('well-known')).toHaveLength(0);
});

// ---------------------------------------------------------------------------
// single dialog dash
// ---------------------------------------------------------------------------

test('a lone dialog dash is reported when enabled, with a removal fix', () => {
    const check = make({
        dialog: { type: 'emDash', spaces: false, separateLines: false, reportLoneDash: true },
        dash: baseLatin
    });
    // already-correct em-dash form, so the only diagnostic is the lone-dash report
    const diags = check('—Hello!');
    expect(diags).toHaveLength(1);
    expect(diags[0].description).toBe('Lone dialog dash');
    expect(diags[0].fix).toEqual({ substitute: '', confident: true });
});

test('two dialog dashes are not reported as a lone dash', () => {
    const check = make({
        dialog: { type: 'emDash', spaces: false, separateLines: false, reportLoneDash: true },
        dash: baseLatin
    });
    expect(check('—Hello!\n—Hi')).toHaveLength(0);
});

test('a lone dialog dash is not reported by default', () => {
    const check = make({ dialog: baseDialog, dash: baseLatin });
    expect(check('—Hello!')).toHaveLength(0);
});

// ---------------------------------------------------------------------------
// missing leading dialog dash
// ---------------------------------------------------------------------------

const missingConfig = {
    type: 'emDash', spaces: true, separateLines: false,
    reportLoneDash: true, reportMissingDash: true
} as const;

test('a dash on a later line is not reported as a lone dash', () => {
    const check = make({
        dialog: { type: 'emDash', spaces: true, separateLines: false, reportLoneDash: true },
        dash: baseLatin
    });
    expect(check('First line.\n— Second line.')).toHaveLength(0);
});

test('a missing leading dash is reported for a dash on a later line', () => {
    const check = make({ dialog: missingConfig, dash: baseLatin });
    const diags = check('First line.\n— Second line.');
    expect(diags).toHaveLength(1);
    expect(diags[0].description).toBe('Missing dialog dash at the beginning of the entry.');
    expect(diags[0]).toMatchObject({ start: 0, to: 0 });
    expect(diags[0].fix).toEqual({ substitute: '— ', confident: true });
});

test('a missing leading dash is reported for a mid-line dash', () => {
    const check = make({ dialog: missingConfig, dash: baseLatin });
    const diags = check('First line. — Second line.');
    expect(diags).toHaveLength(1);
    expect(diags[0]).toMatchObject({ start: 0, to: 0 });
    expect(diags[0].fix).toEqual({ substitute: '— ', confident: true });
});

test('no missing leading dash is reported when the entry begins with one', () => {
    const check = make({ dialog: missingConfig, dash: baseLatin });
    expect(check('— First line. — Second line.')).toHaveLength(0);
});

test('a mid-line dash also triggers the separate-lines report', () => {
    const check = make({
        dialog: { ...missingConfig, separateLines: true },
        dash: baseLatin
    });
    const descriptions = check('First line. — Second line.').map((x) => x.description);
    expect(descriptions).toContain('Dialog dashes should begin on a new line.');
    expect(descriptions).toContain('Missing dialog dash at the beginning of the entry.');
});

test('a missing leading dash is inserted after leading whitespace', () => {
    const check = make({ dialog: missingConfig, dash: baseLatin });
    const diags = check('  First line. — Second line.');
    expect(diags).toHaveLength(1);
    expect(diags[0]).toMatchObject({ start: 2, to: 2 });
});

test('a missing leading dash is not reported by default', () => {
    const check = make({
        dialog: { type: 'emDash', spaces: true, separateLines: false },
        dash: baseLatin
    });
    expect(check('First line.\n— Second line.')).toHaveLength(0);
});

test('an ambiguous CJK dash does not trigger a missing leading dash', () => {
    const check = make({
        dialog: {
            type: 'hyphenMinus', spaces: false, separateLines: false,
            reportMissingDash: true
        },
        dash: baseLatin,
        cjkDash: { type: 'standard', wordConnectors: false }
    });
    // the only dash is an unconfident word-connector/dialog guess, so no insertion
    expect(check('让-吕克')).toHaveLength(0);
});
