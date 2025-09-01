<script lang="ts">
import { getContext, type Snippet } from "svelte";
import { TabAPIContext, type TabAPI, type TabPageData } from "./TabView.svelte";

interface Props {
  id: string;
  header: Snippet;
  children?: Snippet;
}

let { id, header, children }: Props = $props();

const tabApi: TabAPI = getContext(TabAPIContext);
const page: TabPageData = {id, header};

tabApi.registerPage(page);
const selection = tabApi.selected();
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
  scrollbar-gutter: stable;
}
.active {
  display: block;
}
</style>