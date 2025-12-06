<script lang="ts">
import { Memorized } from '../config/MemorizedValue.svelte';
import Tooltip from '../ui/Tooltip.svelte';
import { guardAsync } from '../frontend/Frontend';
import { Reference, zReferenceSource, type ReferenceSource, type ReferenceString } from '../frontend/References';
import DialogBase from '../DialogBase.svelte';
import { Debug } from '../Debug';

import { ArrowDownIcon, ArrowUpIcon, CopyPlusIcon, PlusIcon, SquareAsteriskIcon, SquareFunctionIcon, Trash2Icon, XIcon } from '@lucide/svelte';
import { Menu } from '@tauri-apps/api/menu';
import { confirm, message, open, save } from '@tauri-apps/plugin-dialog';
import { readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';
import { onMount } from 'svelte';
import { _ } from 'svelte-i18n';
import * as z from 'zod/v4-mini';

interface Props {
  args: [],
  close: (ret: void) => void
}

let {
  args: _args, close
}: Props = $props();

let inner: DialogBase;

onMount(async () => {
  await inner.showModal!();
  await Memorized.save();
  close();
});

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

async function exportJSON() {
  const path = await save({filters: [{name: 'JSON', extensions: ['json']}]});
  if (path === null) return;
  const string = JSON.stringify($state.snapshot(activeSource));
  await guardAsync(async () => {
    await writeTextFile(path, string);
    await message($_('refsourcedialog.successfully-exported'), {kind: 'info'});
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
    await message($_('refsourcedialog.error-parsing-file'), {kind: 'error'});
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
  {#each r as component, i (component)}
    <span class="r">
      {#if typeof component == 'string'}
        <span class="text" contenteditable='plaintext-only'
          style='--placeholder: "{$_('refsourcedialog.placeholder')}"'
          bind:textContent={r[i] as string}
          oninput={() => update()}></span>
      {:else if component.type == 'keyword'}
        <span style="white-space: nowrap;">
          <SquareAsteriskIcon class='type' />
          <span class="keyword">{$_('refsourcedialog.keyword')}</span>
        </span>
      {:else if component.type == 'variable'}
        <span style="white-space: nowrap;">
          <SquareFunctionIcon class='type' />
          <select bind:value={vars[component.id]}>
          {#each vars as v (v)}
            <option value={v}>{v.name}</option>
          {/each}
          </select>
        </span>
      {/if}
      <button class="noborder" onclick={() => r.splice(i, 1)}>
        <XIcon />
      </button>
    </span>
  {/each}
  <button onclick={async () => {
    const menu = await Menu.new({items: [
      {
        text: $_('refsourcedialog.text'),
        action: () => r.push('')
      },
      {
        text: $_('refsourcedialog.keyword'),
        action: () => r.push({type: 'keyword'})
      },
      { item: 'Separator' },
      ...[...(vars.length == 0 ? [
        {
          text: $_('refsourcedialog.no-parameters-defined'),
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
        <PlusIcon />{$_('refsourcedialog.new-parameter')}
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

<DialogBase bind:this={inner} maxWidth="60em" buttons={[{
  name: 'ok',
  localizedName: () => $_('ok')
}]}>
  {#snippet header()}
    <h3>{$_('refsourcedialog.header')}</h3>
  {/snippet}
  <div class="hlayout" style="max-height: 60vh;">
    <div class="vlayout" style="height: auto">
      <div class="hlayout">
        <button class="flexgrow left"
          onclick={() => {
            let name: string;
            for (let i = 1; ; i++) {
              name = $_('refsourcedialog.new-source-n', {values: {n: i}});
              if (!$sources.find((x) => x.name == name)) break;
            }
            $sources.push({ name, url: [], variables: [], patchStyle: [] });
            sources.markChanged();
          }}>
          <PlusIcon />
        </button>
        <button class="flexgrow middle"
          disabled={selectedIndex < 0}
          onclick={() => {
            let name: string;
            for (let i = 1; ; i++) {
              name = $_('refsourcedialog.copy-of', {values: {name: activeSource[0].name}});
              if (!$sources.find((x) => x.name == name)) break;
            }
            $sources.push({
              ...$state.snapshot(activeSource[0]) as z.infer<typeof zReferenceSource>, 
              name
            });
            sources.markChanged();
          }}>
          <CopyPlusIcon />
        </button>
        <button class="flexgrow middle"
          disabled={selectedIndex <= 0}
          onclick={() => {
            $sources.splice(selectedIndex, 1);
            $sources.splice(selectedIndex - 1, 0, activeSource[0]);
            selectedIndex--;
            sources.markChanged();
          }}>
          <ArrowUpIcon />
        </button>
        <button class="flexgrow middle"
          disabled={selectedIndex < 0 || selectedIndex == $sources.length - 1}
          onclick={() => {
            $sources.splice(selectedIndex, 1);
            $sources.splice(selectedIndex + 1, 0, activeSource[0]);
            selectedIndex++;
            sources.markChanged();
          }}>
          <ArrowDownIcon />
        </button>
        <button class="flexgrow right"
          disabled={activeSource.length == 0}
          onclick={async () => {
            if (!await confirm($_('refsourcedialog.are-you-sure-to-delete-n-sources', 
              {values: {n: activeSource.length}}))) return;
            for (const s of activeSource) {
              $sources.splice($sources.findIndex((x) => x.name == s.name), 1);
            }
            sources.markChanged();
          }}>
          <Trash2Icon />
        </button>
      </div>
      <div class="hlayout">
        <button class="flexgrow left"
          onclick={async () => {
            if (!await confirm($_('refsourcedialog.confirm-reset'))) return;
            $sources = structuredClone(Reference.defaultSources);
            activeSource = [];
          }}>
          {$_('refsourcedialog.reset-all')}
        </button>
        <button class="flexgrow middle" onclick={() => importJSON()}>
          {$_('refsourcedialog.import')}
        </button>
        <button class="flexgrow right" onclick={() => exportJSON()}>
          {$_('refsourcedialog.export')}
        </button>
      </div>

      <select multiple style="width: 15em; min-height: 15em" class="flexgrow"
        bind:value={activeSource}
        onchange={() => load()}
      >
        {#each $sources as s (s)}
          <option value={s}>{s.name}</option>
        {/each}
      </select>
    </div>

    <div class="vlayout flexgrow settings">
    {#if activeSource.length == 1}
      <table class="config">
      <tbody>
        <tr>
          <td>{$_('refsourcedialog.name')}</td>
          <td><input type="text" bind:value={name}
            class={{invalid: !isNameUnique()}}
            onchange={() => update()}/></td>
        </tr>
        <tr>
          <td>{$_('refsourcedialog.parameters')}</td>
          <td class="grid">
            {#each vars as v, i (v)}
              {@render param(i)}
            {/each}
            {@render param()}
          </td>
        </tr>
        <tr>
          <td>
            {$_('refsourcedialog.url')}<Tooltip 
              text={$_('refsourcedialog.url-d')} />
          </td>
          <td>{@render rstring(url)}</td>
        </tr>
      </tbody>
      </table>
      <h5>
        {$_('refsourcedialog.display-options')}<Tooltip 
          text={$_('refsourcedialog.display-options-d')} />
      </h5>
      <label><input type='checkbox' bind:checked={useScrollTo}
        onchange={() => update()}/>{$_('refsourcedialog.use-auto-scroll')}</label>
      {#if useScrollTo}
      <div class="target">
        {@render rstring(scrollTo)}
      </div>
      {/if}
      <label><input type='checkbox' bind:checked={useSelector}
        onchange={() => update()}/>{$_('refsourcedialog.only-show-specified-element')}</label>
      {#if useSelector}
      <div class="target">
        {@render rstring(selector)}
      </div>
      {/if}
      <h5>{$_('refsourcedialog.css-patches')}<Tooltip 
        text={$_('refsourcedialog.css-patches-d')} /></h5>
      {#each patches as patch, i (patch)}
      <div class="patch">
        <div>
          {@render rstring(patch.selector)}
          <button onclick={() => patches.splice(i, 1)}>
            <Trash2Icon />
          </button>
        </div>
        <div class="vlayout patch2">
          {#each patch.patches as p, i (p)}
            <div class="hlayout">
              <input type="text" bind:value={patch.patches[i][0]}
                onchange={() => update()}/>
              <span>:</span>
              <input type="text" bind:value={patch.patches[i][1]} class="flexgrow" 
                onchange={() => update()}/>
              <button onclick={() => patch.patches.splice(i, 1)}>
                <Trash2Icon />
              </button>
            </div>
          {/each}
          <div>
            <button class="hlayout" onclick={() => patch.patches.push(['', ''])}>
              <PlusIcon />{$_('refsourcedialog.add-patch')}
            </button>
          </div>
        </div>
      </div>
      {/each}
      <div class="patch">
        <button class="hlayout" onclick={() => patches.push({selector: [], patches: []})}>
          <PlusIcon />{$_('refsourcedialog.add-selector')}
        </button>
      </div>
    {/if}
    </div>
  </div>
</DialogBase>

<style>
@media (prefers-color-scheme: light) {
  .r {
    background-color: var(--uchu-gray-2);
    & :global(.lucide.type) {
      color: var(--uchu-blue-5);
    }
  }
}

@media (prefers-color-scheme: dark) {
  .r {
    background-color: var(--uchu-yin-7);
    & :global(.lucide.type) {
      color: var(--uchu-blue-3);
    }
  }
}

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
    content: var(--placeholder);
    color: gray;
    word-break: normal;
    font-family: var(--fontFamily);
    font-style: italic;
  }
}
.r {
  font-size: 90%;
  vertical-align: text-bottom;
  padding: 3px 3px 3px 5px;
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
  & div {
    margin-top: 2px;
  }
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