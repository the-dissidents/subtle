<script lang="ts">
import { getContext, type Snippet } from "svelte";
import { TabAPIContext, type TabAPI, type TabPageData } from "./TabView.svelte";
import { writable, get } from "svelte/store";

interface Props {
  name?: string;
  active?: boolean;
  children?: Snippet;
}

let { name = $bindable("Tab"), active = $bindable(false), children }: Props = $props();

const tabApi: TabAPI = getContext(TabAPIContext);
const writableName = writable(name);
const page: TabPageData = {name: writableName}
const id = Symbol();

tabApi.registerPage(id, page);
const selection = tabApi.selected();

$effect(() => { $writableName = name; });
$effect(() => { if (active) $selection = id; });

selection.subscribe((x) => {
  active = x === id;
});
</script>

<div class='page fill' class:active>
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