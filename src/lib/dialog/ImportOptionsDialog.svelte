<script lang="ts">
import type { Subtitles } from "../core/Subtitles.svelte";
import type { MergePosition, MergeStyleBehavior, MergeStyleSelection, MergeOptions } from "../core/SubtitleUtil.svelte";
import { Source } from '../frontend/Source';
import { ConfigRow, ConfigTable } from '@the_dissidents/svelte-ui';
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

// svelte-ignore state_referenced_locally
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
]}>
  <ConfigTable>
    <ConfigRow name={$_('importdialog.metadata')}>
      <label>
        <input type="checkbox"
          bind:checked={overrideMetadata} disabled={!hasStyles} />
        {$_('importdialog.override-metadata')}
      </label>
    </ConfigRow>
    <ConfigRow name={$_('importdialog.styles')}>
      <label>
        <input type="radio" value="keepDifferent" bind:group={styleOption}
          disabled={!hasStyles} />
        {$_('importdialog.import-only-different-ones')}
      </label><br/>

      <label>
        <input type="radio" value="keepAll"
          bind:group={styleOption} disabled={!hasStyles} />
        {$_('importdialog.import-all-even-if-identical-to-existing-style')}
      </label><br/>

      <label>
        <input type="radio" value="useLocalByName"
          bind:group={styleOption} disabled={!hasStyles} />
        {$_('importdialog.use-local-styles-when-names-match')}
      </label><br/>

      <label>
        <input type="radio" value="overwrite"
          bind:group={styleOption} disabled={!hasStyles} />
        {$_('importdialog.overwrite-local-styles-when-names-match')}
      </label><br/>

      <label>
        <input type="radio" value="override" bind:group={styleOption}/>
        {$_('importdialog.use-for-all')}
        <StyleSelect
          disabled={styleOption != 'override'}
          bind:currentStyle={overrideStyle}/>
      </label><br/>

      <label>
        <input type="radio" value="createNewOverride" bind:group={styleOption}/>
        {$_('importdialog.use-new-for-all')}
        <input type='text'
          disabled={styleOption != 'createNewOverride'}
          class={{duplicate: duplicateWarning}}
          oninput={() => duplicateWarning = !subs
            || subs.styles.find((x) => x.name == overrideStyleName) !== undefined
            || overrideStyleName == ''}
          bind:value={overrideStyleName} />
      </label><br/>
    </ConfigRow>
    <ConfigRow name={$_('importdialog.options')}>
      <label>
        <input type="radio" value="usedOnly"
          bind:group={selectOption} disabled={!hasStyles} />
        {$_('importdialog.import-styles-that-are-used')}
      </label><br/>

      <label>
        <input type="radio" value="all"
          bind:group={selectOption} disabled={!hasStyles} />
        {$_('importdialog.import-unused-styles-as-well')}
      </label><br/>

      <label>
        <input type="radio" value="onlyStyles"
          bind:group={selectOption} disabled={!hasStyles} />
        {$_('importdialog.import-only-styles-and-no-subtitles')}
      </label><br/>
    </ConfigRow>
    <ConfigRow name={$_('importdialog.position')}>
      <label>
        <input type="radio" disabled={selectOption == 'onlyStyles'} value="after" bind:group={posOption}/>
        {$_('importdialog.after-existing-lines')}
      </label><br/>
      <label>
        <input type="radio" disabled={selectOption == 'onlyStyles'} value="before" bind:group={posOption}/>
        {$_('importdialog.before-existing-lines')}
      </label><br/>
      <label>
        <input type="radio" disabled={selectOption == 'onlyStyles'} value="sortedBefore" bind:group={posOption}/>
        {$_('importdialog.sorted-before-existing-lines-if-time-points-are-equal')}
      </label><br/>
      <label>
        <input type="radio" disabled={selectOption == 'onlyStyles'} value="sortedAfter" bind:group={posOption}/>
        {$_('importdialog.sorted-after-existing-lines-if-time-points-are-equal')}
      </label><br/>
      <label>
        <input type="radio" disabled={selectOption == 'onlyStyles'} value="overwrite" bind:group={posOption}/>
        {$_('importdialog.overwrite-current-file')}
      </label><br/>
    </ConfigRow>
  </ConfigTable>
</DialogBase>

<style lang='scss'>
.duplicate:not([disabled]) {
  background-color: lightcoral;
}
</style>
