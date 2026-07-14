import { expect, test } from 'vitest';
import { RichText, type RichTextAttr } from '../lib/core/RichText';

function rt(v: RichText): RichText {
    return typeof v === 'string' ? [v] : v;
}

// ---------------------------------------------------------------------------
// leaf
// ---------------------------------------------------------------------------

test('RichText.leaf', () => {
    expect(RichText.leaf('abc'))
        .toStrictEqual([{ type: 'leaf', content: 'abc', attrs: [] }]);
    expect(RichText.leaf('abc', 'bold'))
        .toStrictEqual([{ type: 'leaf', content: 'abc', attrs: ['bold'] }]);
    expect(RichText.leaf('abc', 'bold', 'italic'))
        .toStrictEqual([{ type: 'leaf', content: 'abc', attrs: ['bold', 'italic'] }]);
    expect(RichText.leaf(''))
        .toStrictEqual([{ type: 'leaf', content: '', attrs: [] }]);
    expect(RichText.leaf('abc', { type: 'size', value: 1.5 }))
        .toStrictEqual([{ type: 'leaf', content: 'abc', attrs: [{ type: 'size', value: 1.5 }] }]);
});

// ---------------------------------------------------------------------------
// equals
// ---------------------------------------------------------------------------

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
    expect(RichText.equals('', '')).toBe(true);
    expect(RichText.equals([], '')).toBe(false);
    expect(RichText.equals('abc', 'abc')).toBe(true);
    expect(RichText.equals('abc', 'ABC')).toBe(false);
    expect(RichText.equals('abc', ['abc'])).toBe(false);
    expect(RichText.equals(a, a)).toBe(true);
});

// ---------------------------------------------------------------------------
// toString
// ---------------------------------------------------------------------------

test('RichText.toString', () => {
    expect(RichText.toString('abc')).toBe('abc');
    expect(RichText.toString(['abc', { type: 'leaf', content: 'def', attrs: ['bold'] }, 'ghi']))
        .toBe('abcdefghi');
    expect(RichText.toString('')).toBe('');
    expect(RichText.toString([])).toBe('');
    expect(RichText.toString([''])).toBe('');
    expect(RichText.toString([{ type: 'leaf', content: 'hi', attrs: ['bold'] }])).toBe('hi');
});

// ---------------------------------------------------------------------------
// length
// ---------------------------------------------------------------------------

test('RichText.length', () => {
    expect(RichText.length('abc')).toBe(3);
    expect(RichText.length(['abc', { type: 'leaf', content: 'df', attrs: ['bold'] }, 'g']))
        .toBe(6);
    expect(RichText.length('')).toBe(0);
    expect(RichText.length([])).toBe(0);
    expect(RichText.length([{ type: 'leaf', content: 'ab', attrs: ['bold'] }])).toBe(2);
    expect(RichText.length([''])).toBe(0);
});

// ---------------------------------------------------------------------------
// concat
// ---------------------------------------------------------------------------

test('RichText.concat', () => {
    expect(RichText.concat('abc', 'def')).toStrictEqual(['abcdef']);
    expect(RichText.concat('abc', ['def', 'ghi'])).toStrictEqual(['abcdefghi']);
    expect(RichText.concat(
        ['abc', { type: 'leaf', content: 'def', attrs: ['bold'] }],
        [{ type: 'leaf', content: 'ghi', attrs: ['bold'] }, 'jk'])
    ).toStrictEqual(['abc', { type: 'leaf', content: 'defghi', attrs: ['bold'] }, 'jk']);
    expect(RichText.concat()).toStrictEqual('');
    expect(RichText.concat('')).toStrictEqual('');
    expect(RichText.concat('', 'abc')).toStrictEqual(['abc']);
    expect(RichText.concat('abc', '')).toStrictEqual(['abc']);
    expect(RichText.concat('abc')).toStrictEqual(['abc']);
    expect(RichText.concat('a', 'b', 'c')).toStrictEqual(['abc']);
    expect(RichText.concat(
        [{ type: 'leaf', content: 'a', attrs: ['bold'] }],
        [{ type: 'leaf', content: 'b', attrs: ['italic'] }])
    ).toStrictEqual([
        { type: 'leaf', content: 'a', attrs: ['bold'] },
        { type: 'leaf', content: 'b', attrs: ['italic'] },
    ]);
});

test('RichText.concat does not mutate inputs', () => {
    const leaf1 = { type: 'leaf' as const, content: 'hello' as string, attrs: ['bold'] as RichTextAttr[] };
    const leaf2 = { type: 'leaf' as const, content: 'world' as string, attrs: ['bold'] as RichTextAttr[] };
    const rt1: RichText = [leaf1];
    const rt2: RichText = [leaf2];
    const result = RichText.concat(rt1, rt2);
    expect(leaf1.content).toBe('hello');
    expect(leaf2.content).toBe('world');
    expect(result).toStrictEqual([
        { type: 'leaf', content: 'helloworld', attrs: ['bold'] },
    ]);
});

