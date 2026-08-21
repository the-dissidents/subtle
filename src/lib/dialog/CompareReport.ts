import type { DiffEntry } from "../bindings/DiffEntry";
import type { MatchResult } from "../bindings/MatchResult";
import { SubtitleEntry, Subtitles } from "../core/Subtitles.svelte";
import { DefaultTokenizer, Searcher, type MergedDiffPart } from "../details/Fuzzy";
import { Basic } from "../Basic";

import { _, unwrapFunctionStore } from 'svelte-i18n';
const $_ = unwrapFunctionStore(_);

export type SourceEntry = {
    idx: number;
    start: number;
    end: number;
    text: string;
};

export type DataEntry = {
  first?: DiffEntry,
  second?: DiffEntry,
  merged?: MergedDiffPart<string>[],
  useFirstTime?: boolean,
  useFirstText?: boolean,
};

export function constructData(A: SourceEntry[], B: SourceEntry[], result: MatchResult) {
    const data: DataEntry[] = [];
    for (const l of result.tokens) {
        switch (l.matchType) {
            case 'match':
            case 'substitute': {
                const t1 = A[l.i!].text;
                const t2 = B[l.j!].text;
                // this is the correct order (search for A in B)
                const result = new Searcher(t2, DefaultTokenizer.caseSensitive(true))
                .search(t1, { wholeSequence: true });
                data.push({ first: A[l.i!], second: B[l.j!], merged: result?.merged });
                break;
            }
            case 'delete':
                data.push({ first: A[l.i!] });
                break;
            case 'insert':
                data.push({ second: B[l.j!] });
                break;
        }
    }
    return data;
}

export function constructOutput(data: DataEntry[]) {
  const newsub = new Subtitles();
  const style = newsub.styles[0];
  data.forEach((x) => {
    if (x.useFirstText === undefined || x.useFirstTime === undefined)
      return;
    const time = x.useFirstTime === true ? x.first : x.second;
    const text = x.useFirstText === true ? x.first : x.second;
    if (!time || !text) return;
    const entry = new SubtitleEntry(time.start, time.end);
    entry.texts.set(style, text.text);
    newsub.entries.push(entry);
  });
  return newsub;
}

function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function getLetters(s: string) {
    return s.replaceAll(/[^\p{L}\d]/ug, '').length;
}

