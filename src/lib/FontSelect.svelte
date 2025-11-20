<script lang="ts">
  import { Select } from "bits-ui";
  import { Fonts } from "./Fonts";
  import { tick } from "svelte";

  let value = $state('');
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
  onOpenChange={(v) => {
    if (v) tick().then(() => updateVisibility());
  }
}>
  <Select.Trigger>
    {value}
  </Select.Trigger>
  <Select.Portal>
    <Select.Content strategy='absolute'
      id="font-select-content"
      onscroll={() => updateVisibility()}
    >
      {#each list as entry}
        <Select.Item value={entry.name}>
        {#snippet child({ props })}
          <button class="item" bind:this={entry.ctrl} {...props}>
            {#if entry.visible}
              <!-- {#await Fonts.getFamily(entry.name)}
                {entry.name}
              {:then family} 
                {#if family === null || family.length == 0}
                  Failed: {family[0].}
                {:else}
                  <span style="font-family: '{entry.name}'">
                    {entry.name}
                  </span>
                {/if}
              {/await} -->
              <span style="font-family: '{entry.name}'">
                {entry.name}
              </span>
            {:else}
              {entry.name}
            {/if}
          </button>
        {/snippet}
        </Select.Item>
      {/each}
    </Select.Content>
  </Select.Portal>
</Select.Root>

<style>
  :global([data-select-trigger])::before {
    content: "\200b";
    display: inline-block;
    width: 0;
  }

  :global([data-select-content]) {
    border-radius: 3px;
    border: 1px solid var(--uchu-gray-4);
    background-color: white;
    color: var(--uchu-yin);
    max-height: min(30vh, var(--bits-select-content-available-height));
    min-width: var(--bits-select-anchor-width);
    overflow-y: scroll;
    translate: calc(50% - var(--bits-select-anchor-width) / 2) 0;
  }

  button.item {
    border: none;
    padding: 3px 5px;
    margin: 1px;

    min-width: 5em;
    background-color: white;
    color: var(--uchu-yin);
    font-size: 0.85rem;

    text-align: start;
    box-shadow: none;

    &[data-highlighted] {
      filter: brightness(97%);
    }
  }
</style>