// ---------------------------------------------------------------------------
// split
// ---------------------------------------------------------------------------

test('RichText.split', () => {
    expect(RichText.split('abc,def,ghi', ',')).toStrictEqual(['abc', 'def', 'ghi']);
    expect(RichText.split(
        ['abc,d', { type: 'leaf', content: 'ef,gh', attrs: ['bold'] }, 'i'], ','))
    .toStrictEqual([
        ['abc'],
        ['d', { type: 'leaf', content: 'ef', attrs: ['bold'] }],
        [{ type: 'leaf', content: 'gh', attrs: ['bold'] }, 'i'],
    ]);
    expect(RichText.split('abc', ',')).toStrictEqual(['abc']);
    expect(RichText.split('', ',')).toStrictEqual(['']);
    expect(RichText.split(',abc,', ',')).toStrictEqual(['', 'abc', '']);
    expect(RichText.split('abc,def', /,/)).toStrictEqual(['abc', 'def']);
    expect(RichText.split(
        [{ type: 'leaf', content: 'ab,cd', attrs: ['bold'] }], ','))
    .toStrictEqual([
        [{ type: 'leaf', content: 'ab', attrs: ['bold'] }],
        [{ type: 'leaf', content: 'cd', attrs: ['bold'] }],
    ]);
    expect(RichText.split('a,,b', ',')).toStrictEqual(['a', '', 'b']);
});

// ---------------------------------------------------------------------------
// substring
// ---------------------------------------------------------------------------

test('RichText.substring', () => {
    expect(rt(RichText.substring('01234567', 4, 7))).toStrictEqual(['456']);
    expect(RichText.substring(
        ['012', { type: 'leaf', content: '345', attrs: ['bold'] }, '67'], 4, 7))
    .toStrictEqual([{ type: 'leaf', content: '45', attrs: ['bold'] }, '6']);
    expect(rt(RichText.substring('abc', 0))).toStrictEqual(['abc']);
    expect(rt(RichText.substring('abc', 1))).toStrictEqual(['bc']);
    expect(rt(RichText.substring('abc', 3))).toStrictEqual(['']);
    expect(RichText.substring(['abc', 'def'], 0)).toStrictEqual(['abc', 'def']);
    expect(RichText.substring(['abc', 'def'], 3)).toStrictEqual(['def']);
    expect(RichText.substring(['abc', 'def'], 6)).toStrictEqual('');
    expect(RichText.substring(
        [{ type: 'leaf', content: 'abc', attrs: ['bold'] }], 1, 2))
    .toStrictEqual([{ type: 'leaf', content: 'b', attrs: ['bold'] }]);
});

test('RichText.substring does not mutate inputs', () => {
    const leaf = { type: 'leaf' as const, content: 'abcdef' as string, attrs: ['bold'] as RichTextAttr[] };
    const rt: RichText = [leaf];
    const result = RichText.substring(rt, 2, 4);
    expect(leaf.content).toBe('abcdef');
    expect(result).toStrictEqual([{ type: 'leaf', content: 'cd', attrs: ['bold'] }]);
});

// ---------------------------------------------------------------------------
// trim
// ---------------------------------------------------------------------------

test('RichText.trim', () => {
    expect(RichText.trim('')).toStrictEqual('');
    expect(RichText.trim('abc')).toStrictEqual('abc');
    expect(rt(RichText.trim('  abc  '))).toStrictEqual(['abc']);
    expect(rt(RichText.trim('  abc'))).toStrictEqual(['abc']);
    expect(rt(RichText.trim('abc  '))).toStrictEqual(['abc']);
    expect(RichText.trim('   ')).toStrictEqual('');
    expect(RichText.trim(['  ', { type: 'leaf', content: 'abc  ', attrs: ['bold'] }]))
        .toStrictEqual([{ type: 'leaf', content: 'abc', attrs: ['bold'] }]);
    expect(RichText.trim(
        ['  abc', { type: 'leaf', content: 'def  ', attrs: ['bold'] }, '  ']))
    .toStrictEqual(['abc', { type: 'leaf', content: 'def', attrs: ['bold'] }]);
});

// ---------------------------------------------------------------------------
// trimStart
// ---------------------------------------------------------------------------

test('RichText.trimStart', () => {
    expect(RichText.trimStart('')).toStrictEqual('');
    expect(RichText.trimStart('abc')).toStrictEqual('abc');
    expect(rt(RichText.trimStart('  abc'))).toStrictEqual(['abc']);
    expect(RichText.trimStart('abc  ')).toStrictEqual('abc  ');
    expect(RichText.trimStart('   ')).toStrictEqual('');
    expect(RichText.trimStart(
        ['  ', { type: 'leaf', content: 'abc', attrs: ['bold'] }]))
    .toStrictEqual([{ type: 'leaf', content: 'abc', attrs: ['bold'] }]);
});

