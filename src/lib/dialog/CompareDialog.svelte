<script lang="ts">
import * as dialog from "@tauri-apps/plugin-dialog";
import { _ } from 'svelte-i18n';
import { onMount } from 'svelte';

import { ListView, showProgress } from '@the_dissidents/svelte-ui';
import DialogBase from '../DialogBase.svelte';

import type { DiffEntry } from '../bindings/DiffEntry';
import { type MatchResult } from "../bindings/MatchResult";
import { Basic } from '../Basic';
import { MAPI } from '../API';

import { DefaultTokenizer, Searcher, type MergedDiffPart } from '../details/Fuzzy';
import { SubtitleEntry, Subtitles, type SubtitleStyle } from '../core/Subtitles.svelte';
import { RichText } from '../core/RichText';
import { Format } from "../core/SimpleFormats";
import { LinearFormatCombineStrategy } from "../core/SubtitleUtil.svelte";
import { Interface } from '../frontend/Interface';
import { Source } from '../frontend/Source';

interface Props {
  args: [/*...*/],
  close: (ret: void /*...*/) => void
}

let {
  args: _args, close
}: Props = $props();

let inner: DialogBase;

let styleA: SubtitleStyle;
let styleB: SubtitleStyle;

function toEntries(s: Subtitles, style: SubtitleStyle) {
  return s.entries.flatMap((x, i) =>
    x.texts.has(style) ? {
      idx: i, start: x.start, end: x.end,
      text: RichText.toString(x.texts.get(style)!)
    } : []);
}

