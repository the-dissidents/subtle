<script lang="ts">
  import DialogBase, { type DialogHandler } from '../DialogBase.svelte';
  import { Frontend } from '../Frontend';
  import { SubtitleEntry, SubtitleUtil, type TimeShiftOptions } from '../core/Subtitles.svelte';
  import TimestampInput from '../TimestampInput.svelte';
    import { assert } from '../Basic';

  let form: HTMLFormElement;

  interface Props {
		handler: DialogHandler<void, TimeShiftOptions | null>;
		frontend: Frontend;
	}

  let {
		handler = $bindable(),
		frontend = $bindable()
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
      selection: frontend.getSelection(),
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
    selection = frontend.getSelection();
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

<DialogBase bind:frontend handler={inner}><form bind:this={form}>
  <table class='config'>
    <tbody>
      <tr>
        <td>shift times</td>
        <td>
          <label><input type="radio" value="forward"
              bind:group={shiftOption} onchange={() => toTransformed()}/>
            forward</label>
          <label><input type="radio" value="backward"
              bind:group={shiftOption} onchange={() => toTransformed()}/>
            backward</label><br/>
          <label>by: <TimestampInput
            bind:timestamp={offset}
            on:input={() => toTransformed()}/></label><br/>
          <label><input type='checkbox' bind:checked={check}/>
            modify everything after this</label><br/>
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
            oninput={() => toTransformed()}/>
          :
          <input type="number" class="number" 
            bind:value={fpsAfter}
            oninput={() => toTransformed()}/>
        </td>
      </tr>
      <tr>
        <td>scaling anchor</td>
        <td>
          <label><input type="radio" value="zero"
              bind:group={anchorOption} onchange={() => toTransformed()}/>
            zero time</label><br/>
          <label><input type="radio" value="start"
              bind:group={anchorOption} onchange={() => toTransformed()}/>
            start of selection</label><br/>
          <label><input type="radio" value="end"
              bind:group={anchorOption} onchange={() => toTransformed()}/>
            end of selection</label><br/>
          <label>
            <input type="radio" value="custom"
              bind:group={anchorOption} onchange={() => toTransformed()}/>
            <TimestampInput
              bind:timestamp={customAnchor}
              on:input={() => toTransformed()}/>
          </label>
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
            on:input={() => fromTransformed()}/>
          <br/>
          {SubtitleUtil.formatTimestamp(selectionEnd)}
          →
          <TimestampInput bind:timestamp={transEnd}
            on:input={() => fromTransformed()}/>
        </td>
      </tr>
    </tbody>
  </table>
</form></DialogBase>

<style>
  .number {
    width: 60px;
  }
</style>
  