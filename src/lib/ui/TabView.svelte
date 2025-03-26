<script lang="ts" module>
import { type Readable, type Writable } from "svelte/store";

export type TabAPIType = {};
export type TabPageData = {name: Readable<string>};
export const TabAPIContext: TabAPIType = {};

export type TabAPI = {
  registerPage(id: Symbol, data: TabPageData): void,
  selected(): Writable<Symbol | undefined>
};
</script>

<script lang="ts">
import { onDestroy, setContext } from "svelte";
import { writable, get } from "svelte/store";

interface Props {
  children: import('svelte').Snippet;
}

let { children }: Props = $props();

let Pages: [Symbol, TabPageData][] = [];
let Selected = writable<Symbol | undefined>(undefined);
let update = $state(0);

setContext<TabAPI>(TabAPIContext, {
  registerPage(id, data) {
    // console.log('register page:', get(data.name));
    Pages.push([id, data]);
    Selected.update((x) => x ?? id);
    data.name.subscribe(() => update++);
    update++;

    onDestroy(() => {
      const i = Pages.findIndex((x) => x[0] === id);
      if (i < 0) return;
      Pages.splice(i, 1);
      if (Pages.length == 0) $Selected = undefined;
      else Selected.update((x) => x === id 
        ? (Pages[i] ?? Pages[Pages.length - 1])[0] : x);
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
  .tabview {
    width: 100%;
    height: 100%;
  }
  .header {
    display: flex;
    flex-direction: row;
    flex-wrap: nowrap;
    border-bottom: 1px solid skyblue;
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
    color: #a6a6a6;
    font-size: 90%;
    text-wrap: nowrap;
    &:not([disabled], .selected):hover {
       color: gray;
    }
  }
  .selected {
    border-bottom: 2px solid skyblue;
    color: #333;
  }
</style>