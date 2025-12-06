<script lang="ts">
import type { Subtitles } from "../core/Subtitles.svelte";
import type { MergePosition, MergeStyleBehavior, MergeStyleSelection, MergeOptions } from "../core/SubtitleUtil.svelte";
import { Source } from '../frontend/Source';
import DialogBase from '../DialogBase.svelte';
import StyleSelect from '../StyleSelect.svelte';

import { onMount } from "svelte";
import { _ } from 'svelte-i18n';

interface Props {
  args: [hasStyles: boolean, subs: Subtitles],
  close: (ret: MergeOptions | null) => void
}

let {
  args, close
}: Props = $props();

let [hasStyles, subs] = args;
let inner: DialogBase;

onMount(async () => {
  if (!hasStyles) styleOption = 'override';
  let btn = await inner.showModal!();
  if (btn !== 'ok')
    return close(null);

  return close({
    style: 
        styleOption == 'createNewOverride' ? { type: styleOption, name: overrideStyleName }
      : styleOption == 'override' ? { type: styleOption, overrideStyle }
      : { type: styleOption },
    position: { type: posOption },
    selection: selectOption,
    overrideMetadata: overrideMetadata
  });
});

let overrideStyle = $state(Source.subs.defaultStyle);
let overrideStyleName = $state('');
let duplicateWarning = $state(true);

let styleOption = $state<MergeStyleBehavior['type']>('keepDifferent');
let selectOption = $state<MergeStyleSelection>('usedOnly');
let posOption = $state<Exclude<MergePosition['type'], 'custom'>>('after');
let overrideMetadata = $state(false);
</script>

<DialogBase bind:this={inner} buttons={[
  {
    name: 'cancel',
    localizedName: () => $_('cancel')
  },
  {
    name: 'ok',
    localizedName: () => $_('ok'),
    disabled: () => styleOption == 'createNewOverride' && duplicateWarning
  }
]}><form>
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
          <input type="radio" id="is1" value="keepDifferent" bind:group={styleOption}
            disabled={!hasStyles} />
          <label for="is1">{$_('importdialog.import-only-different-ones')}</label><br/>

          <input type="radio" id="is2" value="keepAll"
            bind:group={styleOption} disabled={!hasStyles} />
          <label for="is2">{$_('importdialog.import-all-even-if-identical-to-existing-style')}</label><br/>

          <input type="radio" id="is3" value="useLocalByName"
            bind:group={styleOption} disabled={!hasStyles} />
          <label for="is3">{$_('importdialog.use-local-styles-when-names-match')}</label><br/>

          <input type="radio" id="is4" value="overwrite"
            bind:group={styleOption} disabled={!hasStyles} />
          <label for="is4">{$_('importdialog.overwrite-local-styles-when-names-match')}</label><br/>

          <input type="radio" id="is5" value="override" bind:group={styleOption}/>
          <label for="is5">{$_('importdialog.use-for-all')}
            <StyleSelect
              disabled={styleOption != 'override'}
              bind:currentStyle={overrideStyle}/>
          </label><br/>

          <input type="radio" id="is5" value="createNewOverride" bind:group={styleOption}/>
          <label for="is5">{$_('importdialog.use-new-for-all')}
            <input type='text' 
              disabled={styleOption != 'createNewOverride'}
              class={{duplicate: duplicateWarning}}
              oninput={() => duplicateWarning = !subs 
                || subs.styles.find((x) => x.name == overrideStyleName) !== undefined
                || overrideStyleName == ''}
              bind:value={overrideStyleName} />
          </label><br/>
        </td>
      </tr>
      <tr>
        <td>{$_('importdialog.options')}</td>
        <td>
          <input type="radio" id="ia1" value="usedOnly" 
            bind:group={selectOption} disabled={!hasStyles} />
          <label for="ia1">{$_('importdialog.import-styles-that-are-used')}</label><br/>
  
          <input type="radio" id="ia2" value="all" 
            bind:group={selectOption} disabled={!hasStyles} />
          <label for="ia2">{$_('importdialog.import-unused-styles-as-well')}</label><br/>
  
          <input type="radio" id="ia3" value="onlyStyles" 
            bind:group={selectOption} disabled={!hasStyles} />
          <label for="ia3">{$_('importdialog.import-only-styles-and-no-subtitles')}</label><br/>
        </td>
      </tr>
      <tr>
        <td>{$_('importdialog.position')}</td>
        <td>
          <input type="radio" id="ib1" disabled={selectOption == 'onlyStyles'} value="after" bind:group={posOption}/>
          <label for="ib1">{$_('importdialog.after-existing-lines')}</label><br/>
          <input type="radio" id="ib2" disabled={selectOption == 'onlyStyles'} value="before" bind:group={posOption}/>
          <label for="ib2">{$_('importdialog.before-existing-lines')}</label><br/>
          <input type="radio" id="ib3" disabled={selectOption == 'onlyStyles'} value="sortedBefore" bind:group={posOption}/>
          <label for="ib3">{$_('importdialog.sorted-before-existing-lines-if-time-points-are-equal')}</label><br/>
          <input type="radio" id="ib4" disabled={selectOption == 'onlyStyles'} value="sortedAfter" bind:group={posOption}/>
          <label for="ib4">{$_('importdialog.sorted-after-existing-lines-if-time-points-are-equal')}</label><br/>
          <input type="radio" id="ib5" disabled={selectOption == 'onlyStyles'} value="overwrite" bind:group={posOption}/>
          <label for="ib5">{$_('importdialog.overwrite-current-file')}</label><br/>
        </td>
      </tr>
    </tbody>
  </table>
</form></DialogBase>

<style>
.duplicate:not([disabled]) {
  background-color: lightcoral;
}
</style>