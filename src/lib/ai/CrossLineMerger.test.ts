import { expect, test } from 'vitest';
import { SubtitleEntry, SubtitleStyle } from '../core/Subtitles.svelte';
import {
    mergeEntries,
    mergeTexts,
    shouldMergeWithNext,
    splitTranslation,
    type MergedUnit
} from './CrossLineMerger';

const style = SubtitleStyle.new('test');

function entry(start: number, end: number, text: string): SubtitleEntry {
    const e = new SubtitleEntry(start, end);
    e.texts.set(style, text);
    return e;
}

// ---- heuristic detection ----

test('shouldMergeWithNext: trailing ellipsis (ASCII)', () => {
    expect(shouldMergeWithNext('I think that...', 'we should go.')).toBe(true);
});

test('shouldMergeWithNext: trailing ellipsis (Unicode)', () => {
    expect(shouldMergeWithNext('I think that\u2026', 'we should go.')).toBe(true);
});

test('shouldMergeWithNext: lowercase continuation', () => {
    expect(shouldMergeWithNext('We need to talk about', 'something important.')).toBe(true);
});

test('shouldMergeWithNext: unclosed double quote', () => {
    expect(shouldMergeWithNext('She said, "I don\'t', 'think so."')).toBe(true);
});

test('shouldMergeWithNext: no merge for independent sentences', () => {
    expect(shouldMergeWithNext('Hello, world.', 'Good morning.')).toBe(false);
});

// ---- mergeTexts ----

test('mergeTexts: strips boundary ellipsis and joins', () => {
    expect(mergeTexts(['I think that...', '...we should go.']))
        .toBe('I think that we should go.');
});

test('mergeTexts: three fragments with ellipsis', () => {
    expect(mergeTexts(['I think...', '...that we...', '...should go.']))
        .toBe('I think that we should go.');
});

test('mergeTexts: no ellipsis (lowercase continuation)', () => {
    expect(mergeTexts(['We need to talk about', 'something important.']))
        .toBe('We need to talk about something important.');
});

// ---- mergeEntries ----

test('mergeEntries: normal entries produce one unit each', () => {
    const entries = [
        entry(0, 2, 'Hello, world.'),
        entry(3, 5, 'Good morning.'),
        entry(6, 8, 'How are you?'),
    ];
    const units = mergeEntries(entries);
    expect(units).toHaveLength(3);
    expect(units[0]).toEqual({ ids: [0], text: 'Hello, world.', durations: [2] });
    expect(units[1]).toEqual({ ids: [1], text: 'Good morning.', durations: [2] });
    expect(units[2]).toEqual({ ids: [2], text: 'How are you?', durations: [2] });
});

test('mergeEntries: ellipsis continuation merges two entries', () => {
    const entries = [
        entry(0, 1.8, 'I think that...'),
        entry(1.8, 4.4, '...we should go.'),
        entry(5, 7, 'Absolutely.'),
    ];
    const units = mergeEntries(entries);
    expect(units).toHaveLength(2);
    expect(units[0]).toEqual({
        ids: [0, 1],
        text: 'I think that we should go.',
        durations: [1.8, 2.6],
    });
    expect(units[1]).toEqual({ ids: [2], text: 'Absolutely.', durations: [2] });
});

test('mergeEntries: lowercase continuation', () => {
    const entries = [
        entry(0, 2, 'We need to talk about'),
        entry(2, 4, 'something important.'),
    ];
    const units = mergeEntries(entries);
    expect(units).toHaveLength(1);
    expect(units[0]).toEqual({
        ids: [0, 1],
        text: 'We need to talk about something important.',
        durations: [2, 2],
    });
});

test('mergeEntries: three consecutive fragments merged into one', () => {
    const entries = [
        entry(0, 1, 'I think...'),
        entry(1, 2.5, '...that we...'),
        entry(2.5, 4, '...should go.'),
        entry(5, 7, 'OK.'),
    ];
    const units = mergeEntries(entries);
    expect(units).toHaveLength(2);
    expect(units[0]).toEqual({
        ids: [0, 1, 2],
        text: 'I think that we should go.',
        durations: [1, 1.5, 1.5],
    });
    expect(units[1]).toEqual({ ids: [3], text: 'OK.', durations: [2] });
});

// ---- splitTranslation ----

test('splitTranslation: single entry returns full text', () => {
    const unit: MergedUnit = { ids: [0], text: 'Hello', durations: [2] };
    expect(splitTranslation(unit, '你好')).toEqual(['你好']);
});

test('splitTranslation: splits by duration ratio', () => {
    // 1.8s + 2.6s = 4.4s → ratios ≈ 41% / 59%
    const unit: MergedUnit = {
        ids: [0, 1],
        text: 'I think that we should go.',
        durations: [1.8, 2.6],
    };
    const translated = '我觉得我们应该走了。';
    const parts = splitTranslation(unit, translated);
    expect(parts).toHaveLength(2);
    // 9 chars total, 41% ≈ 4 chars → split at index 4
    expect(parts[0]).toBe('我觉得我');
    expect(parts[1]).toBe('们应该走了。');
});

test('splitTranslation: three-way split by duration ratio', () => {
    // 1s + 1.5s + 1.5s = 4s → ratios 25% / 37.5% / 37.5%
    const unit: MergedUnit = {
        ids: [0, 1, 2],
        text: 'I think that we should go.',
        durations: [1, 1.5, 1.5],
    };
    const translated = '我觉得我们应该走了啊';
    const parts = splitTranslation(unit, translated);
    expect(parts).toHaveLength(3);
    // 10 chars: 25%→3, 62.5%→6
    const total = translated.length;
    const split1 = Math.round(0.25 * total);  // 3 (rounding 2.5)
    const split2 = Math.round(0.625 * total); // 6 (rounding 6.25)
    expect(parts[0]).toBe(translated.slice(0, split1));
    expect(parts[1]).toBe(translated.slice(split1, split2));
    expect(parts[2]).toBe(translated.slice(split2));
});
