import { expect, test } from 'vitest';
import { RichText } from '../lib/core/RichText';

test('RichText.equals', () => {
    const a: RichText = ['abc', { type: 'leaf', content: 'def', attrs: ['bold'] }, 'ghi'];
    const b: RichText = ['abc', { type: 'leaf', content: 'def', attrs: ['bold'] }, 'ghi'];
    const c: RichText = ['abc', 'def', { type: 'leaf', content: 'ghi', attrs: ['bold'] }];
    const d: RichText = ['abcdef', { type: 'leaf', content: 'ghi', attrs: ['bold'] }];
    const e: RichText = '123';
    const f: RichText = '123';

    expect(RichText.equals(a, b)).toBe(true);
    expect(RichText.equals(c, d)).toBe(false);
    expect(RichText.equals(e, f)).toBe(true);
});

test('RichText.concat', () => {
    expect(RichText.concat('abc', 'def')).toStrictEqual(['abcdef']);
    expect(RichText.concat('abc', ['def', 'ghi'])).toStrictEqual(['abcdefghi']);
    expect(RichText.concat(
        ['abc', { type: 'leaf', content: 'def', attrs: ['bold'] }], 
        [{ type: 'leaf', content: 'ghi', attrs: ['bold'] }, 'jk'])
    ).toStrictEqual(['abc', { type: 'leaf', content: 'defghi', attrs: ['bold'] }, 'jk']);
});

test('RichText.toString', () => {
    expect(RichText.toString('abc')).toBe('abc');
    expect(RichText.toString(['abc', { type: 'leaf', content: 'def', attrs: ['bold'] }, 'ghi'])).toBe('abcdefghi');
});

test('RichText.length', () => {
    expect(RichText.length('abc')).toBe(3);
    expect(RichText.length(['abc', { type: 'leaf', content: 'df', attrs: ['bold'] }, 'g'])).toBe(6);
});

test('RichText.split', () => {
    expect(RichText.split('abc,def,ghi', ',')).toStrictEqual(['abc', 'def', 'ghi']);
    expect(RichText.split(['abc,d', { type: 'leaf', content: 'ef,gh', attrs: ['bold'] }, 'i'], ','))
    .toStrictEqual([
        ['abc'], 
        ['d', { type: 'leaf', content: 'ef', attrs: ['bold'] }], 
        [{ type: 'leaf', content: 'gh', attrs: ['bold'] }, 'i']
    ]);
});

test('RichText.substring', () => {
    expect(RichText.substring('01234567', 4, 7)).toStrictEqual(['456']);
    expect(RichText.substring(
        ['012', { type: 'leaf', content: '345', attrs: ['bold'] }, '67'], 4, 7))
    .toStrictEqual([{ type: 'leaf', content: '45', attrs: ['bold'] }, '6']);
});