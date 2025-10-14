<script lang="ts" module>
import { type Readable } from "svelte/store";

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export type TabAPIType = {};
export type TabPageData = {
  readonly id: string,
  readonly header: Snippet
};
export const TabAPIContext: TabAPIType = {};

export type TabAPI = {
  registerPage(data: TabPageData): void,
  selected(): Readable<string | undefined>
};
</script>

<script lang="ts">
import { onDestroy, setContext, type Snippet } from "svelte";
import { writable } from "svelte/store";
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
    if (Pages.has(data.id)) {
      Debug.error('duplicate tab id:', data.id);
      return;
    }
    Pages.set(data.id, data);
    $Selected = $Selected ?? data.id;
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
    {#each Pages as [id, data] (id)}
      <button 
        class:selected="{$Selected === id}"
        class='hlayout'
        onclick={() => $Selected = id}>
        {@render data.header()}
      </button>
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
      color: var(--uchu-yin);
      &:not(.selected) {
        filter: contrast(10%) !important;
      }
      &:not(.selected):hover {
        filter: contrast(50%) !important;
      }
    }
    .selected {
      border-bottom: 2px solid var(--uchu-blue-4);
    }
  }
  
  @media (prefers-color-scheme: dark) {
    .header {
      border-bottom: 1px solid darkslategray;
    }
    button {
      color: var(--uchu-yang);
      &:not(.selected) {
        filter: contrast(10%) !important;
      }
      &:not(.selected):hover {
        filter: contrast(50%) !important;
      }
    }
    .selected {
      border-bottom: 2px solid darkslategray;
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