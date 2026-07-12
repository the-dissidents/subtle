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