export function constructHTMLReport(data: DataEntry[]): string {
    const styles = `
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; margin: 20px; }
        table { border-collapse: collapse; width: 100%; font-size: 14px; margin-bottom: 1em; }
        th, td { border: 1px solid #ddd; padding: 4px 10px; vertical-align: top; }
        th { background: #f5f5f5; text-align: center; font-weight: 600; }
        td { word-break: break-word; }
        .num { text-align: right; color: #999; white-space: nowrap; font-variant-numeric: tabular-nums; }
        .time { white-space: nowrap; font-variant-numeric: tabular-nums; }
        .diff { color: #d00; }
        .added { color: #080; }
        .changed { color: #00d; }
        .empty { color: #bbb; }
        em { font-style: normal; font-weight: bold; }
        tr:nth-child(even) td { background: #fafafa; }
    `;

    const fmt = (t: number) => Basic.formatTimestamp(t, 3, ',');

    function renderText(side: 'first' | 'second', entry: DataEntry) {
        const { merged } = entry;
        if (!merged) {
            const text = entry[side]?.text ?? '';
            return {
                result: escapeHtml(text),
                total: text.length,
                identical: 0,
                letters: getLetters(text),
                identicalLetters: 0,
            };
        }

        let result = '', identical = 0, total = 0, letters = 0, identicalLetters = 0;
        for (let i = 0; i < merged.length; i++) {
            const part = merged[i];
            const tokens = part[side].join('');

            total += tokens.length;
            const lettersLength = getLetters(tokens);
            letters += lettersLength;
            if (part.type === 'subtitute' ||
                (i > 0 && merged[i - 1].type === 'subtitute' &&
                 ((side === 'first' && part.type === 'delete') ||
                  (side === 'second' && part.type === 'insert')))) {
                result += `<span class="changed">${escapeHtml(tokens)}</span>`;
            } else if (part.type === 'match') {
                result += escapeHtml(tokens);
                identical += tokens.length;
                identicalLetters += lettersLength;
            } else if ((side === 'first' && part.type === 'delete') ||
                       (side === 'second' && part.type === 'insert')) {
                result += `<span class="added">${escapeHtml(tokens)}</span>`;
            }
        }
        return { result, total, identical, letters, identicalLetters };
    }

    // rows
    let rows = '', timeModified = 0, count = 0;
    let identicalChars = 0, totalChars = 0, identicalLetters = 0, totalLetters = 0;
    for (const entry of data) {
        const { first: a, second: b } = entry;
        const sides = (!a || !b) ? 1 : 2;
        count += sides;

        const i1 = a ? String(a.idx) : '';
        const i2 = b ? String(b.idx) : '';

        const s1 = a ? fmt(a.start) : '';
        const e1 = a ? fmt(a.end) : '';
        const s2 = b ? fmt(b.start) : '';
        const e2 = b ? fmt(b.end) : '';

        const sd = !a || !b || !Basic.approx(a.start, b.start, 0.01);
        const ed = !a || !b || !Basic.approx(a.end, b.end, 0.01);
        if (sd || ed) timeModified += sides;

        const t1 = renderText('first', entry);
        const t2 = renderText('second', entry);
        identicalChars += t1.identical + t2.identical;
        totalChars += t1.total + t2.total;
        identicalLetters += t1.identicalLetters + t2.identicalLetters;
        totalLetters += t1.letters + t2.letters;

        rows += `<tr>
            <td class="num">${i1}</td>
            <td class="time ${sd ? 'diff' : ''}">${s1}</td>
            <td class="time ${ed ? 'diff' : ''}">${e1}</td>
            <td>${t1.result}</td>
            <td class="num">${i2}</td>
            <td class="time ${sd ? 'diff' : ''}">${s2}</td>
            <td class="time ${ed ? 'diff' : ''}">${e2}</td>
            <td>${t2.result}</td>
        </tr>\n`;
    }

    // statistics
    const stats =
`<table>
<tbody>
    <tr>
        <td>${escapeHtml($_('comparereport.time-modification-index'))}</td>
        <td colspan=3>${timeModified} / ${count} * 100% = ${(timeModified / count * 100).toFixed(1)}%</td>
    </tr><tr>
        <td rowspan=3>${escapeHtml($_('comparereport.modification-index'))}</td>
        <td>${escapeHtml($_('comparereport.letters'))}</td>
        <td>${((1 - identicalLetters / totalLetters) * 100).toFixed(1)}%</td>
        <td rowspan=3 style="width: 50%">
            ${escapeHtml($_('comparereport.modification-formula'))}<br>
            ${escapeHtml($_('comparereport.modification-d'))}
            <em>${escapeHtml($_('comparereport.modification-warning'))}</em>
        </td>
    </tr><tr>
        <td>${escapeHtml($_('comparereport.nonletters'))}</td>
        <td>${((1 - (identicalChars - identicalLetters) / (totalChars - totalLetters)) * 100).toFixed(1)}%</td>
    </tr><tr>
        <td>${escapeHtml($_('comparereport.overall'))}</td>
        <td>${((1 - identicalChars / totalChars) * 100).toFixed(1)}%</td>
    </tr>
</tbody>
</table>`;

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml($_('comparereport.title'))}</title>
<style>${styles}</style>
</head>
<body>
${stats}
<table>
<thead>
<tr>
    <th colspan="4">${escapeHtml($_('comparereport.original'))}</th>
    <th colspan="4">${escapeHtml($_('comparereport.new'))}</th>
</tr>
<tr>
    <th>#</th><th>${escapeHtml($_('metrics.start-time-short'))}</th><th>${escapeHtml($_('metrics.end-time-short'))}</th><th>${escapeHtml($_('metrics.content'))}</th>
    <th>#</th><th>${escapeHtml($_('metrics.start-time-short'))}</th><th>${escapeHtml($_('metrics.end-time-short'))}</th><th>${escapeHtml($_('metrics.content'))}</th>
</tr>
</thead>
<tbody>
${rows}</tbody>
</table>
</body>
</html>`;
}
