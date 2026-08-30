<script lang="ts">
import { SubtitleEntry, SubtitleStyle } from '../core/Subtitles.svelte';
import { type LabelType } from "../core/Labels";
import { ChangeType, Source } from '../frontend/Source';

import DialogBase from '../DialogBase.svelte';
import LabelSelect from '../LabelSelect.svelte';
import { ConfigRow, ConfigTable, NumberInput } from '@the_dissidents/svelte-ui';

import { _ } from 'svelte-i18n';
import { onMount } from 'svelte';
import { type AlignmentResult, alignSubtitles, DefaultAlignmentOptions, ZAlignmentOptions } from '$lib/details/Align';
import { Memorized } from '$lib/config/MemorizedValue.svelte';
import { Debug } from '$lib/Debug';
import StyleSelect from '$lib/StyleSelect.svelte';
import { Selection } from '$lib/frontend/Editing';

interface Props {
  args: [],
  close: (ret: void) => void
}

let {
  args: _args, close
}: Props = $props();

let inner: DialogBase;

let opts = Memorized.$('aligmentOptions', ZAlignmentOptions, DefaultAlignmentOptions);

let data = $state<{
  result: AlignmentResult,
  conflict: Set<SubtitleEntry>,
  as: SubtitleEntry[], bs: SubtitleEntry[]
}>();

let selectionOnly = $state(false),
    fromChannel = $state<SubtitleStyle>(Source.subs.styles[0]),
    toChannel = $state<SubtitleStyle>(Source.subs.styles[0]),
    mergeSplitLabel = $state('red' as LabelType),
    unmappedLabel = $state('red' as LabelType),
    ignoredLabel = $state('purple' as LabelType),
    progress = $state(0);

onMount(async () => {
  await inner.showModal!();
  close();
});

function clear() {
  data = undefined;
  progress = 0;
}

function prepare() {
  Debug.assert(!!fromChannel && !!toChannel);

  const as: SubtitleEntry[] = [];
  const bs: SubtitleEntry[] = [];
  const both: SubtitleEntry[] = [];
  const entries = selectionOnly ? Selection.entries : Source.subs.entries;

  for (const ent of entries) {
    const hasA = ent.texts.has(fromChannel);
    const hasB = ent.texts.has(toChannel);

    if (hasA && hasB) both.push(ent);
    else if (hasA) as.push(ent);
    else if (hasB) bs.push(ent);
  }
  return { as, bs, both };
}

async function run() {
  clear();
  const { as, bs, both } = prepare();
  const result = await alignSubtitles(as, bs, $opts, (p) => progress = p);
  const match: [SubtitleEntry, SubtitleEntry][] = [];
  for (const [i, j] of result.matches) {
    if ([...as[i].texts.keys()].find((x) => bs[j].texts.has(x))) {
      both.push(as[i], bs[j]);
      continue;
    }
    match.push([as[i], bs[j]]);
  }
  data = { result, conflict: new Set(both), as, bs };
  console.log(data);
}

async function apply(modify: boolean) {
  Debug.assert(!!data);

  const { as, bs, conflict, result } = data;

  if (modify) {
    for (const [i, j] of result.matches) {
      if (conflict.has(as[i]) || conflict.has(bs[j])) continue;
      as[i].texts.forEach((v, k) => bs[j].texts.set(k, v));
      Source.subs.removeEntry(as[i]);
    }
  }

  for (const [is, j] of result.merges) {
    is.forEach((i) => as[i].label = mergeSplitLabel);
    bs[j].label = mergeSplitLabel;
  }
  for (const [i, js] of result.splits) {
    const times = js.flatMap((j) => [bs[j].start, bs[j].end]);
    as[i].label = mergeSplitLabel;
    if (modify) {
      as[i].start = Math.min(...times);
      as[i].end = Math.max(...times);
    }
    js.forEach((j) => bs[j].label = mergeSplitLabel);
  }

  for (const i of result.unmappedA) {
    as[i].label = unmappedLabel;
  }
  for (const i of result.unmappedB) {
    bs[i].label = unmappedLabel;
  }
  for (const ent of conflict) {
    ent.label = ignoredLabel;
  }

  await Source.markChanged(ChangeType.Times, $_('c.combine-dtw'));
  if (modify) inner.close('ok');
}

</script>