// ---------------------------------------------------------------------------
// trimEnd
// ---------------------------------------------------------------------------

test('RichText.trimEnd', () => {
    expect(RichText.trimEnd('')).toStrictEqual('');
    expect(RichText.trimEnd('abc')).toStrictEqual('abc');
    expect(RichText.trimEnd('  abc')).toStrictEqual('  abc');
    expect(rt(RichText.trimEnd('abc  '))).toStrictEqual(['abc']);
    expect(RichText.trimEnd('   ')).toStrictEqual('');
    expect(RichText.trimEnd(
        [{ type: 'leaf', content: 'abc', attrs: ['bold'] }, '  ']))
    .toStrictEqual([{ type: 'leaf', content: 'abc', attrs: ['bold'] }]);
});

// ---------------------------------------------------------------------------
// attrsAt
// ---------------------------------------------------------------------------

test('RichText.attrsAt', () => {
    expect(RichText.attrsAt('', 0)).toStrictEqual([]);
    expect(RichText.attrsAt('abc', 0)).toStrictEqual([]);
    expect(RichText.attrsAt('abc', 2)).toStrictEqual([]);
    expect(RichText.attrsAt(['abc'], 0)).toStrictEqual([]);
    expect(RichText.attrsAt(['abc', { type: 'leaf', content: 'def', attrs: ['bold'] }], 0))
        .toStrictEqual([]);
    expect(RichText.attrsAt(['abc', { type: 'leaf', content: 'def', attrs: ['bold'] }], 3))
        .toStrictEqual(['bold']);
    expect(RichText.attrsAt(
        [{ type: 'leaf', content: 'ab', attrs: ['bold'] }, 'cd'], 1))
    .toStrictEqual(['bold']);
    expect(RichText.attrsAt(
        [{ type: 'leaf', content: 'ab', attrs: ['bold'] }, 'cd'], 2))
    .toStrictEqual([]);
    expect(() => RichText.attrsAt(['abc'], 3)).toThrow(RangeError);
    expect(RichText.attrsAt([], 0)).toStrictEqual([]);
    expect(RichText.attrsAt([], 5)).toStrictEqual([]);
});

// ---------------------------------------------------------------------------
// edit
// ---------------------------------------------------------------------------

test('RichText.edit', () => {
    expect(RichText.edit('abc', 0, 0, 'X')).toStrictEqual(['Xabc']);
    expect(RichText.edit('abc', 1, 1, 'X')).toStrictEqual(['aXc']);
    expect(RichText.edit('abc', 1, 2, 'X')).toStrictEqual(['aX']);
    expect(RichText.edit('abc', 3, 0, 'X')).toStrictEqual(['abcX']);
    expect(RichText.edit('abc', 3, 0, '')).toStrictEqual(['abc']);
    expect(RichText.edit(['ab', 'cd'], 2, 0, 'XY'))
        .toStrictEqual(['abXYcd']);
    expect(RichText.edit(['ab', 'cd'], 2, 2, 'XY'))
        .toStrictEqual(['abXY']);
    expect(RichText.edit(
        [{ type: 'leaf', content: 'ab', attrs: ['bold'] }], 1, 0,
        [{ type: 'leaf', content: 'cd', attrs: ['bold'] }]))
    .toStrictEqual([{ type: 'leaf', content: 'acdb', attrs: ['bold'] }]);
});

// ---------------------------------------------------------------------------
// join
// ---------------------------------------------------------------------------

test('RichText.join', () => {
    expect(RichText.join([], ',')).toStrictEqual('');
    expect(RichText.join(['abc'], ',')).toStrictEqual(['abc']);
    expect(RichText.join(['abc', 'def'], ',')).toStrictEqual(['abc,def']);
    expect(RichText.join(['abc', 'def', 'ghi'], ', '))
        .toStrictEqual(['abc, def, ghi']);
    expect(RichText.join([
        [{ type: 'leaf', content: 'a', attrs: ['bold'] }],
        [{ type: 'leaf', content: 'b', attrs: ['bold'] }],
    ], ',')).toStrictEqual([
        { type: 'leaf', content: 'a', attrs: ['bold'] },
        ',',
        { type: 'leaf', content: 'b', attrs: ['bold'] },
    ]);
    const sep: RichText = [{ type: 'leaf', content: ',', attrs: ['bold'] }];
    expect(RichText.join(['a', 'b'], sep)).toStrictEqual([
        'a',
        { type: 'leaf', content: ',', attrs: ['bold'] },
        'b',
    ]);
});
