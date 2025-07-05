<script lang="ts">
import { SubtitleEntry, type SubtitleStyle } from '../core/Subtitles.svelte';
import { Source } from '../frontend/Source';
import type { DialogHandler } from '../frontend/Dialogs';
import DialogBase from '../DialogBase.svelte';

import { _ } from 'svelte-i18n';
import { LinearFormatCombineStrategy } from '../core/SubtitleUtil.svelte';
import { Format } from '../core/SimpleFormats';
import { Frontend } from '../frontend/Frontend';

interface Props {
  handler: DialogHandler<void, {content: string, ext: string} | null>;
}

let {
  handler = $bindable(),
}: Props = $props();

let inner: DialogHandler<void, string> = {};
handler.showModal = async () => {
  let subs = Source.subs;
  let map = new Map<string, number>();
  for (const entry of subs.entries)
    for (const [style, _] of entry.texts)
      map.set(style.name, (map.get(style.name) ?? 0) + 1);

  styles = subs.styles.map(
    (x) => ({style: x, count: map.get(x.name) ?? 0, use: true}));
  makePreview();
  let btn = await inner!.showModal!();
  if (btn !== 'ok') return null;
  return { content: preview, ext: extensions[format] };
};

let styles: {style: SubtitleStyle, count: number, use: boolean}[] = $state([]);
let combine = $state(LinearFormatCombineStrategy.Recombine);
let format: 'srt' | 'tab' | 'txt' = $state('srt');
let preview = $state('');

const formatters = {
  'srt': Format.SRT.write,
  'txt': Format.plaintext.write,
  'tab': Format.tabDelimited.write
};

const extensions = {
  'srt': 'srt',
  'txt': 'txt',
  'tab': 'txt'
};

function makePreview() {
  let styleSet = new Set(styles
    .filter((x) => x.use).map((x) => x.style));
  let entries: SubtitleEntry[] = [];
  const usedStyles = Source.subs.styles.filter((x) => styleSet.has(x));
  for (const e of Source.subs.entries) {
    let entry = new SubtitleEntry(e.start, e.end);
    for (const style of usedStyles)
      if (e.texts.has(style))
        entry.texts.set(style, e.texts.get(style)!);
    if (entry.texts.size > 0)
      entries.push(entry);
  }
  preview = formatters[format](Source.subs)
    .useEntries(entries)
    .strategy(combine)
    .toString();
}

async function copy() {
  await navigator.clipboard.writeText(preview);
  Frontend.setStatus($_('msg.copied-exported-data'));
}
</script>

<DialogBase handler={inner} maxWidth="48em">
  {#snippet header()}
    <h4>{$_('exportdialog.header')}</h4>
  {/snippet}
  <div class="hlayout">
    <div>
      <table class="data">
        <thead>
        <tr>
          <th></th>
          <th class="stylename">{$_('exportdialog.style')}</th>
          <th>{$_('exportdialog.usage')}</th>
        </tr>
        </thead>
        <tbody>
        {#each styles as entry}
        <tr>
          <td><input type="checkbox" 
            bind:checked={entry.use} 
            onchange={() => makePreview()} /></td>
          <td>{entry.style.name}</td>
          <td>{entry.count}</td>
        </tr>
        {/each}
        </tbody>
      </table>

      <h5>{$_('exportdialog.combine-strategy')}</h5>
      <label><input type="radio" bind:group={combine}
            value={LinearFormatCombineStrategy.KeepOrder}
            onchange={() => makePreview()} />
        {$_('exportdialog.keep-order')}
      </label><br/>
      <label><input type="radio" bind:group={combine}
            value={LinearFormatCombineStrategy.Sorted}
            onchange={() => makePreview()} />
        {$_('exportdialog.sorted')}
      </label><br/>
      <label><input type="radio" bind:group={combine}
            value={LinearFormatCombineStrategy.Recombine}
            onchange={() => makePreview()} />
        {$_('exportdialog.recombine')}
      </label><br/>

      <h5>{$_('exportdialog.format')}</h5>
      <label><input type="radio" bind:group={format} value="srt"
            onchange={() => makePreview()} />
        {$_('exportdialog.srt')}
      </label><br/>
      <label><input type="radio" bind:group={format} value="txt"
            onchange={() => makePreview()} />
        {$_('exportdialog.plaintext')}
      </label><br/>
      <label><input type="radio" bind:group={format} value="tab"
            onchange={() => makePreview()} />
        {$_('exportdialog.tab-delimited')}
      </label><br/>
    </div>
    <div class='vlayout rightpane'>
      <textarea class="preview" readonly>{preview}</textarea>
      <button onclick={() => copy()}>{$_('exportdialog.copy-to-clipboard')}</button>
    </div>
  </div>
</DialogBase>

<style>
  .stylename {
    min-width: 100px;
  }
  table {
    margin-right: 5px;
    width: 100%;
  }
  .rightpane {
    margin-left: 10px;
  }
  textarea.preview {
    min-width: 300px;
    min-height: 250px;
    resize: none;
    font-size: 85%;
  }
  button {
    width: 100%;
    margin-top: 5px;
  }
</style>