<script lang="ts">
import * as dialog from "@tauri-apps/plugin-dialog";
import { _ } from 'svelte-i18n';
import { onMount } from 'svelte';

import { ListView, overlayMenu, showProgress } from '@the_dissidents/svelte-ui';
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
  import { InputConfig } from "../config/Groups";

interface Props {
  args: [style: SubtitleStyle],
  close: (ret: void /*...*/) => void
}

const {
  args, close
}: Props = $props();

let inner: DialogBase;

function toEntries(s: Subtitles, style: SubtitleStyle) {
  return s.entries.flatMap((x, i) =>
    x.texts.has(style) ? {
      idx: i, start: x.start, end: x.end,
      text: RichText.toString(x.texts.get(style)!)
    } : []);
}

async function chooseStyle(subs: Subtitles, prompt: string) {
  if (subs.styles.length == 1)
    return subs.defaultStyle;
  const choice = await overlayMenu(
    subs.styles.map((x) => ({ text:
      `${x.name} （使用量：${subs.entries.filter((e) => e.texts.has(x)).length}）`
    })),
    {
      text: prompt,
      rememberedItem: subs.defaultStyle.name
    });
  if (choice < 0) return undefined;
  return subs.styles[choice];
}

onMount(async () => {
  const path = await Interface.askOpenFile();
  if (!path) return close();

  const subs = await Interface.parseSubtitleSourceInteractive(path, true);
  if (!subs) return close();

  // const styleA = await chooseStyle(Source.subs, $_('comparedialog.choose-style-original'));
  // if (!styleA) return;

  const styleB = await chooseStyle(subs, $_('comparedialog.choose-style-new'));
  if (!styleB) return;

  const A = toEntries(Source.subs, args[0]);
  const B = toEntries(subs, styleB);

  const result = await showProgress<MatchResult | null>(
    (report) => MAPI.matchEntries(A, B, {
      timeWeight: 0.5, textWeight: 1.5,
      useLevenshtein: true
    }, (p, t) => report(p / t, `${(p / t * 100).toFixed(1)}%`))
  );

  if (!result) {
    await dialog.message($_('comparedialog.no-match'), { kind: 'error' });
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

  close();
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
    <h3>{$_('comparedialog.header')}</h3>
  {/snippet}

  <table class="config">
  <tbody>
    <tr>
      <td>{$_('comparedialog.matched-entries')}</td>
      <td class="hlayout">
        <button class="left" disabled>{$_('comparedialog.times')}</button>
        <button class="middle"
          onclick={() => data.forEach((x) => x.first && x.second && (x.useFirstTime = true))}
        >{$_('comparedialog.use-left')}</button>
        <button class="middle"
          onclick={() => data.forEach((x) => x.first && x.second && (x.useFirstTime = false))}
        >{$_('comparedialog.use-right')}</button>

        <button class="middle"
          onclick={() => data.forEach((x) =>
            x.useFirstTime === true && (x.useFirstTime = undefined))}
        >{$_('comparedialog.clear-left')}</button>
        <button class="right"
          onclick={() => data.forEach((x) =>
            x.useFirstTime === false && (x.useFirstTime = undefined))}
        >{$_('comparedialog.clear-right')}</button>

        <button class="left" disabled>{$_('comparedialog.texts')}</button>
        <button class="middle"
          onclick={() => data.forEach((x) => x.first && x.second && (x.useFirstText = true))}
        >{$_('comparedialog.use-left')}</button>
        <button class="middle"
          onclick={() => data.forEach((x) => x.first && x.second && (x.useFirstText = false))}
        >{$_('comparedialog.use-right')}</button>

        <button class="middle"
          onclick={() => data.forEach((x) =>
            x.useFirstText === true && (x.useFirstText = undefined))}
        >{$_('comparedialog.clear-left')}</button>
        <button class="right"
          onclick={() => data.forEach((x) =>
            x.useFirstText === false && (x.useFirstText = undefined))}
        >{$_('comparedialog.clear-right')}</button>
      </td>
    </tr>
    <tr>
      <td>{$_('comparedialog.unmatched-entries')}</td>
      <td class="hlayout">
        <button class="left" disabled>{$_('comparedialog.left-side')}</button>
        <button class="middle"
          onclick={() => data.forEach((x) => x.first && !x.second
            && (x.useFirstTime = true, x.useFirstText = true))}
        >{$_('comparedialog.retain')}</button>
        <button class="right"
          onclick={() => data.forEach((x) => x.first && !x.second
            && (x.useFirstTime = undefined, x.useFirstText = undefined))}
        >{$_('comparedialog.remove')}</button>

        <button class="left" disabled>{$_('comparedialog.right-side')}</button>
        <button class="middle"
          onclick={() => data.forEach((x) => !x.first && x.second
            && (x.useFirstTime = false, x.useFirstText = false))}
        >{$_('comparedialog.retain')}</button>
        <button class="right"
          onclick={() => data.forEach((x) => !x.first && x.second
            && (x.useFirstTime = undefined, x.useFirstText = undefined))}
        >{$_('comparedialog.remove')}</button>
      </td>
    </tr>
    <tr>
      <td></td>
      <td>
        <button onclick={() => exportFile()}>{$_('comparedialog.export')}</button>
      </td>
    </tr>
  </tbody>
  </table>

  <ListView columns={[
    ['i1',    { header: '#',     width: 'max-content', align: 'end' }],
    ['useTime1', { header: '' }],
    ['s1',    { header: $_('metrics.start-time-short'), width: 'max-content' }],
    ['e1',    { header: $_('metrics.end-time-short'),   width: 'max-content' }],
    ['useText1', { header: '' }],
    ['text1', { header: $_('metrics.content'),  width: '1fr' }],

    ['i2',    { header: '#',     width: 'max-content', align: 'end' }],
    ['useTime2', { header: '' }],
    ['s2',    { header: $_('metrics.start-time-short'), width: 'max-content' }],
    ['e2',    { header: $_('metrics.end-time-short'),   width: 'max-content' }],
    ['useText2', { header: '' }],
    ['text2', { header: $_('metrics.content'),  width: '1fr' }],
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
      <span class:diff={!b || !a || !Basic.approx(b.start, a.start, InputConfig.data.epsilon)}>
        {a ? Basic.formatTimestamp(a.start) : ''}
      </span>
    {/snippet}
    {#snippet e1({ first: a, second: b })}
      <span class:diff={!b || !a || !Basic.approx(b.end, a.end, InputConfig.data.epsilon)}>
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
      <span class:diff={!b || !a || !Basic.approx(b.start, a.start, InputConfig.data.epsilon)}>
        {a ? Basic.formatTimestamp(a.start) : ''}
      </span>
    {/snippet}
    {#snippet e2({ first: b, second: a })}
      <span class:diff={!b || !a || !Basic.approx(b.end, a.end, InputConfig.data.epsilon)}>
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

  button.right {
    margin-right: 5px;
  }
</style>
