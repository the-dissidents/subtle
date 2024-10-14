<script lang="ts">
    import type { Frontend } from "./Frontend";
    import Collapsible from "./ui/Collapsible.svelte";
    import * as clipboard from "@tauri-apps/plugin-clipboard-manager"
    import * as dialog from "@tauri-apps/plugin-dialog"

    export let frontend: Frontend;
    export let locked = false;

    let textsize = 14;
    let justify = true;
    let textarea: HTMLTextAreaElement;
    let text = '';

    async function paste() {
        let text = await clipboard.readText();
        if (text.length > 500000 && !await dialog.confirm(
            'The text in your clipboard is very long. Proceed to import?', 
            {kind: 'warning'})) return;
        textarea.value = text;
    }

    function clear() {
        textarea.value = '';
    }
</script>

<div class='vlayout fill'>
    <div class="hlayout">
        <button class="flexgrow" on:click={() => clear()}>clear</button>
        <button class="flexgrow" on:click={() => paste()}>paste</button>
        <label class="flexgrow" for='lock'>
            <input type='checkbox' class="button" bind:checked={locked} id='lock'/>
            lock
        </label>
    </div>
    <textarea class="flexgrow" class:justify
        readonly={locked}
        style="min-height: 250px; font-size: {textsize}px"
        bind:this={textarea}/>
    <div>
        <Collapsible header='Settings'>
            <table class="config">
                <tr>
                    <td>text size</td>
                    <td><input id='size' type='number' bind:value={textsize}/></td>
                </tr>
                <tr>
                    <td>justify</td>
                    <td><input id='just' type='checkbox' bind:checked={justify}/></td>
                </tr>
            </table>
        </Collapsible>
    </div>
    <div>
        <Collapsible header='Fuzzy proofreading tool'>
        </Collapsible>
    </div>
</div>

<style>
    textarea {
        resize: none;
    }
    .justify {
        text-align: justify;
    }
</style>