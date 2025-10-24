<script lang="ts">
import * as dialog from "@tauri-apps/plugin-dialog";
import { ArrowDownToLineIcon, ArrowUpToLineIcon, Undo2Icon } from "@lucide/svelte";

import { SubtitleStyle, type SubtitleEntry } from '../core/Subtitles.svelte';
import { type LabelType } from "../core/Labels";
import { Debug } from "../Debug";
import DialogBase from '../DialogBase.svelte';
import type { DialogHandler } from '../frontend/Dialogs';
import { Editing } from '../frontend/Editing';

import { _ } from 'svelte-i18n';
import { ChangeType, Source } from "../frontend/Source";
import LabelSelect from "../LabelSelect.svelte";
import StyleSelect from "../StyleSelect.svelte";
import NumberInput from "../ui/NumberInput.svelte";
import Tooltip from "../ui/Tooltip.svelte";

interface Props {
  handler: DialogHandler<void, void>;
}
    
let {
  handler = $bindable(),
}: Props = $props();

let inner: DialogHandler<void> = {};
handler.showModal = async () => {
  Debug.assert(inner !== undefined);
  selection = Editing.getSelection();
  Debug.assert(selection.length > 0);
  if (selection.some((x) => x.texts.size > 1)) {
    await dialog.message($_('splitbylinedialog.error'));
    return;
  }
  makeData();
  check();
  selectedRow = -1;
  const btn = await inner.showModal!();
  if (btn !== 'ok') return;

  // work
  let newStyles = new Map<string, SubtitleStyle>();
  for (const ent of selection) {
    let lines = [...ent.texts.values()][0].split('\n');
    if (reversed)
      lines = lines.reverse();
    if (removeEmptyLines)
      lines = lines.filter((x) => x.trim().length > 0);
    ent.texts.clear();
    let dataIndex = 0;
    for (let i = 0; i < lines.length; i++) {
      if (data[dataIndex].rowIndex + data[dataIndex].span <= i)
        dataIndex++;
      const d = data[dataIndex];
      Debug.assert(d !== undefined, 'split data not found');

      let style: SubtitleStyle | undefined;
      switch (d.type) {
        case "use":
          Debug.assert(d.style !== undefined);
          style = d.style!;
          break;
        case "useNew":
          style = newStyles.get(d.styleName);
          if (!style) {
            Debug.assert(Source.subs.styles.every((x) => x.name !== d.styleName));
            
            style = SubtitleStyle.new(d.styleName);
            Source.subs.styles.push(style);
            style = Source.subs.styles.at(-1)!; // get reactive version
            newStyles.set(d.styleName, style);
          }
          break;
        default:
          Debug.never(d.type);
      }
      const existing = ent.texts.get(style);
      ent.texts.set(style, 
        existing === undefined
          ? lines[i]
          : reversed
            ? lines[i] + '\n' + existing
            : existing + '\n' + lines[i]);
    }
    if (markMoreThan.use && lines.length > markMoreThan.n)
      ent.label = markMoreThan.label;
    if (markLessThan.use && lines.length < markLessThan.n)
      ent.label = markLessThan.label;
  }
  Source.markChanged(
    newStyles.size > 0 ? ChangeType.General: ChangeType.InPlace,
    $_('c.split-by-line'));
}

function makeData() {
  for (let i = 0; i < usages.length; i++)
    usages[i] = 0;
  
  for (const ent of selection) {
    let lines = [...ent.texts.values()][0].split('\n');
    if (reversed)
      lines = lines.reverse();
    if (removeEmptyLines)
      lines = lines.filter((x) => x.trim().length > 0);
    for (let i = 0; i < lines.length; i++) {
      if (i >= usages.length)
        usages[i] = 1;
      else
        usages[i]++;
    }
  }
  usages = usages.filter((x) => x > 0);

  let i = 0;
  let newData: LineSplitData[] = [];
  for (let line of data) {
    newData.push(line);
    line.rowIndex = i;
    i += line.span;
    if (i > usages.length) {
      line.span = usages.length - line.rowIndex;
      break;
    }
  }
  while (i < usages.length) {
    newData.push({
      rowIndex: i,
      span: 1,
      ok: true,
      type: 'use',
      styleName: ''
    });
    i++;
  }
  data = newData;
  updateCounter++;
}

function makePreview() {
  previewLines = [];
  if (selectedRow < 0) return;

  for (const ent of selection) {
    let lines = [...ent.texts.values()][0].split('\n');
    if (reversed)
      lines = lines.reverse();
    if (removeEmptyLines)
      lines = lines.filter((x) => x.trim().length > 0);
    if (selectedRow < lines.length)
      previewLines.push(lines[selectedRow]);
  }
}

