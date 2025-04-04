<script lang="ts">
import * as dialog from "@tauri-apps/plugin-dialog";

import DialogBase from '../DialogBase.svelte';
import { assert, never } from '../Basic';
import type { DialogHandler } from '../frontend/Dialogs';
import { Editing } from '../frontend/Editing';
import { Subtitles, type LabelTypes, type SubtitleEntry, type SubtitleStyle } from '../core/Subtitles.svelte';

import { _ } from 'svelte-i18n';
import { ChangeType, Source } from "../frontend/Source";
import StyleSelect from "../StyleSelect.svelte";
import LabelSelect from "../LabelSelect.svelte";

interface Props {
  handler: DialogHandler<void, void>;
}
    
let {
  handler = $bindable(),
}: Props = $props();

let inner: DialogHandler<void> = {};
handler.showModal = async () => {
  assert(inner !== undefined);
  selection = Editing.getSelection();
  assert(selection.length > 0);
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
          assert(d.style !== undefined);
          style = d.style!;
          break;
        case "useNew":
          style = newStyles.get(d.styleName);
          if (!style) {
            assert(Source.subs.styles.every((x) => x.name !== d.styleName));
            // debugger;
            let n = $state(Subtitles.createStyle(d.styleName));
            style = Subtitles.createStyle(d.styleName);
            Source.subs.styles.push(style);
            style = Source.subs.styles.at(-1)!; // 
            newStyles.set(d.styleName, style);
          }
          break;
        default:
          never(d.type);
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
  <p>这个工具用于将SRT双语字幕等用换行表达语言切换的字幕转换为正确的格式。请先给每一行选择不重复的格式，在预览中确认基本无混杂：确保每一行都对应固定的语言或格式，例如不能出现某语言时而用两行、时而用一行的情况。如果这些情况过多，请考虑用正则表达式等方法先进行预处理。如果只有极少数地方出现例外，可以通过“根据行数标记”功能将这些非正常条目加上标签，以便校对。拆分完成后请前往属性页核对样式顺序、调整位置，以防出现错位。</p>
  <table>
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
        <td>{i + 1}</td>
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
  <p>在拆分之后，可以前往属性页对新添加的格式进行调整。</p>
  </div>
</DialogBase>

<style>
  h4 {
    font-size: 100%;
    font-weight: bold;
    margin: 1em 0 0;
  }
  th {
    background-color: var(--uchu-yin-1);
    border-collapse: collapse;
    border-spacing: 0;
    text-transform: uppercase;
    color: var(--uchu-yin-6);
    font-size: 85%;
  }
  tr.focused {
    background-color: var(--uchu-blue-1);
  }
  th, td {
    border: none;
    margin: 0;
    padding: 0 5px;
  }
  td:first-child {
    text-align: right;
  }
  table {
    margin-right: 5px;
  }

  @media (prefers-color-scheme: light) {
    ol[role='listbox'] {
      border: 1px solid var(--uchu-gray-4);
      background-color: white;
      color: var(--uchu-yin);
      &:focus {
        outline: 2px solid color-mix(in oklab, var(--uchu-blue-3), transparent);
      }
      &:disabled {
        background-color: var(--uchu-gray-1);
        color: var(--uchu-gray-9);
      }
      & li {
        border-bottom: 1px solid var(--uchu-gray-1);
      }
    }
  }

  @media (prefers-color-scheme: dark) {

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

  ol {
    display: flex;
    flex-direction: column;
    width: 25em;
    height: 200px;
    white-space: normal;
    overflow-y: auto;

    padding: 3px 0;
    margin: 1px;
    border-radius: 3px;
    list-style: none;
  }

  ol[role='listbox'] li {
    width: auto;
    display: block;
    font-family: var(--fontFamily);
    font-size: 0.85rem;
    line-height: 1.3;
    padding: 3px 6px;
    user-select: auto;
    -webkit-user-select: auto;
  }
</style>