<script lang="ts">
import * as dialog from "@tauri-apps/plugin-dialog";

import { Subtitles, type LabelTypes, type SubtitleEntry, type SubtitleStyle } from '../core/Subtitles.svelte';
import { Debug } from "../Debug";
import DialogBase from '../DialogBase.svelte';
import type { DialogHandler } from '../frontend/Dialogs';
import { Editing } from '../frontend/Editing';

import { _ } from 'svelte-i18n';
import { ChangeType, Source } from "../frontend/Source";
import LabelSelect from "../LabelSelect.svelte";
import StyleSelect from "../StyleSelect.svelte";

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
    if (removeEmptyLines)
      lines = lines.filter((x) => x.trim().length > 0);
    ent.texts.clear();
    for (let i = 0; i < lines.length; i++) {
      const d = data[i];
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
            // debugger;
            let n = $state(Subtitles.createStyle(d.styleName));
            style = Subtitles.createStyle(d.styleName);
            Source.subs.styles.push(style);
            style = Source.subs.styles.at(-1)!; // 
            newStyles.set(d.styleName, style);
          }
          break;
        default:
          Debug.never(d.type);
      }
      ent.texts.set(style, lines[i]);
    }
    if (markMoreThan.use && lines.length > markMoreThan.n)
      ent.label = markMoreThan.label;
    if (markLessThan.use && lines.length < markLessThan.n)
      ent.label = markLessThan.label;
  }
  Source.markChanged(newStyles.size > 0 ? ChangeType.General: ChangeType.InPlace);
}

function makeData() {
  for (const d of data)
    d.usage = 0;
  
  for (const ent of selection) {
    let lines = [...ent.texts.values()][0].split('\n');
    if (removeEmptyLines)
      lines = lines.filter((x) => x.trim().length > 0);
    for (let i = 0; i < lines.length; i++) {
      if (i >= data.length)
        data[i] = { 
          usage: 1, type: 'use', 
          style: Source.subs.defaultStyle, 
          styleName: '', 
          ok: false
        };
      else
        data[i].usage++;
    }
  }
  data = data.filter((x) => x.usage > 0);
}

function makePreview() {
  previewLines = [];
  if (selectedRow < 0) return;

  for (const ent of selection) {
    let lines = [...ent.texts.values()][0].split('\n');
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
      if ((data[i].type == 'use' 
        && data[j].type == 'use' 
        && data[i].style == data[j].style)
       || (data[i].type == 'useNew' 
        && data[j].type == 'useNew' 
        && data[i].styleName == data[j].styleName))
      {
          data[i].ok = false;
          data[j].ok = false;
          hasError = true;
      }
    }
  }
}

type LineSplitData = {
  usage: number,
  type: 'use' | 'useNew',
  style?: SubtitleStyle,
  styleName: string,
  ok: boolean
};

let selection: SubtitleEntry[] = [];
let data: LineSplitData[] = $state([]);
let removeEmptyLines = $state(true);
let selectedRow = $state(-1);
let previewLines: string[] = $state([]);
let markMoreThan = $state({use: false, n: 2, label: 'red' as LabelTypes});
let markLessThan = $state({use: false, n: 2, label: 'red' as LabelTypes});
let hasError = $state(true);

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
        <th>{$_('splitbylinedialog.line-number')}</th>
        <th>{$_('splitbylinedialog.usage')}</th>
        <th>{$_('splitbylinedialog.to-style')}</th>
        <th style="width: 40px;"></th>
      </tr>
    </thead>
    <tbody>
    {#each data as line, i}
      <tr class={{focused: selectedRow == i}} 
          onclick={() => {
            selectedRow = i;
            makePreview();
          }}>
        <td class="right">{i + 1}</td>
        <td>{line.usage}</td>
        <td class="hlayout center-items">
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
        </td>
        <td>
          {#if !line.ok}⚠️{/if}
        </td>
      </tr>
    {/each}
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
      <h5>{$_('splitbylinedialog.mark-those-entries')}</h5>
      <label class="hlayout center-items">
        <input type='checkbox'
          bind:checked={markMoreThan.use}/>
        {$_('splitbylinedialog.with-lines-more-than')}
        <input type="number" disabled={!markMoreThan.use}
          value={markMoreThan.n} 
          min={0} step={1}
          onchange={async (ev) => {
            if (ev.currentTarget.validity.valid)
              markMoreThan.n = ev.currentTarget.valueAsNumber;
            else
              ev.currentTarget.value = markMoreThan.n.toString();
          }}/>
        {$_('splitbylinedialog.as')}
        <LabelSelect disabled={!markMoreThan.use}
          bind:value={markMoreThan.label} />
      </label>
      <label class="hlayout center-items">
        <input type='checkbox'
          bind:checked={markLessThan.use}/>
        {$_('splitbylinedialog.fewer-than')}
        <input type="number" disabled={!markLessThan.use}
          value={markLessThan.n}
          min={0} step={1}
          onchange={async (ev) => {
            if (ev.currentTarget.validity.valid)
              markLessThan.n = ev.currentTarget.valueAsNumber;
            else
              ev.currentTarget.value = markLessThan.n.toString();
          }}/>
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

  input[type='number'] {
    width: 50px;
  }

</style>