function check() {
  hasError = false;

  for (const d of data) {
    if (d.type == 'useNew' && 
        (!d.styleName 
      || Source.subs.styles.some((x) => x.name == d.styleName))) 
    {
      d.ok = false;
      hasError = true;
    } else
      d.ok = true;
  }

  for (let i = 0; i < data.length-1; i++) {
    for (let j = i+1; j < data.length; j++) {
      const a = data[i], b = data[j];
      if ((a.type == 'use' 
        && b.type == 'use' 
        && a.style == b.style)
       || (a.type == 'useNew' 
        && b.type == 'useNew' 
        && a.styleName == b.styleName))
      {
          a.ok = false;
          b.ok = false;
          hasError = true;
      }
    }
  }
}

function expandLineDown(lineIndex: number) {
  const line = data[lineIndex];
  line.span += 1;

  let newData: LineSplitData[] = data.slice(0, lineIndex + 1);
  for (let i = lineIndex + 1; i < data.length; i++) {
    const l = data[i];
    if (l.rowIndex + l.span <= line.rowIndex + line.span)
      continue;
    if (l.rowIndex < line.rowIndex + line.span) {
      l.span = l.rowIndex + l.span - line.rowIndex;
      l.rowIndex = line.rowIndex + line.span;
    }
    newData.push(l);
  }
  console.log($state.snapshot(newData));
  data = newData;
  updateCounter++;
}

function expandLineUp(lineIndex: number) {
  const line = data[lineIndex];
  line.rowIndex -= 1;
  line.span += 1;

  let newData: LineSplitData[] = [];
  for (let i = 0; i < lineIndex; i++) {
    const l = data[i];
    if (l.rowIndex >= line.rowIndex)
      continue;
    if (l.rowIndex + l.span > line.rowIndex) {
      l.span = l.rowIndex + l.span - line.rowIndex;
    }
    newData.push(l);
  }
  newData.push(...data.slice(lineIndex));
  console.log($state.snapshot(newData));
  data = newData;
  updateCounter++;
}

function resetLineSpan(lineIndex: number) {
  const line = data[lineIndex];

  let newData: LineSplitData[] = [];
  for (let i = line.rowIndex + 1; i < line.rowIndex + line.span; i++)
    newData.push({
      ok: true,
      rowIndex: i,
      span: 1,
      type: "use",
      styleName: ""
    });

  data.splice(lineIndex + 1, 0, ...newData);
  line.span = 1;
  updateCounter++;
}

type LineSplitData = {
  ok: boolean,
  rowIndex: number,
  span: number,

  // preserve data for UI
  type: 'useNew' | 'use',
  styleName: string,
  style?: SubtitleStyle,
};

let selection: SubtitleEntry[] = [];
let data: LineSplitData[] = $state([]);
let usages: number[] = $state([]);
let removeEmptyLines = $state(true);
let reversed = $state(false);
let selectedRow = $state(-1);
let previewLines: string[] = $state([]);
let markMoreThan = $state({use: false, n: 2, label: 'red' as LabelType});
let markLessThan = $state({use: false, n: 2, label: 'red' as LabelType});
let hasError = $state(true);

let updateCounter = $state(0);
</script>

<DialogBase handler={inner} maxWidth="48em"
  buttons={[{
    name: 'cancel',
    localizedName: () => $_('cancel')
  }, {
    name: 'ok', 
    localizedName: () => $_('ok'), 
    disabled: () => hasError
  }]}
