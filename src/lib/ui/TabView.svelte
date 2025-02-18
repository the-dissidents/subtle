<script lang="ts" context='module'>
    import { type Readable, type Writable } from "svelte/store";

    export type TabAPIType = {};
    export type TabPageID = {name: Readable<string>};
    export const TabAPIContext: TabAPIType = {};

    export type TabAPI = {
        registerPage(id: TabPageID): void,
        selected(): Writable<TabPageID>
    };
</script>

<script lang="ts">
    import { onDestroy, setContext } from "svelte";
    import { writable } from "svelte/store";
    import { Subscribe } from 'svelte-subscribe';

    const Pages: TabPageID[] = [];
    const Selected = writable<TabPageID>(undefined);

    setContext<TabAPI>(TabAPIContext, {
        registerPage(id) {
            Pages.push(id);
            Selected.update((x) => x ?? id);
            onDestroy(() => {
                const i = Pages.indexOf(id);
                if (i < 0) return;
                Pages.splice(i, 1);
                Selected.update((x) => x === id 
                    ? (Pages[i] ?? Pages[Pages.length - 1]) : x);
            });
        },
        selected() {
            return Selected;
        },
    });
</script>

<div class='tabview vlayout'>
    <div class='header'>
        {#each Pages as page}
        <Subscribe pagename={page.name} let:pagename>
        <button 
            class:selected="{$Selected === page}"
            on:click={() => Selected.set(page)}>{pagename}</button>
        </Subscribe>
        {/each}
    </div>

    <slot></slot>
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
        overflow-x: scroll;
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
        &:not([disabled]):hover {
           color: gray;
        }
	}
	.selected {
		border-bottom: 2px solid skyblue;
		color: #333;
	}
</style>