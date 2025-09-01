<script lang="ts">
import { Basic } from '../Basic';
import { SubtitleEntry } from '../core/Subtitles.svelte';
import { type TimeShiftOptions } from "../core/SubtitleUtil.svelte";
import { Debug } from "../Debug";
import DialogBase from '../DialogBase.svelte';
import type { DialogHandler } from '../frontend/Dialogs';
import { Editing } from '../frontend/Editing';
import TimestampInput from '../TimestampInput.svelte';
import NumberInput from '../ui/NumberInput.svelte';

import { _ } from 'svelte-i18n';

interface Props {
  handler: DialogHandler<void, TimeShiftOptions | null>;
}

let {
  handler = $bindable(),
}: Props = $props();

// constants
let selectionStart = $state(0),
    selectionEnd   = $state(0);
  
// variables
let offset       = $state(0),
    fpsBefore    = $state(1),
    fpsAfter     = $state(1),
    transStart   = $state(0),
    transEnd     = $state(0);

// options
let modifySince = $state(false);
let keepDuration = $state(true);
let shiftOption: 'forward' | 'backward' = $state('forward');
let customAnchor = $state(0);
let anchorOption: 'zero' | 'start' | 'end' | 'custom' = $state('start');

let inner: DialogHandler<void> = {};
handler.showModal = async () => {
  Debug.assert(inner !== undefined);
  updateSelection();
  toTransformed();
  let btn = await inner.showModal!();
  if (btn !== 'ok') return null;
  return {
    // t = (t0 - anchor) * scale + anchor + offset
    // t = t0 * scale + anchor + offset - anchor * scale
    selection: Editing.getSelection(),
    offset: cpAnchor + cpOffset - cpAnchor * cpScale,
    modifySince,
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

  const signedOffset = transStart - cpAnchor - (selectionStart - cpAnchor) * scale;
  shiftOption = signedOffset < 0 ? 'backward' : 'forward';
  offset = Math.abs(signedOffset);
}
</script>

<DialogBase handler={inner}>
  <table class='config'>
    <tbody>
      <tr>
        <td colspan="2"><h5>平移</h5></td>
      </tr>
      <tr>
        <td>{$_('transformdialog.shift-times')}</td>
        <td>
          <label><input type="radio" value="backward"
              bind:group={shiftOption} onchange={() => toTransformed()}/>
            {$_('transformdialog.backward')}</label>
          <label><input type="radio" value="forward"
              bind:group={shiftOption} onchange={() => toTransformed()}/>
            {$_('transformdialog.forward')}</label>
          <br/>
          <label>{$_('transformdialog.by')}<TimestampInput
            bind:timestamp={offset}
            oninput={() => toTransformed()}/></label>
          <br/>
          <label><input type='checkbox' bind:checked={modifySince}/>
            {$_('transformdialog.modify-everything-after-this')}</label><br/>
        </td>
      </tr>
      <tr>
        <td colspan="2"><h5>缩放</h5></td>
      </tr>
      <tr>
        <td>{$_('transformdialog.fps-before-after')}</td>
        <td>
          <NumberInput width="60px"
            bind:value={fpsBefore}
            onchange={() => toTransformed()}/>
          :
          <NumberInput width="60px"
            bind:value={fpsAfter}
            onchange={() => toTransformed()}/>
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
        <td colspan="2"><h5>{$_('transformdialog.range')}</h5></td>
      </tr>
      <tr>
        <td colspan="2" style="text-align:start;font-size:100%;padding-left:5px">
          <span class='pre'>{Basic.formatTimestamp(selectionStart)}</span>
          →
          <TimestampInput bind:timestamp={transStart}
            oninput={() => {
              if (keepDuration)
                transEnd = transStart + (selectionEnd - selectionStart) * cpScale;
              fromTransformed();
            }}/>
          <br/>
          <span class='pre'>{Basic.formatTimestamp(selectionEnd)}</span>
          →
          <TimestampInput bind:timestamp={transEnd}
            oninput={() => {
              if (keepDuration)
                transStart = transEnd - (selectionEnd - selectionStart) * cpScale;
              fromTransformed();
            }}/>
          <br/>
          <label>
            <input type='checkbox' bind:checked={keepDuration}>
            保持时长
          </label>
        </td>
      </tr>
    </tbody>
  </table>
</DialogBase>

<style>
  .pre {
    font-family: var(--monospaceFontFamily);
    font-size: 95%;
  }
</style>