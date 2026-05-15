import type { DiffEntry } from "../bindings/DiffEntry";
import type { MatchResult } from "../bindings/MatchResult";
import { SubtitleEntry, Subtitles } from "../core/Subtitles.svelte";
import { DefaultTokenizer, Searcher, type MergedDiffPart } from "../details/Fuzzy";
import { Basic } from "../Basic";
import { InputConfig } from "../config/Groups";

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
  data.forEach((x) => {
    if (x.useFirstText === undefined || x.useFirstTime === undefined)
      return;
    const time = x.useFirstTime === true ? x.first : x.second;
    const text = x.useFirstText === true ? x.first : x.second;
    if (!time || !text) return;
    const entry = new SubtitleEntry(time.start, time.end);
    entry.texts.set(newsub.defaultStyle, text.text);
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

export function constructHTMLReport(data: DataEntry[]): string {
    const styles = `
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; margin: 20px; }
        table { border-collapse: collapse; width: 100%; font-size: 14px; }
        th, td { border: 1px solid #ddd; padding: 4px 10px; vertical-align: top; }
        th { background: #f5f5f5; text-align: center; font-weight: 600; }
        td { word-break: break-word; }
        .num { text-align: right; color: #999; }
        .time { white-space: nowrap; font-variant-numeric: tabular-nums; }
        .diff { color: #d00; }
        .added { color: #080; }
        .changed { color: #00d; }
        .empty { color: #bbb; }
        tr:nth-child(even) td { background: #fafafa; }
    `;

    const fmt = (t: number) => Basic.formatTimestamp(t, 3, ',');

    function renderText(side: 'first' | 'second', entry: DataEntry) {
        const { merged } = entry;
        if (!merged) {
            const text = entry[side]?.text ?? '';
            return escapeHtml(text);
        }

        let result = '';
        for (let i = 0; i < merged.length; i++) {
            const part = merged[i];
            const tokens = part[side].join('');

            if (part.type === 'subtitute' ||
                (i > 0 && merged[i - 1].type === 'subtitute' &&
                 ((side === 'first' && part.type === 'delete') ||
                  (side === 'second' && part.type === 'insert')))) {
                result += `<span class="changed">${escapeHtml(tokens)}</span>`;
            } else if (part.type === 'match') {
                result += escapeHtml(tokens);
            } else if ((side === 'first' && part.type === 'delete') ||
                       (side === 'second' && part.type === 'insert')) {
                result += `<span class="added">${escapeHtml(tokens)}</span>`;
            }
        }
        return result;
    }

    let rows = '';
    for (const entry of data) {
        const { first: a, second: b } = entry;

        const i1 = a ? String(a.idx) : '';
        const i2 = b ? String(b.idx) : '';

        const s1 = a ? fmt(a.start) : '';
        const e1 = a ? fmt(a.end) : '';
        const s2 = b ? fmt(b.start) : '';
        const e2 = b ? fmt(b.end) : '';

        const s1Class = (!b || !a || !Basic.approx(b.start, a.start, InputConfig.data.epsilon)) ? 'diff' : '';
        const e1Class = (!b || !a || !Basic.approx(b.end, a.end, InputConfig.data.epsilon)) ? 'diff' : '';
        const s2Class = (!a || !b || !Basic.approx(a.start, b.start, InputConfig.data.epsilon)) ? 'diff' : '';
        const e2Class = (!a || !b || !Basic.approx(a.end, b.end, InputConfig.data.epsilon)) ? 'diff' : '';

        const t1Html = renderText('first', entry);
        const t2Html = renderText('second', entry);

        rows += `<tr>
            <td class="num">${i1}</td>
            <td class="time ${s1Class}">${s1}</td>
            <td class="time ${e1Class}">${e1}</td>
            <td>${t1Html}</td>
            <td class="num">${i2}</td>
            <td class="time ${s2Class}">${s2}</td>
            <td class="time ${e2Class}">${e2}</td>
            <td>${t2Html}</td>
        </tr>\n`;
    }

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Subtle — Comparison Report</title>
<style>${styles}</style>
</head>
<body>
<table>
<thead>
<tr>
    <th colspan="4">Original</th>
    <th colspan="4">New</th>
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
