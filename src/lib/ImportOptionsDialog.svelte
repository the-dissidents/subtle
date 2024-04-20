<script lang="ts">
  import DialogBase from './DialogBase.svelte';
  import { Frontend } from './frontend';
  import StyleSelect from './StyleSelect.svelte';
    import { createEventDispatcher } from 'svelte';
    import { MergeStyleBehavior, type MergeOptions, MergePosition } from './Subtitles';

  export let frontend: Frontend;
  export let show = false;

  let form: HTMLFormElement;
  let select: StyleSelect;
  let check: HTMLInputElement;
  let overrideStyle = frontend.subs.defaultStyle;
  let styleOption = 'KeepDifferent';
  let posOption = 'After';

	const dispatch = createEventDispatcher<{submit: MergeOptions}>();
	const submit = (options: MergeOptions) => dispatch('submit', options);
</script>

<DialogBase bind:frontend bind:show on:submit={() => {
  submit({
    // @ts-ignore
    style: MergeStyleBehavior[styleOption],
    overrideStyle: overrideStyle,
    // @ts-ignore
    position: MergePosition[posOption],
    importAllStyles: check.checked
  })
}}><form bind:this={form}>
  <table class='config'>
    <tr>
      <td>styles</td>
      <td>
        <input type="radio" id="is1" value="KeepDifferent" bind:group={styleOption}/>
        <label for="is1">import only different ones</label><br/>
        <input type="radio" id="is2" value="KeepAll" bind:group={styleOption}/>
        <label for="is2">import all (even if identical to existing style)</label><br/>
        <input type="radio" id="is3" value="UseLocalByName" bind:group={styleOption}/>
        <label for="is3">use local styles when names match</label><br/>
        <input type="radio" id="is4" value="Overwrite" bind:group={styleOption}/>
        <label for="is4">overwrite local styles when names match</label><br/>
        <input type="radio" id="is5" value="UseOverrideForAll" bind:group={styleOption}/>
        <label for="is5">use <StyleSelect bind:this={select}
          subtitles={frontend.subs}
          bind:currentStyle={overrideStyle}/> for all</label><br/>
      </td>
    </tr>
    <tr>
      <td></td>
      <td>
        <input type='checkbox' id="i6" bind:this={check}/>
        <label for="i6">import unused styles as well</label><br/>
      </td>
    </tr>
    <tr>
      <td>position</td>
      <td>
        <input type="radio" id="ib1" value="After" bind:group={posOption}/>
        <label for="ib1">after existing lines</label><br/>
        <input type="radio" id="ib2" value="Before" bind:group={posOption}/>
        <label for="ib2">before existing lines</label><br/>
        <input type="radio" id="ib3" value="SortedBefore" bind:group={posOption}/>
        <label for="ib3">sorted; before existing lines if time points are equal</label><br/>
        <input type="radio" id="ib4" value="SortedAfter" bind:group={posOption}/>
        <label for="ib4">sorted; after existing lines if time points are equal</label><br/>
        <input type="radio" id="ib5" value="Overwrite" bind:group={posOption}/>
        <label for="ib5">overwrite current file</label><br/>
      </td>
    </tr>
  </table>
</form></DialogBase>

