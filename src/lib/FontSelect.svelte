<script lang="ts">
  import { Combobox } from "bits-ui";
  import { _ } from 'svelte-i18n';
  import { Fonts } from "./Fonts";
  import type { HTMLButtonAttributes } from "svelte/elements";
  import { hook } from "./details/Hook.svelte";
  import { Debug } from "./Debug";

  import Tooltip from "./ui/Tooltip.svelte";
  import { InfoIcon } from "@lucide/svelte";

  interface Props extends HTMLButtonAttributes {
    value: string,
    onChange?: (v: string) => void
  };

  let { value = $bindable(), onChange, ...rest }: Props = $props();
  let list: Entry[] = $state([]);
  let searchValue = $state("");
  let isValid = $state(false);

  hook(() => value, (v) => {
    isValid = Fonts.families.has(v);
    Debug.info('isvalid?', v, isValid);
  });
 
  const filteredList = $derived.by(() => {
    if (searchValue === "") return list;
    const lower = searchValue.toLowerCase();
    const filtered = list.filter((item) =>
      item.name.toLowerCase().includes(lower));
    return filtered.sort((a, b) => 
        (a.name.toLowerCase().startsWith(lower) ? 0 : 1) 
      - (b.name.toLowerCase().startsWith(lower) ? 0 : 1));
  });
 
  function handleInput(e: Event & { currentTarget: HTMLInputElement }) {
    searchValue = e.currentTarget.value;
    setTimeout(() => updateVisibility(), 0);
  }
 
  function handleOpenChange(v: boolean) {
    if (!v) searchValue = "";
    if (v) setTimeout(() => updateVisibility(), 0);
  }
  
  let anchor = $state<HTMLElement>(null!);
  
  type Entry = {
    name: string,
    ctrl?: HTMLElement,
    visible: boolean
  };

  Fonts.onInit(() => list = [...Fonts.families].map((x) => ({
    name: x,
    ctrl: undefined,
    visible: false
  })));

  function updateVisibility() {
    for (const entry of list) {
      if (!entry.ctrl) continue;
      const content = entry.ctrl.parentElement!;
      entry.visible ||=
           entry.ctrl.offsetTop + entry.ctrl.offsetHeight >= content.scrollTop
        && entry.ctrl.offsetTop <= content.scrollTop + content.offsetHeight;
    }
  }

  function describeAvailability(v: string) {
    const w = Fonts.windowsAvailability(v);
    const m = Fonts.macosAvailability(v);

    return `Windows: ${w.status
      ? (w.supplement ? `📁 Only in ${w.supplement} supplement` : `✅ Built-in`)
      : `❌ not available`}\n` 
         + `macOS: ${m.status
      ? (m.supplement ? `📁 Sometimes requires manual download` : `✅ Built-in`)
      : `❌ not available`}`;
  }
</script>

<Combobox.Root type='single' bind:value
  onValueChange={(v) => onChange?.(v)}
  onOpenChange={(v) => handleOpenChange(v)}
>
  <div class="hlayout" {...rest as object}>
    <div class="combobox flexgrow" bind:this={anchor}>
      <Combobox.Input
        onchange={(e) => {
          value = e.currentTarget.value;
          onChange?.(value);
        }}
        oninput={(v) => handleInput(v)}/>
      <Combobox.Trigger />
    </div>
    {#if !isValid && value != ""}
      <Tooltip text={$_('fontselect.this-font-doesnt-exist-on-your-computer')}>
        <div>⚠️</div>
      </Tooltip>
    {/if}
    <Tooltip text={describeAvailability(value)} style="whitespace:nowrap">
      <span class="hlayout"><InfoIcon /></span>
      {#snippet content()}
        {@const w = Fonts.windowsAvailability(value)}
        {@const m = Fonts.macosAvailability(value)}
        Windows: <b>{w.status
          ? (w.supplement ? `only in ${w.supplement} supplement` : `built-in`)
          : `not available`}</b>
        <br/>macOS: <b>{m.status
          ? (m.supplement ? `sometimes requires manual download` : `built-in`)
          : `not available`}</b>
      {/snippet}
    </Tooltip>
  </div>
  <Combobox.Portal>
    <Combobox.Content strategy='absolute'
      id="font-select-content"
      onscroll={() => updateVisibility()}
      collisionPadding={{left: -Infinity}}
      customAnchor={anchor}
    >
      {#each filteredList as entry}
        <Combobox.Item value={entry.name} label={entry.name}>
        {#snippet child({ props })}
          <button class="hlayout" bind:this={entry.ctrl} {...props}>
            <span class="name">
              {#if searchValue == ''}
                {entry.name}
              {:else}
              {@const pos = entry.name.toLowerCase().indexOf(searchValue.toLowerCase())}
                {entry.name.slice(0, pos)}<b>{entry.name.slice(pos, pos + searchValue.length)}</b>{entry.name.slice(pos + searchValue.length)}
              {/if}
            </span>
            {#if entry.visible}
              {#await Fonts.getFamily(entry.name)}
                <!-- empty -->
              {:then family} 
                {#if family === null || family.length == 0}
                  <span class="preview">
                    {$_('fontselect.failed-to-load-data-for-this-font')}
                  </span>
                {:else}
                  <span class="preview" style="font-family: '{entry.name}'">
                    {family[0].previewString}
                  </span>
                {/if}
              {/await}
            {/if}
          </button>
        {/snippet}
        </Combobox.Item>
      {:else}
        <Combobox.Item value="" disabled={true}>
          <i>{$_('fontselect.no-font-matches-your-query')}</i>
        </Combobox.Item>
      {/each}
    </Combobox.Content>
  </Combobox.Portal>
</Combobox.Root>

<style>
  b {
    font-weight: bold;
  }
  .name {
    flex-grow: 1;
    padding-right: 10px;
    white-space: nowrap;
  }

  .preview {
    font-size: 1rem;
    text-align: right;
    min-width: 5em;
    word-break: keep-all;
    text-wrap: balance;
  }
</style>