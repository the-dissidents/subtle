<script lang="ts">
import { Debug } from "../Debug";
import { MergePosition, MergeStyleBehavior, MergeStyleSelection, type MergeOptions } from "../core/SubtitleUtil";
import type { DialogHandler } from '../frontend/Dialogs';
import { Source } from '../frontend/Source';

import DialogBase from '../DialogBase.svelte';
import StyleSelect from '../StyleSelect.svelte';

import { _ } from 'svelte-i18n';

interface Props {
  handler: DialogHandler<void, MergeOptions | null>;
}

let {
  handler = $bindable(),
}: Props = $props();

let inner: DialogHandler<void> = {};
handler.showModal = async () => {
  Debug.assert(inner !== undefined);
  let btn = await inner.showModal!();
  if (btn !== 'ok') return null;
  return {
    // @ts-ignore
    style: MergeStyleBehavior[styleOption],
    overrideStyle: overrideStyle,
    // @ts-ignore
    position: MergePosition[posOption],
    // @ts-ignore
    selection: MergeStyleSelection[selectOption],
    overrideMetadata: overrideMetadata
  };
}

let overrideStyle = $state(Source.subs.defaultStyle);
let styleOption = $state('KeepDifferent');
let selectOption = $state('UsedOnly');
let posOption = $state('After');
let overrideMetadata = $state(false);
</script>

<DialogBase handler={inner}><form>
  <table class='config'>
    <tbody>
      <tr>
        <td>{$_('importdialog.metadata')}</td>
        <td>
          <input type="checkbox" id='md' bind:checked={overrideMetadata} />
          <label for='md'>{$_('importdialog.override-metadata')}</label>
        </td>
      </tr>
      <tr>
        <td>{$_('importdialog.styles')}</td>
        <td>
          <input type="radio" id="is1" value="KeepDifferent" bind:group={styleOption}/>
          <label for="is1">{$_('importdialog.import-only-different-ones')}</label><br/>
          <input type="radio" id="is2" value="KeepAll" bind:group={styleOption}/>
          <label for="is2">{$_('importdialog.import-all-even-if-identical-to-existing-style')}</label><br/>
          <input type="radio" id="is3" value="UseLocalByName" bind:group={styleOption}/>
          <label for="is3">{$_('importdialog.use-local-styles-when-names-match')}</label><br/>
          <input type="radio" id="is4" value="Overwrite" bind:group={styleOption}/>
          <label for="is4">{$_('importdialog.overwrite-local-styles-when-names-match')}</label><br/>
          <input type="radio" id="is5" value="UseOverrideForAll" bind:group={styleOption}/>
          <label for="is5">{$_('importdialog.use-for-all')}<StyleSelect 
            bind:currentStyle={overrideStyle}/></label><br/>
        </td>
      </tr>
      <tr>
        <td>{$_('importdialog.options')}</td>
        <td>
          <input type="radio" id="ia1" value="UsedOnly" bind:group={selectOption}/>
          <label for="ia1">{$_('importdialog.import-styles-that-are-used')}</label><br/>
  
          <input type="radio" id="ia2" value="All" bind:group={selectOption}/>
          <label for="ia2">{$_('importdialog.import-unused-styles-as-well')}</label><br/>
  
          <input type="radio" id="ia3" value="OnlyStyles" bind:group={selectOption}/>
          <label for="ia3">{$_('importdialog.import-only-styles-and-no-subtitles')}</label><br/>
        </td>
      </tr>
      <tr>
        <td>{$_('importdialog.position')}</td>
        <td>
          <input type="radio" id="ib1" disabled={selectOption == 'OnlyStyles'} value="After" bind:group={posOption}/>
          <label for="ib1">{$_('importdialog.after-existing-lines')}</label><br/>
          <input type="radio" id="ib2" disabled={selectOption == 'OnlyStyles'} value="Before" bind:group={posOption}/>
          <label for="ib2">{$_('importdialog.before-existing-lines')}</label><br/>
          <input type="radio" id="ib3" disabled={selectOption == 'OnlyStyles'} value="SortedBefore" bind:group={posOption}/>
          <label for="ib3">{$_('importdialog.sorted-before-existing-lines-if-time-points-are-equal')}</label><br/>
          <input type="radio" id="ib4" disabled={selectOption == 'OnlyStyles'} value="SortedAfter" bind:group={posOption}/>
          <label for="ib4">{$_('importdialog.sorted-after-existing-lines-if-time-points-are-equal')}</label><br/>
          <input type="radio" id="ib5" disabled={selectOption == 'OnlyStyles'} value="Overwrite" bind:group={posOption}/>
          <label for="ib5">{$_('importdialog.overwrite-current-file')}</label><br/>
        </td>
      </tr>
    </tbody>
  </table>
</form></DialogBase>

