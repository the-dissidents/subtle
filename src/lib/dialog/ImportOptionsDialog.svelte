<script lang="ts">
import { Debug } from "../Debug";
import type { MergePosition, MergeStyleBehavior, MergeStyleSelection, MergeOptions } from "../core/SubtitleUtil.svelte";
import type { DialogHandler } from '../frontend/Dialogs';
import { Source } from '../frontend/Source';

import DialogBase from '../DialogBase.svelte';
import StyleSelect from '../StyleSelect.svelte';

import { _ } from 'svelte-i18n';

interface Props {
  handler: DialogHandler<boolean, MergeOptions | null>;
}

let {
  handler = $bindable(),
}: Props = $props();

let inner: DialogHandler<void> = {};
handler.showModal = async (_hasStyles: boolean) => {
  Debug.assert(inner !== undefined);
  hasStyles = _hasStyles;
  if (!hasStyles) styleOption = 'UseOverrideForAll';
  let btn = await inner.showModal!();
  if (btn !== 'ok') return null;
  return {
    style: styleOption,
    overrideStyle: overrideStyle,
    position: posOption,
    selection: selectOption,
    overrideMetadata: overrideMetadata
  };
}

let overrideStyle = $state(Source.subs.defaultStyle);
let styleOption = $state<MergeStyleBehavior>('KeepDifferent');
let selectOption = $state<MergeStyleSelection>('UsedOnly');
let posOption = $state<MergePosition>('After');
let overrideMetadata = $state(false);
let hasStyles = $state(true)
</script>

<DialogBase handler={inner}><form>
  <table class='config'>
    <tbody>
      <tr>
        <td>{$_('importdialog.metadata')}</td>
        <td>
          <input type="checkbox" id='md'
            bind:checked={overrideMetadata} disabled={!hasStyles} />
          <label for='md'>{$_('importdialog.override-metadata')}</label>
        </td>
      </tr>
      <tr>
        <td>{$_('importdialog.styles')}</td>
        <td>
          <input type="radio" id="is1" value="KeepDifferent" bind:group={styleOption}
            disabled={!hasStyles} />
          <label for="is1">{$_('importdialog.import-only-different-ones')}</label><br/>
          <input type="radio" id="is2" value="KeepAll"
            bind:group={styleOption} disabled={!hasStyles} />
          <label for="is2">{$_('importdialog.import-all-even-if-identical-to-existing-style')}</label><br/>
          <input type="radio" id="is3" value="UseLocalByName"
            bind:group={styleOption} disabled={!hasStyles} />
          <label for="is3">{$_('importdialog.use-local-styles-when-names-match')}</label><br/>
          <input type="radio" id="is4" value="Overwrite"
            bind:group={styleOption} disabled={!hasStyles} />
          <label for="is4">{$_('importdialog.overwrite-local-styles-when-names-match')}</label><br/>
          <input type="radio" id="is5" value="UseOverrideForAll" bind:group={styleOption}/>
          <label for="is5">{$_('importdialog.use-for-all')}<StyleSelect 
            bind:currentStyle={overrideStyle}/></label><br/>
        </td>
      </tr>
      <tr>
        <td>{$_('importdialog.options')}</td>
        <td>
          <input type="radio" id="ia1" value="UsedOnly" 
            bind:group={styleOption} disabled={!hasStyles} />
          <label for="ia1">{$_('importdialog.import-styles-that-are-used')}</label><br/>
  
          <input type="radio" id="ia2" value="All" 
            bind:group={styleOption} disabled={!hasStyles} />
          <label for="ia2">{$_('importdialog.import-unused-styles-as-well')}</label><br/>
  
          <input type="radio" id="ia3" value="OnlyStyles" 
            bind:group={styleOption} disabled={!hasStyles} />
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

