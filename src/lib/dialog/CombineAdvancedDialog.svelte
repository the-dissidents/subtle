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
import { Editing } from '$lib/frontend/Editing';

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
  const entries = selectionOnly ? Editing.getSelection() : Source.subs.entries;

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

async function apply() {
  Debug.assert(!!data);

  const { as, bs, conflict, result } = data;
  for (const [i, j] of result.matches) {
    if (conflict.has(as[i]) || conflict.has(bs[j])) continue;
    as[i].texts.forEach((v, k) => bs[j].texts.set(k, v));
    Source.subs.removeEntry(as[i]);
  }

  for (const [is, j] of result.merges) {
    is.forEach((i) => as[i].label = mergeSplitLabel);
    bs[j].label = mergeSplitLabel;
  }
  for (const [i, js] of result.splits) {
    const times = js.flatMap((j) => [bs[j].start, bs[j].end]);
    as[i].label = mergeSplitLabel;
    as[i].start = Math.min(...times);
    as[i].end = Math.max(...times);
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
  inner.close('ok');
}

</script>

<DialogBase bind:this={inner} buttons={[{
  name: 'ok',
  localizedName: () => $_('back')
}]}>
  <h5>DTW算法参数</h5>
  <ConfigTable>
    <ConfigRow name="起始时间差权重">
      <NumberInput min='0' step="0.01"
        bind:value={$opts.weightOnset}
        onchange={() => opts.markChanged()} />
    </ConfigRow>
    <ConfigRow name="结束时间差权重">
      <NumberInput min='0' step="0.01"
        bind:value={$opts.weightEnd}
        onchange={() => opts.markChanged()} />
    </ConfigRow>
    <ConfigRow name="跳过条目权重">
      <NumberInput min='0' step="0.01"
        bind:value={$opts.penaltySkip}
        onchange={() => opts.markChanged()} />
    </ConfigRow>
    <ConfigRow name="合并条目权重">
      <NumberInput min='0' step="0.01"
        bind:value={$opts.penaltyMerge}
        onchange={() => opts.markChanged()} />
    </ConfigRow>
    <ConfigRow name="切分条目权重">
      <NumberInput min='0' step="0.01"
        bind:value={$opts.penaltySplit}
        onchange={() => opts.markChanged()} />
    </ConfigRow>
    <ConfigRow name="忽略起始时间差大于此的条目">
      <NumberInput min='0' step="1"
        bind:value={$opts.windowMs}
        onchange={() => opts.markChanged()} />
      毫秒
    </ConfigRow>
  </ConfigTable>

  <h5>设置</h5>
  <ConfigTable>
    <ConfigRow name="匹配对象（时间轴错误）">
      <StyleSelect bind:currentStyle={fromChannel} onsubmit={() => clear()}/>
    </ConfigRow>
    <ConfigRow name="匹配目标（时间轴正确）">
      <StyleSelect bind:currentStyle={toChannel} onsubmit={() => clear()} />
    </ConfigRow>
    <ConfigRow name={$_('combinedialog.selection-only')}>
      <input type="checkbox" bind:checked={selectionOnly} onsubmit={() => clear()} />
    </ConfigRow>
  </ConfigTable>

  <h5>将有问题的条目带上标记</h5>
  <ConfigTable>
    <ConfigRow name="无对应的条目">
      <LabelSelect
        bind:value={unmappedLabel} onsubmit={() => clear()} />
    </ConfigRow>
    <ConfigRow name="切分或合并的条目">
      <LabelSelect
        bind:value={mergeSplitLabel} onsubmit={() => clear()} />
    </ConfigRow>
    <ConfigRow name="已经包含此两种样式的条目">
      <LabelSelect
        bind:value={ignoredLabel} onsubmit={() => clear()} />
    </ConfigRow>
  </ConfigTable>

  <progress class="wide" value={progress}></progress>
  <button class="wide" onclick={() => run()}>{$_('combineadvdialog.compute')}</button>

  {#if data}
  <h5>计算结果</h5>
  <ConfigTable>
    <ConfigRow name="找到对应条目组数">
      {data.result.matches.length}
    </ConfigRow>
    <ConfigRow name="切分条目数">
      {data.result.splits.length}
    </ConfigRow>
    <ConfigRow name="合并条目数">
      {data.result.merges.length}
    </ConfigRow>
    <ConfigRow name="{fromChannel.name} 中未匹配条目数">
      {data.result.unmappedA.length}
    </ConfigRow>
    <ConfigRow name="{toChannel.name} 中未匹配条目数">
      {data.result.unmappedB.length}
    </ConfigRow>
    <ConfigRow name="样式冲突导致未合并的条目数">
      {data.conflict.size}
    </ConfigRow>
  </ConfigTable>
  <button class="wide" onclick={() => apply()}>
    {$_('combineadvdialog.apply')}
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
