<script lang="ts">
  import { Select } from "bits-ui";
  import { Fonts } from "./Fonts";
  import type { HTMLButtonAttributes } from "svelte/elements";

  interface Props extends HTMLButtonAttributes {
    value: string,
    onChange?: (v: string) => void
  };

  let { value = $bindable(), onChange, ...rest }: Props = $props();
  let list: Entry[] = $state([]);
  
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
</script>

<Select.Root type='single' bind:value
  onValueChange={(v) => onChange?.(v)}
  onOpenChange={(v) => {
    if (v) setTimeout(() => updateVisibility(), 0);
  }
}>
  <Select.Trigger {...rest as object}>
    {value}
  </Select.Trigger>
  <Select.Portal>
    <Select.Content strategy='absolute'
      id="font-select-content"
      onscroll={() => updateVisibility()}
      collisionPadding={{left: -Infinity}}
    >
      {#each list as entry}
        <Select.Item value={entry.name}>
        {#snippet child({ props })}
          <button class="item hlayout" bind:this={entry.ctrl} {...props}>
            <span class="name">
              {entry.name}
            </span>
            {#if entry.visible}
              {#await Fonts.getFamily(entry.name)}
                <!-- empty -->
              {:then family} 
                {#if family === null || family.length == 0}
                  <span class="preview">
                    Failed to load data for this font
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
        </Select.Item>
      {/each}
    </Select.Content>
  </Select.Portal>
</Select.Root>

<style>
  :global([data-select-trigger]) {
    box-shadow: none;
    &::before {
      content: "\200b";
      display: inline-block;
      width: 0;
    }
  }

  :global([data-select-content]) {
    border: 1px solid var(--uchu-gray-4);
    background-color: white;
    color: var(--uchu-yin);
    max-height: min(30vh, var(--bits-select-content-available-height));
    width: max(30em, var(--bits-select-anchor-width));
    overflow-y: scroll;
    translate: calc(50% - var(--bits-select-anchor-width) / 2) 0;
  }

  button.item {
    border-radius: 0;
    border-top: none;
    border-bottom: solid var(--uchu-gray-4) 1px;
    padding: 3px 5px;

    min-width: 5em;
    background-color: white;
    color: var(--uchu-yin);
    font-size: 0.85rem;

    text-align: start;
    box-shadow: none;
    font-family: var(--fontFamily);

    &[data-highlighted] {
      filter: brightness(97%);
    }
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