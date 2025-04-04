<script lang="ts">
import { SubtitleEntry, type LabelTypes } from '../core/Subtitles.svelte';
import { Debug } from "../Debug";
import DialogBase from '../DialogBase.svelte';
import type { DialogHandler } from '../frontend/Dialogs';
import { Editing } from '../frontend/Editing';
import { ChangeType, Source } from '../frontend/Source';

import { _ } from 'svelte-i18n';
import LabelSelect from '../LabelSelect.svelte';

interface Props {
  handler: DialogHandler<void, void>;
}

let {
  handler = $bindable()
}: Props = $props();

let inner: DialogHandler<void> = {}
let start = $state(0),
    end = $state(0);
let markStart = $state(0.05),
    markEnd = $state(0.05);
let number = $state([0, 0, 0] as [number, number, number]);
let selectionOnly = $state(true), 
    doMark = $state(true),
    markLabel = $state('red' as LabelTypes),
    hasbeen = $state(false);

handler.showModal = async () => {
  Debug.assert(inner !== undefined);
  run(false);
  await inner.showModal!();
}

function run(doit: boolean) 
{
  start = start ?? 0;
  end = end ?? 0;
  number = [0, 0, 0];

  let selection: SubtitleEntry[]
  if (selectionOnly) {
    let s = Editing.getSelection();
    if (s.length > 0) selection = s;
    else selection = [...Source.subs.entries];
  } else selection = [...Source.subs.entries];

  let done = new Set<SubtitleEntry>();
  let marked = new Set<SubtitleEntry>();
  for (let i = 0; i < selection.length - 1; i++) {
    let entry0 = selection[i];
    let styles = new Set(entry0.texts.keys());
    let n = 1;
    if (done.has(entry0)) continue;
    for (let j = i+1; j < selection.length; j++) {
      let entry1 = selection[j];
      if (done.has(entry1)) continue;
      if (Math.abs(entry0.start - entry1.start) <= start
       && Math.abs(entry0.end - entry1.end) <= end)
      {
        let s2 = [...entry1.texts.keys()];
        if (s2.some((x) => styles.has(x)))
          continue; // only combine different styles
        s2.forEach((x) => styles.add(x));
        if (doit) {
          for (const [style, text] of entry1.texts)
            entry0.texts.set(style, text);
          Source.subs.entries.splice(
            Source.subs.entries.indexOf(entry1), 1);
        }
        n += 1;
        done.add(entry1);
        continue;
      }

      if (Math.abs(entry0.start - entry1.start) <= markStart 
       && Math.abs(entry0.end - entry1.end) <= markEnd && doMark)
      {
        marked.add(entry0);
        marked.add(entry1);
        if (doit) {
          entry0.label = markLabel;
          entry1.label = markLabel;
        }
      }
    }
    if (n > 1) {
      number[0] += n;
      number[1] += 1;
    }
  }

  number[2] = marked.size;
  if (doit) {
    hasbeen = true;
    if (done.size > 0) {
      Editing.clearSelection();
      for (let ent of selection.filter((x) => !done.has(x)))
        Editing.selection.submitted.add(ent);
      Source.markChanged(ChangeType.Times);
    }
    if (marked.size > 0) {
      if (done.size == 0)
        Source.markChanged(ChangeType.InPlace);
    }
  } else
    hasbeen = false;
}

</script>

<DialogBase handler={inner} buttons={[{
  name: 'ok',
  localizedName: () => $_('back')
}]}>
  <table class="config">
    <tbody>
      <tr>
        <td colspan="2"><h5>
          {$_('combinedialog.combine-those')}
        </h5></td>
      </tr>
      <tr>
        <td>{$_('combinedialog.start-time-threshold')}</td>
        <td><input type='number' min='0' step="0.001" 
          bind:value={start}
          onchange={() => run(false)} /></td>
      </tr>
      <tr>
        <td>{$_('combinedialog.end-time-threshold')}</td>
        <td><input type='number' min='0' step="0.001"
          bind:value={end}
          onchange={() => run(false)} /></td>
      </tr>
      <tr>
        <td colspan="2"><h5>
          <input type='checkbox' bind:checked={doMark} 
            onchange={() => run(false)} />
          {$_('combinedialog.label-possibly-problematic-entries')}
        </h5></td>
      </tr>
      <tr>
        <td>{$_('combinedialog.start-time-threshold')}</td>
        <td><input type='number' min='0' step="0.001" 
          disabled={!doMark}
          bind:value={markStart}
          onchange={() => run(false)} /></td>
      </tr>
      <tr>
        <td>{$_('combinedialog.end-time-threshold')}</td>
        <td><input type='number' min='0' step="0.001"
          disabled={!doMark}
          bind:value={markEnd}
          onchange={() => run(false)} /></td>
      </tr>
      <tr>
        <td>{$_('combinedialog.label-as')}</td>
        <td><LabelSelect
          disabled={!doMark}
          bind:value={markLabel}
          onsubmit={() => run(false)} /></td>
      </tr>
      <tr>
        <td colspan="2"><hr></td>
      </tr>
      <tr>
        <td></td>
        <td>
          <input type="checkbox" bind:checked={selectionOnly}
            onchange={() => run(false)} />
          {$_('combinedialog.selection-only')}<br>
        </td>
      </tr>
      <tr>
        <td colspan="2"><hr></td>
      </tr>
      <tr>
        <td>{number[0]}</td>
        <td>
          {hasbeen 
            ? $_('combinedialog.have-been-combined-in', {values: {n: number[0]}}) 
            : $_('combinedialog.will-be-combined-in', {values: {n: number[0]}})}
        </td>
      </tr>
      <tr>
        <td>{number[1]}</td>
        <td>{$_('combinedialog.groups', {values: {n: number[1]}})}</td>
      </tr>
      <tr>
        <td>{number[2]}</td>
        <td>
          {hasbeen 
            ? $_('combinedialog.have-been-labeled', {values: {
              n: number[0], color: $_(`label.${markLabel}`)
            }}) 
            : $_('combinedialog.will-be-labeled', {values: {
              n: number[0], color: $_(`label.${markLabel}`)
            }})}
        </td>
      </tr>
    </tbody>
  </table>
  <p>
    {$_('combinedialog.explanation')}
  </p>
  <button style="width: 100%;" 
    onclick={() => run(true)}
  >{$_('combinedialog.combine')}</button>
</DialogBase>

<style>
  h5 {
    font-size: 0.9rem;
  }
  table.config td[colspan='2'] {
    white-space: normal;
    text-align: start;
  }
  p {
    max-width: 25em;
    font-size: 0.9rem;
  }
</style>