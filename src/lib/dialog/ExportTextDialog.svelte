<script lang="ts">
import { SubtitleEntry, type SubtitleStyle } from '../core/Subtitles.svelte';
import { Source } from '../frontend/Source';
import DialogBase from '../DialogBase.svelte';

import { _ } from 'svelte-i18n';
import { LinearFormatCombineStrategy, type FormatOption } from '../core/SubtitleUtil.svelte';
import { Format } from '../core/SimpleFormats';
import { Frontend } from '../frontend/Frontend';
import Tooltip from '../ui/Tooltip.svelte';
  import { onMount } from 'svelte';

interface Props {
  args: [],
  close: (ret: {content: string, ext: string} | null) => void
}

let { args: _args, close }: Props = $props();

let inner: DialogBase;

onMount(async () => {
  let subs = Source.subs;
  let map = new Map<string, number>();
  for (const entry of subs.entries)
    for (const [style, _] of entry.texts)
      map.set(style.name, (map.get(style.name) ?? 0) + 1);

  styles = subs.styles.map(
    (x) => ({style: x, count: map.get(x.name) ?? 0, use: true}));
  makePreview();
  let btn = await inner!.showModal!();
  if (btn !== 'ok') return close(null);
  return close({ content: preview, ext: extensions[fileFormat] });
});

let styles: {style: SubtitleStyle, count: number, use: boolean}[] = $state([]);
let combine = $state(LinearFormatCombineStrategy.Recombine);
let fileFormat: 'srt' | 'tab' | 'txt' = $state('srt');
let inlineFormat: FormatOption = $state('html');
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
  preview = formatters[fileFormat](Source.subs)
    .useEntries(entries)
    .strategy(combine)
    .format(inlineFormat)
    .toString();
}

async function copy() {
  await navigator.clipboard.writeText(preview);
  Frontend.setStatus($_('msg.copied-exported-data'));
}

</script>

<DialogBase bind:this={inner} maxWidth="40em">
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
        {#each styles as entry (entry)}
        <tr>
          <td><input type="checkbox" 
            bind:checked={entry.use} 
            disabled={entry.count == 0}
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
        <Tooltip position="right"
          text={$_('exportdialog.keep-order-d')}/>
      </label><br/>
      <label><input type="radio" bind:group={combine}
            value={LinearFormatCombineStrategy.Sorted}
            onchange={() => makePreview()} />
        {$_('exportdialog.sorted')}
        <Tooltip position="right"
          text={$_('exportdialog.sorted-d')}/>
      </label><br/>
      <label><input type="radio" bind:group={combine}
            value={LinearFormatCombineStrategy.Recombine}
            onchange={() => makePreview()} />
        {$_('exportdialog.recombine')}
        <Tooltip position="right"
          text={$_('exportdialog.recombine-d')}/>
      </label><br/>

      <h5>{$_('exportdialog.file-format')}</h5>
      <label><input type="radio" bind:group={fileFormat} value="srt"
            onchange={() => makePreview()} />
        {$_('exportdialog.srt')}
      </label><br/>
      <label><input type="radio" bind:group={fileFormat} value="txt"
            onchange={() => makePreview()} />
        {$_('exportdialog.plaintext')}
      </label><br/>
      <label><input type="radio" bind:group={fileFormat} value="tab"
            onchange={() => makePreview()} />
        {$_('exportdialog.tab-delimited')}
      </label>
      <h5>{$_('exportdialog.inline-format')}</h5>
      <label><input type="radio" bind:group={inlineFormat} value="none"
            onchange={() => makePreview()} />
        {$_('exportdialog.remove-inline-formatting')}
      </label><br/>
      <label><input type="radio" bind:group={inlineFormat} value="html"
            onchange={() => makePreview()} />
        {$_('exportdialog.use-html')}
      </label><br/>
      <label><input type="radio" bind:group={inlineFormat} value="ass"
            onchange={() => makePreview()} />
        {$_('exportdialog.use-ass')}
      </label>
      <hr>
      <p style="font-size: 90%; margin: 5px;">
        {$_('exportdialog.format-d')}
      </p>
    </div>
    <div class='vlayout rightpane'>
      <textarea class="preview flexgrow" readonly>{preview}</textarea>
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
    height: 100%;
  }
  textarea.preview {
    min-width: 300px;
    min-height: 350px;
    resize: none;
    font-size: 85%;
  }
  button {
    width: 100%;
    margin-top: 5px;
  }
</style>