<script lang="ts">
import DialogBase from '../DialogBase.svelte';
import { Debug } from '../Debug';
import { Memorized } from '../config/MemorizedValue.svelte';
import Tooltip from '../ui/Tooltip.svelte';
import { DialogHandler } from '../frontend/Dialogs';
import { guardAsync } from '../frontend/Frontend';
import { Reference, zReferenceSource, type ReferenceSource, type ReferenceString } from '../frontend/References';

import { ArrowDownIcon, ArrowUpIcon, CopyPlusIcon, PlusIcon, SquareAsteriskIcon, SquareFunctionIcon, Trash2Icon, XIcon } from '@lucide/svelte';
import { Menu } from '@tauri-apps/api/menu';
import { confirm, message, open, save } from '@tauri-apps/plugin-dialog';
import { readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';
import { _ } from 'svelte-i18n';
import * as z from 'zod/v4-mini';

interface Props {
  handler: DialogHandler<void, void>;
}
    
let {
  handler = $bindable(),
}: Props = $props();

let sources = Reference.sources;
let activeSource = $state<ReferenceSource[]>([]);
let selectedIndex = $state(-1);

let name = $state('');
let url = $state<ReferenceString>();
let vars = $state<ReferenceSource['variables']>([]);

let useScrollTo = $state(false);
let scrollTo = $state<ReferenceString>();

let useSelector = $state(false);
let selector = $state<ReferenceString>();

let patches = $state<ReferenceSource['patchStyle']>([]);

function load() {
  if (activeSource.length !== 1) {
    selectedIndex = -1;
    return;
  }
  selectedIndex = $sources.findIndex((x) => x.name == activeSource[0].name);
  Debug.assert(selectedIndex >= 0);
  name = activeSource[0].name;
  url = activeSource[0].url;
  vars = activeSource[0].variables;
  patches = activeSource[0].patchStyle;
  useScrollTo = activeSource[0].scrollTo !== undefined;
  scrollTo = activeSource[0].scrollTo ?? [];
  useSelector = activeSource[0].selector !== undefined;
  selector = activeSource[0].selector ?? [];
}

function isNameUnique() {
  return $sources
    .find((x) => x.name !== activeSource[0].name && x.name == name) === undefined;
}

async function update() {
  if (activeSource.length !== 1) return;
  if (isNameUnique())
    activeSource[0].name = name;
  Debug.assert(url !== undefined);
  activeSource[0].url = url;
  activeSource[0].variables = vars;
  activeSource[0].patchStyle = patches;

  if (!useScrollTo) activeSource[0].scrollTo = undefined;
  else activeSource[0].scrollTo = scrollTo;

  if (!useSelector) activeSource[0].selector = undefined;
  else activeSource[0].selector = selector;
  
  sources.markChanged();
}

let inner = new DialogHandler<void>();
handler.showModal = async () => {
  Debug.assert(inner !== undefined);
  await inner.showModal!();
  await Memorized.save();
  return;
}

async function exportJSON() {
  const path = await save({filters: [{name: 'JSON', extensions: ['json']}]});
  if (path === null) return;
  const string = JSON.stringify($state.snapshot(activeSource));
  await guardAsync(async () => {
    await writeTextFile(path, string);
  }, $_('msg.error-when-writing-to-file', {values: {file: path}}));
}

async function importJSON() {
  const path = await open({filters: [{name: 'JSON', extensions: ['json']}]});
  if (path === null) return;
  let string: string | undefined;
  await guardAsync(async () => {
    string = await readTextFile(path);
  }, $_('msg.unable-to-read-file-path', {values: {path}}));
  if (!string) return;
  const result = z.array(zReferenceSource).safeParse(JSON.parse(string));
  if (!result.success)
    await message('解析文件时遇到错误', {kind: 'error'});
  else {
    if (result.data.length == 0) return;
    for (const s of result.data) {
      if ($sources.find((x) => x.name == s.name)) {
        let name: string;
        for (let i = 1; ; i++) {
          name = s.name + ` (${i})`;
          if (!$sources.find((x) => x.name == name)) break;
        }
        s.name = name;
      }
      $sources.push(s);
    }
    sources.markChanged();
  }
}
</script>

{#snippet rstring(r?: ReferenceString)}
{#if r}
  {#each r as component, i}
    <span class="r">
      {#if typeof component == 'string'}
        <span class="text" contenteditable='plaintext-only' bind:textContent={r[i] as string}
          oninput={() => update()}></span>
      {:else if component.type == 'keyword'}
        <SquareAsteriskIcon class='type' />
        <span class="keyword">关键词</span>
      {:else if component.type == 'variable'}
        <SquareFunctionIcon class='type' />
        <select bind:value={vars[component.id]}>
        {#each vars as v}
          <option value={v}>{v.name}</option>
        {/each}
        </select>
      {/if}
      <button class="noborder" onclick={() => r.splice(i, 1)}>
        <XIcon />
      </button>
    </span>
  {/each}
  <button onclick={async () => {
    const menu = await Menu.new({items: [
      {
        text: '文本',
        action: () => r.push('')
      },
      {
        text: '关键词',
        action: () => r.push({type: 'keyword'})
      },
      { item: 'Separator' },
      ...[...(vars.length == 0 ? [
        {
          text: '没有参数',
          enabled: false
        }
      ] : vars.map((x, i) => ({
        text: x.name,
        action: () => r.push({type: 'variable', id: i})
      })))]
    ]});
    await menu.popup();
  }}>
    <PlusIcon />
  </button>
{/if}
{/snippet}

{#snippet param(n?: number)}
  {#if n === undefined}
    <div>
      <button class="hlayout" onclick={() => vars.push({ name: 'new', defaultValue: '' })}>
        <PlusIcon />添加参数
      </button>
    </div>
  {:else}
    <div>
      <span class="r">
        <SquareFunctionIcon class='type' />
        <span class="variable" contenteditable="true" bind:textContent={vars[n].name}
          oninput={() => update()}></span>
      </span>
    </div>
    <div style="margin: 0 5px;">=</div>
    <div class="hlayout">
      <input type="text" bind:value={vars[n].defaultValue} class="flexgrow" />
      <button onclick={() => vars.splice(n, 1)}>
        <XIcon />
      </button>
    </div>
  {/if}
{/snippet}

<DialogBase handler={inner} maxWidth="60em" buttons={[{
  name: 'ok',
  localizedName: () => $_('ok')
}]}>
  {#snippet header()}
    <h3>编辑参考资料</h3>
  {/snippet}
  <div class="hlayout" style="max-height: 60vh;">
    <div class="vlayout" style="height: auto">
      <div class="hlayout">
        <button class="flexgrow"
          onclick={() => {
            let name: string;
            for (let i = 1; ; i++) {
              name = `新参考资料 (${i})`;
              if (!$sources.find((x) => x.name == name)) break;
            }
            $sources.push({ name, url: [], variables: [], patchStyle: [] });
            sources.markChanged();
          }}>
          <PlusIcon />
        </button>
        <button class="flexgrow"
          disabled={selectedIndex < 0}
          onclick={() => {
            let name: string;
            for (let i = 1; ; i++) {
              name = `${activeSource[0].name} 副本`;
              if (!$sources.find((x) => x.name == name)) break;
            }
            $sources.push({...$state.snapshot(activeSource[0]) as any, name});
            sources.markChanged();
          }}>
          <CopyPlusIcon />
        </button>
        <button class="flexgrow"
          disabled={selectedIndex <= 0}
          onclick={() => {
            $sources.splice(selectedIndex, 1);
            $sources.splice(selectedIndex - 1, 0, activeSource[0]);
            selectedIndex--;
            sources.markChanged();
          }}>
          <ArrowUpIcon />
        </button>
        <button class="flexgrow"
          disabled={selectedIndex < 0 || selectedIndex == $sources.length - 1}
          onclick={() => {
            $sources.splice(selectedIndex, 1);
            $sources.splice(selectedIndex + 1, 0, activeSource[0]);
            selectedIndex++;
            sources.markChanged();
          }}>
          <ArrowDownIcon />
        </button>
        <button class="flexgrow"
          disabled={activeSource.length == 0}
          onclick={async () => {
            if (!await confirm('确认删除？')) return;
            for (const s of activeSource) {
              $sources.splice($sources.findIndex((x) => x.name == s.name), 1);
            }
            sources.markChanged();
          }}>
          <Trash2Icon />
        </button>
      </div>
      <div class="hlayout">
        <button class="flexgrow"
          onclick={async () => {
            if (!await confirm('确认重置所有参考资料来源？')) return;
            $sources = structuredClone(Reference.defaultSources);
            activeSource = [];
          }}>
          全部重置
        </button>
        <button class="flexgrow" onclick={() => importJSON()}>
          导入
        </button>
        <button class="flexgrow" onclick={() => exportJSON()}>
          导出
        </button>
      </div>

      <select multiple style="width: 15em; min-height: 15em" class="flexgrow"
        bind:value={activeSource}
        onchange={() => load()}
      >
        {#each $sources as s}
          <option value={s}>{s.name}</option>
        {/each}
      </select>
    </div>

    <div class="vlayout flexgrow settings">
    {#if activeSource.length == 1}
      <table class="config">
      <tbody>
        <tr>
          <td>名称</td>
          <td><input type="text" bind:value={name}
            class={{invalid: !isNameUnique()}}
            onchange={() => update()}/></td>
        </tr>
        <tr>
          <td>参数</td>
          <td class="grid">
            {#each vars as _, i}
              {@render param(i)}
            {/each}
            {@render param()}
          </td>
        </tr>
        <tr>
          <td>
            地址<Tooltip text={'不支持锚点（如#English）。若要达到自动定位的效果，请选中“使用自动滚动”'} />
          </td>
          <td>{@render rstring(url)}</td>
        </tr>
      </tbody>
      </table>
      <h5>
        显示<Tooltip text={"如果启用以下选项，应填写有效的CSS选择器"} />
      </h5>
      <label><input type='checkbox' bind:checked={useScrollTo}
        onchange={() => update()}/>使用自动滚动</label>
      {#if useScrollTo}
      <div class="target">
        {@render rstring(scrollTo)}
      </div>
      {/if}
      <label><input type='checkbox' bind:checked={useSelector}
        onchange={() => update()}/>仅显示特定元素</label>
      {#if useSelector}
      <div class="target">
        {@render rstring(selector)}
      </div>
      {/if}
      <h5>样式表修正<Tooltip text={"应填写一系列有效的CSS选择器，每一个选择器下可带有多条CSS样式，它们将会覆盖原网页的样式"} /></h5>
      {#each patches as patch}
      <div class="patch">
        <div class="patch1">{@render rstring(patch.selector)}</div>
        <div class="vlayout patch2">
          {#each patch.patches as [k, v], i}
            <div class="hlayout">
              <input type="text" value={patch.patches[i][0]}
                onchange={(x) => patch.patches[i][0] = x.currentTarget.value}/>
              <span>:</span>
              <input type="text" value={patch.patches[i][1]} class="flexgrow" 
                onchange={(x) => patch.patches[i][1] = x.currentTarget.value}/>
              <button onclick={() => patch.patches.splice(i, 1)}>
                <XIcon />
              </button>
            </div>
          {/each}
          <div>
            <button class="hlayout" onclick={() => patch.patches.push(['', ''])}>
              <PlusIcon />添加修正项
            </button>
          </div>
        </div>
      </div>
      {/each}
      <div class="patch">
        <button class="hlayout" onclick={() => patches.push({selector: [], patches: []})}>
          <PlusIcon />添加选择器
        </button>
      </div>
    {/if}
    </div>
  </div>
</DialogBase>

<style>
tr {
  padding: 3px 0;
}
.settings {
  width: 30em;
  margin-left: 10px;
  margin-right: 2px;
  height: auto;
  overflow-y: auto;
}
.invalid {
  background-color: var(--uchu-red-2);
}
.grid {
  display: grid;
  grid-template-columns: max-content max-content 1fr;
}
label {
  /* font-size: 100%; */
  margin: 5px;
}
.target {
  padding-left: 3em;
}
*[contenteditable] {
  /* outline: none; */
  cursor: text;
  &:empty::before {
    content: "请输入";
    color: gray;
  }
}
.r {
  font-size: 90%;
  background-color: var(--uchu-gray-2);
  vertical-align: baseline;
  padding: 3px;
  margin: 0 5px 0 0;
  border-radius: 5px;
  line-height: 1.5;
  & * {
    width: auto;
  }
  & :global(.lucide.type) {
    display: inline-block;
    vertical-align: text-bottom;
    height: 1.2em;
    stroke-width: 1.5px;
    color: var(--uchu-blue-5);
    margin: 0;
  }
  & .text {
    word-break: break-all;
    font-family: var(--monospaceFontFamily);
  }
  & select {
    display: inline-block;
    background-color: transparent;
    border: none;
  }
  & button {
    box-shadow: none;
    padding: 0;
    margin: 0;
    vertical-align: text-top;
  }
}
.patch {
  padding: 5px;
}
.patch2 {
  padding-left: 3em;
  & span {
    font-family: var(--monospaceFontFamily);
    font-size: 85%;
    padding: 0 5px;
  }
  & input {
    font-family: var(--monospaceFontFamily);
  }
}
</style>