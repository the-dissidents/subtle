<script lang="ts">
import DialogBase from '../DialogBase.svelte';
import { SubtitleEntry } from '../core/Subtitles.svelte';
import { type TimeShiftOptions } from "../core/SubtitleUtil";
import { assert, Basic } from '../Basic';
import { Editing } from '../frontend/Editing';
import type { DialogHandler } from '../frontend/Dialogs';
import TimestampInput from '../TimestampInput.svelte';

import { _ } from 'svelte-i18n';

interface Props {
  handler: DialogHandler<void, TimeShiftOptions | null>;
}

let {
  handler = $bindable(),
}: Props = $props();

// constants
let selectionStart = $state(0),
    selectionEnd = $state(0);
  
// variables
let offset  = $state(0),
    fpsBefore    = $state(1),
    fpsAfter     = $state(1),
    transStart   = $state(0),
    transEnd     = $state(0);

// options
let check = $state(false);
let shiftOption: 'forward' | 'backward' = $state('forward');
let customAnchor = $state(0);
let anchorOption: 'zero' | 'start' | 'end' | 'custom' = $state('start');

let inner: DialogHandler<void> = {};
handler.showModal = async () => {
  assert(inner !== undefined);
  updateSelection();
  toTransformed();
  let btn = await inner.showModal!();
  if (btn !== 'ok') return null;
  return {
    // t = (t0 - anchor) * scale + anchor + offset
    // t = t0 * scale + anchor + offset - anchor * scale
    selection: Editing.getSelection(),
    offset: cpAnchor + cpOffset - cpAnchor * cpScale,
    modifySince: check,
    scale: cpScale
  };
}

// deriveds
let cpOffset = $derived(offset * (shiftOption == 'forward' ? 1 : -1));
let cpScale = $derived.by(() => {
  let x = fpsAfter / fpsBefore;
  if (!isFinite(x) || isNaN(x) || x < 0) return 1;
  return x;
});
let cpAnchor = $derived.by(() => {
  if (anchorOption == 'start')
    return selectionStart;
  if (anchorOption == 'end')
    return selectionEnd;
  if (anchorOption == 'custom')
    return customAnchor;
  return 0;
});

let selection: SubtitleEntry[];

function updateSelection() {
  selection = Editing.getSelection();
  selectionStart = Math.min(...selection.map((x) => x.start));
  selectionEnd = Math.max(...selection.map((x) => x.end));
}

function toTransformed() {
  transStart = Math.max(0, (selectionStart - cpAnchor) * cpScale + cpAnchor + cpOffset);
  transEnd = Math.max(0, (selectionEnd - cpAnchor) * cpScale + cpAnchor + cpOffset);
}

function fromTransformed() {
  let scale = (transEnd - transStart) / (selectionEnd - selectionStart);
  if (!isFinite(scale) || scale < 0) scale = 1;
  fpsBefore = 1;
  fpsAfter = scale;

  let offset = transStart - cpAnchor - (selectionStart - cpAnchor) * scale;
  offset = Math.abs(offset);
  shiftOption = offset < 0 ? 'backward' : 'forward';
}
</script>

<DialogBase handler={inner}>
  <table class='config'>
    <tbody>
      <tr>
        <td>{$_('transformdialog.shift-times')}</td>
        <td>
          <label><input type="radio" value="forward"
              bind:group={shiftOption} onchange={() => toTransformed()}/>
            {$_('transformdialog.forward')}</label>
          <label><input type="radio" value="backward"
              bind:group={shiftOption} onchange={() => toTransformed()}/>
            {$_('transformdialog.backward')}</label><br/>
          <label>{$_('transformdialog.by')}<TimestampInput
            bind:timestamp={offset}
            oninput={() => toTransformed()}/></label><br/>
          <label><input type='checkbox' bind:checked={check}/>
            {$_('transformdialog.modify-everything-after-this')}</label><br/>
        </td>
      </tr>
      <tr>
        <td></td>
        <td><hr/></td>
      </tr>
      <tr>
        <td>{$_('transformdialog.fps-before-after')}</td>
        <td>
          <input type="number" class="number" 
            bind:value={fpsBefore}
            oninput={() => toTransformed()}/>
          :
          <input type="number" class="number" 
            bind:value={fpsAfter}
            oninput={() => toTransformed()}/>
        </td>
      </tr>
      <tr>
        <td>{$_('transformdialog.scaling-anchor')}</td>
        <td>
          <label><input type="radio" value="zero"
              bind:group={anchorOption} onchange={() => toTransformed()}/>
            {$_('transformdialog.zero-time')}</label><br/>
          <label><input type="radio" value="start"
              bind:group={anchorOption} onchange={() => toTransformed()}/>
            {$_('transformdialog.start-of-selection')}</label><br/>
          <label><input type="radio" value="end"
              bind:group={anchorOption} onchange={() => toTransformed()}/>
            {$_('transformdialog.end-of-selection')}</label><br/>
          <label>
            <input type="radio" value="custom"
              bind:group={anchorOption} onchange={() => toTransformed()}/>
            <TimestampInput
              bind:timestamp={customAnchor}
              oninput={() => toTransformed()}/>
          </label>
        </td>
      </tr>
      <tr>
        <td></td>
        <td><hr/></td>
      </tr>
      <tr>
        <td>{$_('transformdialog.range')}</td>
        <td>
          {Basic.formatTimestamp(selectionStart)}
          →
          <TimestampInput bind:timestamp={transStart}
            oninput={() => fromTransformed()}/>
          <br/>
          {Basic.formatTimestamp(selectionEnd)}
          →
          <TimestampInput bind:timestamp={transEnd}
            oninput={() => fromTransformed()}/>
        </td>
      </tr>
    </tbody>
  </table>
</DialogBase>

<style>
  .number {
    width: 60px;
  }
</style>
  