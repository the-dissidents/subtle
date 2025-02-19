<script lang="ts">
  import DialogBase, { type DialogHandler } from './DialogBase.svelte';
  import { Frontend } from './Frontend';
  import StyleSelect from './StyleSelect.svelte';
  import { MergeStyleBehavior, type MergeOptions, MergePosition, MergeStyleSelection } from './Subtitles';

  interface Props {
		handler: DialogHandler<MergeOptions>;
		frontend: Frontend;
	}

  let {
		handler = $bindable(),
		frontend = $bindable()
  }: Props = $props();

  let inner: DialogHandler<void> = {
    show: handler.show, 
    onSubmit: () => {
      handler.onSubmit?.({
        // @ts-ignore
        style: MergeStyleBehavior[styleOption],
        overrideStyle: overrideStyle,
        // @ts-ignore
        position: MergePosition[posOption],
        // @ts-ignore
        selection: MergeStyleSelection[selectOption],
        overrideMetadata: overrideMetadata
      });
    }
  };
  
  let form: HTMLFormElement;
  let select: StyleSelect;
  let overrideStyle = $state(frontend.subs.defaultStyle);
  let styleOption = $state('KeepDifferent');
  let selectOption = $state('UsedOnly');
  let posOption = $state('After');
  let overrideMetadata = $state(false);

  
</script>

<DialogBase bind:frontend handler={inner}><form bind:this={form}>
  <table class='config'>
    <tbody>
      <tr>
        <td>metadata</td>
        <td>
          <input type="checkbox" id='md' bind:checked={overrideMetadata} />
          <label for='md'>override metadata</label>
        </td>
      </tr>
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
        <td>options</td>
        <td>
          <input type="radio" id="ia1" value="UsedOnly" bind:group={selectOption}/>
          <label for="ia1">import styles that are used</label><br/>
  
          <input type="radio" id="ia2" value="All" bind:group={selectOption}/>
          <label for="ia2">import unused styles as well</label><br/>
  
          <input type="radio" id="ia3" value="OnlyStyles" bind:group={selectOption}/>
          <label for="ia3">import only styles and no subtitles</label><br/>
        </td>
      </tr>
      <tr>
        <td>position</td>
        <td>
          <input type="radio" id="ib1" disabled={selectOption == 'OnlyStyles'} value="After" bind:group={posOption}/>
          <label for="ib1">after existing lines</label><br/>
          <input type="radio" id="ib2" disabled={selectOption == 'OnlyStyles'} value="Before" bind:group={posOption}/>
          <label for="ib2">before existing lines</label><br/>
          <input type="radio" id="ib3" disabled={selectOption == 'OnlyStyles'} value="SortedBefore" bind:group={posOption}/>
          <label for="ib3">sorted; before existing lines if time points are equal</label><br/>
          <input type="radio" id="ib4" disabled={selectOption == 'OnlyStyles'} value="SortedAfter" bind:group={posOption}/>
          <label for="ib4">sorted; after existing lines if time points are equal</label><br/>
          <input type="radio" id="ib5" disabled={selectOption == 'OnlyStyles'} value="Overwrite" bind:group={posOption}/>
          <label for="ib5">overwrite current file</label><br/>
        </td>
      </tr>
    </tbody>
  </table>
</form></DialogBase>

