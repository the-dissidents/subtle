<script lang="ts" module>
import { type Readable, type Writable } from "svelte/store";

export type TabAPIType = {};
export type TabPageData = {
  readonly id: string,
  readonly name: Readable<string>
};
export const TabAPIContext: TabAPIType = {};

export type TabAPI = {
  registerPage(data: TabPageData): void,
  selected(): Readable<string | undefined>
};
</script>

<script lang="ts">
import { onDestroy, setContext, type Snippet } from "svelte";
import { writable, get } from "svelte/store";
import { Debug } from "../Debug";

interface Props {
  children: Snippet;
  value?: string;
}

let { children, value = $bindable() }: Props = $props();

let Pages = new Map<string, TabPageData>();
let Selected = writable<string | undefined>(undefined);
let update = $state(0);

Selected.subscribe((x) => {
  value = x;
});

$effect(() => {
  $Selected = value === undefined ? undefined : Pages.get(value)?.id;
});

setContext<TabAPI>(TabAPIContext, {
  registerPage(data) {
    // console.log('register page:', get(data.name));
    if (Pages.has(data.id)) {
      Debug.error('duplicate tab id:', data.id);
      return;
    }
    Pages.set(data.id, data);
    $Selected = $Selected ?? data.id;
    data.name.subscribe(() => update++);
    update++;

    onDestroy(() => {
      Pages.delete(data.id);
      if (Pages.size == 0 || $Selected == data.id)
        $Selected = undefined;
    });
  },
  selected() {
    return Selected;
  },
});
</script>

<div class='tabview vlayout'>
  <div class='header'>
    {#key update}
    {#each Pages as [id, data]}
    <button 
      class:selected="{$Selected === id}"
      onclick={() => $Selected = id}>{get(data.name)}</button>
    {/each}
    {/key}
  </div>

  {@render children()}
</div>

<style>
  @media (prefers-color-scheme: light) {
    .header {
      border-bottom: 1px solid var(--uchu-blue-4);
    }
    button {
      color: #a6a6a6;
      &:not(.selected):hover {
        filter: brightness(90%) !important;
      }
    }
    .selected {
      border-bottom: 2px solid var(--uchu-blue-4);
      color: var(--uchu-yin);
    }
  }
  
  @media (prefers-color-scheme: dark) {
    .header {
      border-bottom: 1px solid darkslategray;
    }
    button {
      color: #a6a6a6;
      &:not(.selected):hover {
        filter: brightness(110%) !important;
      }
    }
    .selected {
      border-bottom: 2px solid darkslategray;
      color: var(--uchu-yang);
    }
  }

  .tabview {
    width: 100%;
    height: 100%;
  }
  .header {
    display: flex;
    flex-direction: row;
    flex-wrap: nowrap;
    overflow-x: auto;
    scrollbar-width: thin;
    margin-bottom: 2px;
  }
  button {
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    border-radius: 0;
    box-shadow: none;
    margin: 0;
    font-size: 90%;
    text-wrap: nowrap;
  }
</style>