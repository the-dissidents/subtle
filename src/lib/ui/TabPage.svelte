<script lang="ts">
import { getContext, type Snippet } from "svelte";
import { TabAPIContext, type TabAPI, type TabPageData } from "./TabView.svelte";
import { writable } from "svelte/store";

interface Props {
  id: string;
  name?: string;
  children?: Snippet;
}

let { id, name = $bindable("Tab"), children }: Props = $props();

const tabApi: TabAPI = getContext(TabAPIContext);
const writableName = writable(name);
const page: TabPageData = {id, name: writableName};

tabApi.registerPage(page);
const selection = tabApi.selected();

$effect(() => { $writableName = name; });
</script>

<div class={['page', 'fill', {active: $selection === id}]}>
{@render children?.()}
</div>

<style>
.page {
  padding: 2px;
  flex: 1 0;
  overflow-x: hidden;
  overflow-y: auto;
  display: none;
}
.active {
  display: block;
}
</style>