<DialogBase bind:this={inner} buttons={[{
  name: 'ok',
  localizedName: () => $_('back')
}]}>
  <h5>{$_('combineadvdialog.dtw-parameters')}</h5>
  <ConfigTable>
    <ConfigRow name={$_('combineadvdialog.weight-onset')}>
      <NumberInput min='0' step="0.01"
        bind:value={$opts.weightOnset}
        onchange={() => opts.markChanged()} />
    </ConfigRow>
    <ConfigRow name={$_('combineadvdialog.weight-end')}>
      <NumberInput min='0' step="0.01"
        bind:value={$opts.weightEnd}
        onchange={() => opts.markChanged()} />
    </ConfigRow>
    <ConfigRow name={$_('combineadvdialog.penalty-skip')}>
      <NumberInput min='0' step="0.01"
        bind:value={$opts.penaltySkip}
        onchange={() => opts.markChanged()} />
    </ConfigRow>
    <ConfigRow name={$_('combineadvdialog.penalty-merge')}>
      <NumberInput min='0' step="0.01"
        bind:value={$opts.penaltyMerge}
        onchange={() => opts.markChanged()} />
    </ConfigRow>
    <ConfigRow name={$_('combineadvdialog.penalty-split')}>
      <NumberInput min='0' step="0.01"
        bind:value={$opts.penaltySplit}
        onchange={() => opts.markChanged()} />
    </ConfigRow>
    <ConfigRow name={$_('combineadvdialog.window-ms')}>
      <NumberInput min='0' step="1"
        bind:value={$opts.windowMs}
        onchange={() => opts.markChanged()} />
      {$_('combineadvdialog.ms')}
    </ConfigRow>
  </ConfigTable>

  <h5>{$_('combineadvdialog.settings')}</h5>
  <ConfigTable>
    <ConfigRow name={$_('combineadvdialog.from-channel')}>
      <StyleSelect bind:currentStyle={fromChannel} onsubmit={() => clear()}/>
    </ConfigRow>
    <ConfigRow name={$_('combineadvdialog.to-channel')}>
      <StyleSelect bind:currentStyle={toChannel} onsubmit={() => clear()} />
    </ConfigRow>
    <ConfigRow name={$_('combinedialog.selection-only')}>
      <input type="checkbox" bind:checked={selectionOnly} onsubmit={() => clear()} />
    </ConfigRow>
  </ConfigTable>

  <h5>{$_('combineadvdialog.label-problematic')}</h5>
  <ConfigTable>
    <ConfigRow name={$_('combineadvdialog.unmapped-entries')}>
      <LabelSelect
        bind:value={unmappedLabel} onsubmit={() => clear()} />
    </ConfigRow>
    <ConfigRow name={$_('combineadvdialog.merge-or-split-entries')}>
      <LabelSelect
        bind:value={mergeSplitLabel} onsubmit={() => clear()} />
    </ConfigRow>
    <ConfigRow name={$_('combineadvdialog.entries-with-both-styles')}>
      <LabelSelect
        bind:value={ignoredLabel} onsubmit={() => clear()} />
    </ConfigRow>
  </ConfigTable>

  <progress class="wide" value={progress}></progress>
  <button class="wide" onclick={() => run()}>{$_('combineadvdialog.compute')}</button>

  {#if data}
  <h5>{$_('combineadvdialog.results')}</h5>
  <ConfigTable>
    <ConfigRow name={$_('combineadvdialog.matched-groups')}>
      {data.result.matches.length}
    </ConfigRow>
    <ConfigRow name={$_('combineadvdialog.split-count')}>
      {data.result.splits.length}
    </ConfigRow>
    <ConfigRow name={$_('combineadvdialog.merge-count')}>
      {data.result.merges.length}
    </ConfigRow>
    <ConfigRow name={$_('combineadvdialog.unmapped-count', {values: {name: fromChannel.name}})}>
      {data.result.unmappedA.length}
    </ConfigRow>
    <ConfigRow name={$_('combineadvdialog.unmapped-count', {values: {name: toChannel.name}})}>
      {data.result.unmappedB.length}
    </ConfigRow>
    <ConfigRow name={$_('combineadvdialog.conflict-count')}>
      {data.conflict.size}
    </ConfigRow>
  </ConfigTable>
  <button class="wide" onclick={() => apply(true)}>
    {$_('combineadvdialog.apply')}
  </button>
  <button class="wide" onclick={() => apply(false)}>
    {$_('combineadvdialog.mark-only')}
  </button>
  {/if}
</DialogBase>

<style lang='scss'>
  h5 {
    font-size: 0.9rem;
  }

  .wide {
    width: 100%;
  }
</style>