>
  {#snippet header()}
  <h4>{$_('splitbylinedialog.header')}</h4>
  {/snippet}
  <div class="vlayout">
  <p>{$_('splitbylinedialog.explanation-0')}</p>
  <table class='data'>
    <thead>
      <tr>
        <th>{reversed 
          ? $_('splitbylinedialog.line-number-reversed')
          : $_('splitbylinedialog.line-number')}</th>
        <th>{$_('splitbylinedialog.usage')}</th>
        <th>{$_('splitbylinedialog.to-style')}</th>
        <th></th>
        <th style="width: 40px;"></th>
      </tr>
    </thead>
    <tbody>
    {#key updateCounter}
    {@const usagesOrdered = reversed ? usages.toReversed() : usages}
    {#each usagesOrdered as usage, i}
      {@const lineIndex = data.findIndex((x) => x.rowIndex == i)}
      {@const line = lineIndex < 0 ? undefined : data.at(lineIndex)}

      <tr onclick={() => {
            selectedRow = i;
            makePreview();
          }}>
        <td class={{right: true, focused: selectedRow == i}}>
          {reversed ? usagesOrdered.length - i : i + 1}
        </td>
        <td class={{focused: selectedRow == i}}>
          {usage}
        </td>
        {#if line !== undefined}
        <td class={{focused: selectedRow >= i && selectedRow < i + line.span}}
            rowspan={line.span}>
          <div class="hlayout center-items">
            <label>
              <input type='radio' value="use"
                bind:group={line.type}
                onchange={() => check()} />
              <StyleSelect disabled={line.type !== 'use'}
                bind:currentStyle={
                  () => line.style ?? Source.subs.defaultStyle, 
                  (x) => line.style = x}
                onsubmit={() => check()}/>
              &nbsp;
            </label>
            <label>
              <input type='radio' value="useNew"
                bind:group={line.type}
                onchange={() => check()} />
              {$_('splitbylinedialog.create-new')}&nbsp;
              <input type="text" disabled={line.type !== 'useNew'}
                bind:value={line.styleName}
                oninput={() => check()} />
            </label>
          </div>
        </td>
        <td class={{focused: selectedRow >= i && selectedRow < i + line.span}}
            rowspan={line.span}>
          <button disabled={i == 0}
            onclick={() => expandLineUp(lineIndex)}>
            <ArrowUpToLineIcon/>
          </button>
          <button disabled={i + line.span == usages.length}
            onclick={() => expandLineDown(lineIndex)}>
            <ArrowDownToLineIcon/>
          </button>
          <button disabled={line.span == 1}
            onclick={() => resetLineSpan(lineIndex)}>
            <Undo2Icon/>
          </button>
        </td>
        <td class={{focused: selectedRow >= i && selectedRow < i + line.span}}
            rowspan={line.span}>
          {#if !line.ok}
            <Tooltip text={line.type == 'use' 
                ? $_('splitbylinedialog.line-error')
                : $_('splitbylinedialog.line-error-use-new')
            } position="right">
              <span>⚠️</span>
            </Tooltip>
          {/if}
        </td>
        {/if}
      </tr>
    {/each}
    {/key}
    </tbody>
  </table>

  <div class="hlayout">
    <div class="settings">
      <h5>{$_('splitbylinedialog.settings')}</h5>
      <label>
        <input type='checkbox'
          bind:checked={removeEmptyLines}
          onchange={() => {makeData(); makePreview();}}/>
        {$_('splitbylinedialog.remove-empty-lines')}
      </label>
      <label>
        <input type='checkbox'
          bind:checked={reversed}
          onchange={() => {makeData(); makePreview();}}/>
        {$_('splitbylinedialog.reversed')}
      </label>
      <h5>{$_('splitbylinedialog.mark-those-entries')}</h5>
      <label class="hlayout center-items">
        <input type='checkbox'
          bind:checked={markMoreThan.use}/>
        {$_('splitbylinedialog.with-lines-more-than')}
        <NumberInput disabled={!markMoreThan.use}
          bind:value={markMoreThan.n} 
          min={0} step={1} width="50px"/>
        {$_('splitbylinedialog.as')}
        <LabelSelect disabled={!markMoreThan.use}
          bind:value={markMoreThan.label} />
      </label>
      <label class="hlayout center-items">
        <input type='checkbox'
          bind:checked={markLessThan.use}/>
        {$_('splitbylinedialog.fewer-than')}
        <NumberInput disabled={!markLessThan.use}
          bind:value={markLessThan.n} 
          min={0} step={1} width="50px"/>
        {$_('splitbylinedialog.as')}
        <LabelSelect disabled={!markLessThan.use}
          bind:value={markLessThan.label} />
      </label>
    </div>
    <div class="preview">
      <h5>{$_('splitbylinedialog.preview')}</h5>
      <ol tabindex="0" role="listbox">
        {#each previewLines as line}
          <li>{line}</li>
        {/each}
      </ol>
    </div>
  </div>
  </div>
</DialogBase>

<style>
  h4 {
    font-size: 100%;
    font-weight: bold;
    margin: 1em 0 0;
  }
  table {
    margin-right: 5px;
  }

  .settings {
    flex: 1 0;
    display: flex;
    flex-direction: column;
    padding-right: 5px;
  }
  .preview {
    max-width: 30em;
    flex: 1 0;
  }
</style>