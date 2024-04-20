<script lang="ts">
  import DialogBase from './DialogBase.svelte';
  import { Frontend } from './frontend';
  import { createEventDispatcher } from 'svelte';
  import { SubtitleEntry, SubtitleUtil, type TimeShiftOptions } from './Subtitles';
  import TimestampInput from './TimestampInput.svelte';

  export let frontend: Frontend;
  export let show = false;

  let form: HTMLFormElement;
  let offsetInput = 0;
  let customAnchor = 0;
  let check = false;
  let shiftOption = 'forward';
  let anchorOption = 'zero';
  let fpsBefore = 1, fpsAfter = 1;

  let transStart: number;
  let transEnd: number;

  const dispatch = createEventDispatcher<{submit: TimeShiftOptions}>();
  const submit = (options: TimeShiftOptions) => dispatch('submit', options);

  let cpOffset: number, 
      cpScale: number, 
      cpAnchor: number,
      selectionStart: number,
      selectionEnd: number;
  let selection: SubtitleEntry[];
  
  function updateSelection() {
    selection = frontend.getSelection();
    selectionStart = Math.min(...selection.map((x) => x.start));
    selectionEnd = Math.max(...selection.map((x) => x.end));
    setTransformedRange();
  }

  $: show, updateSelection();
  $: shiftOption, setTransformedRange();
  $: anchorOption, setTransformedRange();

  $: cpOffset = offsetInput * (shiftOption == 'forward' ? 1 : -1);
  $: {
    cpScale = fpsAfter / fpsBefore;
    if (!isFinite(cpScale) || isNaN(cpScale) || cpScale < 0)
      cpScale = 1;
  }
  $: {
    cpAnchor = 0;
    if (anchorOption == 'start')
      cpAnchor = selectionStart;
    if (anchorOption == 'end')
      cpAnchor = selectionEnd;
    if (anchorOption == 'custom')
      cpAnchor = customAnchor;
  }

  function setTransformedRange() {
    setTimeout(() => {
      transStart = Math.max(0, 
        (selectionStart - cpAnchor) * cpScale + cpAnchor + cpOffset);
      transEnd = Math.max(0, 
        (selectionEnd - cpAnchor) * cpScale + cpAnchor + cpOffset);
    }, 0)
  }

  function updateWidgets() {
    let scale = (transEnd - transStart) / (selectionEnd - selectionStart);
    if (!isFinite(scale) || scale < 0) scale = 1;
    fpsBefore = 1;
    fpsAfter = scale;
    cpScale = scale;
    cpOffset = transStart - cpAnchor - (selectionStart - cpAnchor) * scale;
    shiftOption = cpOffset < 0 ? 'backward' : 'forward';
    offsetInput = Math.abs(cpOffset);
  }
</script>

<DialogBase bind:frontend bind:show on:submit={() => {
  // t = (t0 - anchor) * scale + anchor + offset
  // t = t0 * scale + anchor + offset - anchor * scale
  submit({
      selection: frontend.getSelection(),
      offset: cpAnchor + cpOffset - cpAnchor * cpScale,
      modifySince: check,
      scale: cpScale
  });
}}><form bind:this={form}>
  <table class='config'>
    <tr>
      <td>shift times</td>
      <td>
        <input type="radio" id="st1" value="forward" bind:group={shiftOption}/>
        <label for="st1">forward</label>
        <input type="radio" id="st2" value="backward" bind:group={shiftOption}/>
        <label for="st2">backward</label><br/>
        by: <TimestampInput
          bind:timestamp={offsetInput}
          on:input={(ev) => updateWidgets()}/><br/>
        <input type='checkbox' id="st" bind:checked={check}/>
        <label for="st">modify everything after this</label><br/>
      </td>
    </tr>
    <tr>
      <td></td>
      <td><hr/></td>
    </tr>
    <tr>
      <td>FPS before:after</td>
      <td>
        <input type="number" class="number" 
          bind:value={fpsBefore}
          on:input={() => setTransformedRange()}/>
        :
        <input type="number" class="number" 
          bind:value={fpsAfter}
          on:input={() => setTransformedRange()}/>
      </td>
    </tr>
    <tr>
      <td>scaling anchor</td>
      <td>
        <input type="radio" id="anc0" value="zero" bind:group={anchorOption}/>
        <label for="anc0">zero time</label><br/>
        <input type="radio" id="anc1" value="start" bind:group={anchorOption}/>
        <label for="anc1">start of selection</label><br/>
        <input type="radio" id="anc2" value="end" bind:group={anchorOption}/>
        <label for="anc2">end of selection</label><br/>
        <input type="radio" id="anc3" value="custom"  bind:group={anchorOption}/>
        <TimestampInput
          bind:timestamp={customAnchor}
          on:input={() => setTransformedRange()}/>
      </td>
    </tr>
    <tr>
      <td></td>
      <td><hr/></td>
    </tr>
    <tr>
      <td>range</td>
      <td>
        {SubtitleUtil.formatTimestamp(selectionStart)}
        →
        <TimestampInput bind:timestamp={transStart}
          on:input={(ev) => updateWidgets()}/>
        <br/>
        {SubtitleUtil.formatTimestamp(selectionEnd)}
        →
        <TimestampInput bind:timestamp={transEnd}
          on:input={(ev) => updateWidgets()}
          on:change={() => fpsAfter = fpsAfter}/>
      </td>
    </tr>
  </table>
</form></DialogBase>

<style>
  .number {
    width: 60px;
  }
</style>
  