<script lang="ts">
import { onDestroy, onMount } from "svelte";
import { _, locale } from 'svelte-i18n';
import { get } from 'svelte/store';
import { Debug } from "../../Debug";

import { Actions } from "../../frontend/Actions";
import { Editing } from "../../frontend/Editing";
import { EventHost } from "../../details/EventHost";
import { Interface } from "../../frontend/Interface";
import { Playback } from "../../frontend/Playback";

import { Metrics, Metric, type MetricContext } from "../../core/Filter";
import Popup, { type PopupHandler } from "../../ui/Popup.svelte";
import OrderableList from "../../ui/OrderableList.svelte";

import { Menu } from "@tauri-apps/api/menu";
import { DeleteIcon, PenLineIcon, PlusIcon } from "@lucide/svelte";

import { TableLayout, type Column } from "./Layout.svelte";
import { TableRenderer } from "./Render.svelte";
import { TableInput } from "./Input.svelte";
import { Frontend } from "../../frontend/Frontend";

let canvas = $state<HTMLCanvasElement>();
let validationMessagePopup = $state<PopupHandler>({});
let columnPopup = $state<PopupHandler>({});
let uiFocus = Frontend.uiFocus;

let layout: TableLayout | undefined = $state();
let input: TableInput | undefined = $state();

const me = {};
onDestroy(() => EventHost.unbind(me));

onMount(() => {
  Debug.assert(canvas !== undefined);
  layout = new TableLayout(canvas);
  input = new TableInput(layout, validationMessagePopup);
  new TableRenderer(layout);
});

</script>

<div class="container">
  <button onclick={(ev) => {
    const rect = ev.currentTarget.getBoundingClientRect();
    columnPopup.open!(rect);
  }} aria-label='edit'>
    <PenLineIcon />
  </button>
  <canvas bind:this={canvas}
    class:subsfocused={$uiFocus === 'Table'}
    ondblclick={() => input!.handleDoubleClick()}
    oncontextmenu={(ev) => {
      input!.focus();
      ev.preventDefault();
      Actions.contextMenu();
    }}
  ></canvas>
</div>

{#snippet metricList(opt: {list: Column[]}, category: MetricContext[])}
{@const MetricsList = Object.entries(Metrics) as [keyof typeof Metrics, Metric<any>][]}
  <OrderableList list={opt.list} style='width: 100%' onsubmit={layout!.changeColumns}>
    {#snippet row(col, i)}
      <select bind:value={col.metric} onchange={layout!.changeColumns}>
        {#each MetricsList as [name, m]}
          {#if category.includes(m.context)
            && (!opt.list.some((x) => x.metric == name) || name == col.metric)}
            <option value={name}>{m.localizedName()}</option>
          {/if}
        {/each}
      </select>
      <button onclick={() => {
        opt.list.splice(i, 1);
        layout!.changeColumns();
      }} aria-label='delete'>
        <DeleteIcon />
      </button>
    {/snippet}

    {#snippet footer()}
    {@const used = new Set(opt.list.map((x) => x.metric))}
    {@const unused = MetricsList.filter(
        ([x, y]) => category.includes(y.context) && !used.has(x))}
      <button disabled={unused.length == 0} class="hlayout"
        onclick={async () =>
          (await Menu.new({items: unused.map(([x, y]) => ({
            text: y.localizedName(),
            action() {
              opt.list.push({ metric: x });
              layout!.changeColumns();
            }
          }))})).popup()}
      >
        <PlusIcon />
        {$_('table.add-column')}
      </button>
    {/snippet}
  </OrderableList>
{/snippet}

<Popup bind:handler={columnPopup} position="left">
  {#if layout !== undefined}
  {#key $locale}
  <div class="form">
    <h5>
      {$_('table.edit-columns')}
    </h5>
    {@render metricList({list: layout!.entryColumns}, ['entry'])}
    <hr>
    {@render metricList({list: layout!.channelColumns}, ['style', 'channel'])}
  </div>
  {/key}
  {/if}
</Popup>

<Popup bind:handler={validationMessagePopup} position="left" style='tooltip'>
  <span style="white-space: pre-wrap;">
    {input?.popupMessage}
  </span>
</Popup>

<style>
  @media (prefers-color-scheme: dark) {
    .container button {
      background-color: var(--uchu-yin-5);
    }
  }

  .form {
    display: flex;
    flex-direction: column;
    text-align: start;
  }
  .form h5 {
    padding-top: 0;
  }
  .form select {
    flex-grow: 1;
    min-width: 80px;
    vertical-align: middle;
  }
  .form hr {
    border-bottom: 1px solid gray;
  }

  .container {
    position: relative;
    width: 100%;
    height: 100%;
  }
  .container button {
    position: absolute;
    top: 0;
    right: 0;
    margin-right: 12px;
    margin-top: 2px;
  }

  canvas {
    width: 100%;
    height: 100%;
    border-radius: 4px;
    margin-bottom: 6px;
  }

  .subsfocused {
    /* border: 2px solid skyblue; */
    box-shadow: 0 5px 10px gray;
  }
</style>
