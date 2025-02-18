<script lang="ts">
    import { getContext } from "svelte";
    import { TabAPIContext, type TabAPI, type TabPageID } from "./TabView.svelte";
    import { writable } from "svelte/store";

    export let name = "Tab";
    export let active = false;

    const tabApi: TabAPI = getContext(TabAPIContext);
    const writableName = writable(name);
    const page: TabPageID = {name: writableName}
    tabApi.registerPage(page);
    const selection = tabApi.selected()
    $: writableName.set(name);

    // TODO: is this usable at all?
    $: if (active) {
        selection.set(page);
    }
    $: active = $selection === page;
</script>

<div class='page' class:active>
<slot></slot>
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