onMount(async () => {
  const path = await Interface.askOpenFile();
  if (!path) return close();

  const subs = await Interface.parseSubtitleSourceInteractive(path);
  if (!subs) return close();

  styleA = Source.subs.defaultStyle;
  styleB = subs.defaultStyle;

  const A = toEntries(Source.subs, styleA);
  const B = toEntries(subs, styleB);

  const result = await showProgress<MatchResult | null>(
    (report) => MAPI.matchEntries(A, B, {
      timeWeight: 0.5, textWeight: 1.5,
      useLevenshtein: true
    }, (p, t) => report(p / t, `${(p / t * 100).toFixed(1)}%`))
  );

  if (!result) {
    // TODO: freak out
    return close();
  }

  for (const l of result.tokens) {
    switch (l.matchType) {
      case 'match':
      case 'substitute': {
        const t1 = A[l.i!].text;
        const t2 = B[l.j!].text;
        const result = new Searcher(t1, DefaultTokenizer.caseSensitive(true))
          .search(t2, { wholeSequence: true });
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

  await inner.showModal!();

  close(/*...*/);
});

type DataEntry = {
  first?: DiffEntry & {},
  second?: DiffEntry,
  merged?: MergedDiffPart<string>[],
  useFirstTime?: boolean,
  useFirstText?: boolean,
}

let data: DataEntry[] = $state([]);

function constructOutput() {
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

async function exportFile() {
  const path = await dialog.save({
      filters: [{name: 'SRT', extensions: ['srt']}],
  });
  if (!path) return;
  const string = Format.SRT.write(constructOutput())
    .strategy(LinearFormatCombineStrategy.KeepOrder)
    .toString();
  return await Source.exportTo(path, string);
}
</script>

<DialogBase bind:this={inner} maxWidth="70em">
  {#snippet header()}
    <h3>比较字幕文件</h3>
  {/snippet}

  <table class="config">
  <tbody>
    <tr>
      <td>匹配的字幕条</td>
      <td>
        <button class="left" disabled>时间轴</button>
        <button class="middle"
          onclick={() => data.forEach((x) => x.first && x.second && (x.useFirstTime = true))}
        >全部使用左侧</button>
        <button class="right"
          onclick={() => data.forEach((x) => x.first && x.second && (x.useFirstTime = false))}
        >全部使用右侧</button>

        <button class="left" disabled>文本</button>
        <button class="middle"
          onclick={() => data.forEach((x) => x.first && x.second && (x.useFirstText = true))}
        >全部使用左侧</button>
        <button class="right"
          onclick={() => data.forEach((x) => x.first && x.second && (x.useFirstText = false))}
        >全部使用右侧</button>
      </td>
    </tr>
    <tr>
      <td>无法匹配的字幕条</td>
      <td>
        <button class="left" disabled>左侧</button>
        <button class="middle"
          onclick={() => data.forEach((x) => x.first && !x.second
            && (x.useFirstTime = true, x.useFirstText = true))}
        >保留</button>
        <button class="right"
          onclick={() => data.forEach((x) => x.first && !x.second
            && (x.useFirstTime = undefined, x.useFirstText = undefined))}
        >不保留</button>

        <button class="left" disabled>右侧</button>
        <button class="middle"
          onclick={() => data.forEach((x) => !x.first && x.second
            && (x.useFirstTime = false, x.useFirstText = false))}
        >保留</button>
        <button class="right"
          onclick={() => data.forEach((x) => !x.first && x.second
            && (x.useFirstTime = undefined, x.useFirstText = undefined))}
        >不保留</button>
      </td>
    </tr>
    <tr>
      <td></td>
      <td>
        <button onclick={() => exportFile()}>导出</button>
      </td>
    </tr>
  </tbody>
  </table>

  <ListView columns={[
    ['i1',    { header: '#',     width: 'max-content', align: 'end' }],
    ['useTime1', { header: '' }],
    ['s1',    { header: 'start', width: 'max-content' }],
    ['e1',    { header: 'end',   width: 'max-content' }],
    ['useText1', { header: '' }],
    ['text1', { header: 'text',  width: '1fr' }],

    ['i2',    { header: '#',     width: 'max-content', align: 'end' }],
    ['useTime2', { header: '' }],
    ['s2',    { header: 'start', width: 'max-content' }],
    ['e2',    { header: 'end',   width: 'max-content' }],
    ['useText2', { header: '' }],
    ['text2', { header: 'text',  width: '1fr' }],
  ]} items={data}>
    {#snippet i1({ first: a })}
      {a?.idx ?? ''}
    {/snippet}
    {#snippet useTime1(e)}
      {#if e.first}
        <input type="checkbox" checked={e.useFirstTime === true}
          onchange={(ev) => e.useFirstTime = ev.currentTarget.checked ? true : undefined}>
      {/if}
    {/snippet}
    {#snippet s1({ first: a, second: b })}
      <span class:diff={!b || b.start !== a?.start}>
        {a ? Basic.formatTimestamp(a.start) : ''}
      </span>
    {/snippet}
    {#snippet e1({ first: a, second: b })}
      <span class:diff={!b || b.end !== a?.end}>
        {a ? Basic.formatTimestamp(a.end) : ''}
      </span>
    {/snippet}
    {#snippet useText1(e)}
      {#if e.first}
        <input type="checkbox" checked={e.useFirstText === true}
          onchange={(ev) => e.useFirstText = ev.currentTarget.checked ? true : undefined}>
      {/if}
    {/snippet}
    {#snippet text1({ first: a, merged: diff })}
      {#if diff}
        {#each diff as part, i}
          {#if part.type == 'subtitute'
              || (i > 0 && diff[i-1].type == 'subtitute' && part.type == 'delete')}
            <span class="changed">{part.first.join('')}</span>
          {:else if part.type == 'match'}
            {part.first.join('')}
          {:else if part.type == 'delete'}
            <span class="added">{part.first.join('')}</span>
          {/if}
        {/each}
      {:else}
        {a?.text ?? ''}
      {/if}
    {/snippet}

    {#snippet i2({ second: a })}
      {a?.idx ?? ''}
    {/snippet}
    {#snippet useTime2(e)}
      {#if e.second}
        <input type="checkbox" checked={e.useFirstTime === false}
          onchange={(ev) => e.useFirstTime = ev.currentTarget.checked ? false : undefined}>
      {/if}
    {/snippet}
    {#snippet s2({ first: b, second: a })}
      <span class:diff={!b || b.start !== a?.start}>
        {a ? Basic.formatTimestamp(a.start) : ''}
      </span>
    {/snippet}
    {#snippet e2({ first: b, second: a })}
      <span class:diff={!b || b.end !== a?.end}>
        {a ? Basic.formatTimestamp(a.end) : ''}
      </span>
    {/snippet}
    {#snippet useText2(e)}
      {#if e.second}
        <input type="checkbox" checked={e.useFirstText === false}
          onchange={(ev) => e.useFirstText = ev.currentTarget.checked ? false : undefined}>
      {/if}
    {/snippet}
    {#snippet text2({ second: a, merged: diff })}
      {#if diff}
        {#each diff as part, i}
          {#if part.type == 'subtitute'
              || (i > 0 && diff[i-1].type == 'subtitute' && part.type == 'insert')}
            <span class="changed">{part.second.join('')}</span>
          {:else if part.type == 'match'}
            {part.second.join('')}
          {:else if part.type == 'insert'}
            <span class="added">{part.second.join('')}</span>
          {/if}
        {/each}
      {:else}
        {a?.text ?? ''}
      {/if}
    {/snippet}
  </ListView>

</DialogBase>

<style>
  .diff {
    color: red;
  }

  .added {
    color: green;
  }

  .changed {
    color: blue;
  }
</style>
