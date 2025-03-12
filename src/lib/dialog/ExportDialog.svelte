<script lang="ts">
    import DialogBase, { type DialogHandler } from '../DialogBase.svelte';
    import type { Frontend } from '../Frontend';
    import { assert } from '../Basic';
    import { onMount } from 'svelte';
    import { SubtitleEntry, type Subtitles, type SubtitleStyle } from '../core/Subtitles.svelte';
    import { LinearFormatCombineStrategy, SimpleFormats } from '../core/SimpleFormats';
    import Collapsible from '../ui/Collapsible.svelte';

    interface Props {
		handler: DialogHandler<void, {content: string, ext: string} | null>;
		frontend: Frontend;
	}

    let {
        handler = $bindable(),
        frontend = $bindable()
    }: Props = $props();

    let inner: DialogHandler<void, string> = {};
    handler.showModal = async () => {
        let subs = frontend.subs;
        let map = new Map<number, number>();
        for (const entry of subs.entries) {
            for (const text of entry.texts) {
                map.set(text.style.uniqueID, (map.get(text.style.uniqueID) ?? 0) + 1);
            }
        }
        console.log(map);
        styles = [subs.defaultStyle, ...subs.styles].map((x) => 
            ({style: x, count: map.get(x.uniqueID) ?? 0, use: true}));
        makePreview();
        let btn = await inner!.showModal!();
        if (btn !== 'ok') return null;
        return { content: preview, ext: extensions[format] };
    };

    let styles: {style: SubtitleStyle, count: number, use: boolean}[] = $state([]);
    let combine = $state(LinearFormatCombineStrategy.Recombine);
    let format: 'srt' | 'tab' | 'txt' = $state('srt');
    let preview = $state('');

    const formatters = {
        'srt': SimpleFormats.export.SRT,
        'txt': SimpleFormats.export.plaintext,
        'tab': SimpleFormats.export.tabDelimited
    };
    const extensions = {
        'srt': 'srt',
        'txt': 'txt',
        'tab': 'txt'
    };

    function makePreview() {
        let styleSet = new Set(styles
            .filter((x) => x.use)
            .map((x) => x.style.uniqueID));
        let entries: SubtitleEntry[] = [];
        for (const e of frontend.subs.entries) {
            const txts = e.texts.filter((x) => styleSet.has(x.style.uniqueID));
            if (txts.length > 0)
                entries.push(new SubtitleEntry(e.start, e.end, ...txts));
        }
        preview = formatters[format](entries, combine);
    }

    async function copy() {
        await navigator.clipboard.writeText(preview);
        frontend.status.set('copied exported data');
    }
</script>

<DialogBase bind:frontend handler={inner} maxWidth="48em" buttons={['cancel', 'ok']}>
    {#snippet header()}
        <h4>Export to a linear format</h4>
    {/snippet}
    <div class="hlayout">
        <div>
            <table class="styles">
                <thead>
                <tr>
                    <th></th>
                    <th class="stylename">Style</th>
                    <th>Usage</th>
                </tr>
                </thead>
                <tbody>
                {#each styles as entry}
                <tr>
                    <td><input type="checkbox" 
                        bind:checked={entry.use} 
                        onchange={() => makePreview()} /></td>
                    <td>{entry.style.name}</td>
                    <td>{entry.count}</td>
                </tr>
                {/each}
                </tbody>
            </table>

            <h5>combine strategy</h5>
            <label><input type="radio" bind:group={combine}
                        value={LinearFormatCombineStrategy.KeepOrder}
                        onchange={() => makePreview()} /> keep order
            </label><br/>
            <label><input type="radio" bind:group={combine}
                        value={LinearFormatCombineStrategy.Sorted}
                        onchange={() => makePreview()} /> sorted
            </label><br/>
            <label><input type="radio" bind:group={combine}
                        value={LinearFormatCombineStrategy.Recombine}
                        onchange={() => makePreview()} /> recombine
            </label><br/>

            <h5>format</h5>
            <label><input type="radio" bind:group={format} value="srt"
                        onchange={() => makePreview()} /> SRT
            </label><br/>
            <label><input type="radio" bind:group={format} value="txt"
                        onchange={() => makePreview()} /> plaintext
            </label><br/>
            <label><input type="radio" bind:group={format} value="tab"
                        onchange={() => makePreview()} /> tab-delimited
            </label><br/>
        </div>
        <div class='vlayout rightpane'>
            <textarea class="preview" readonly>{preview}</textarea>
            <button onclick={() => copy()}>copy to clipboard</button>
        </div>
    </div>
</DialogBase>

<style>
    th {
        background-color: var(--uchu-yin-1);
        border-collapse: collapse;
        border-spacing: 0;
        text-transform: uppercase;
        color: var(--uchu-yin-6);
        font-size: 85%;
    }
    .stylename {
        min-width: 100px;
    }
    th, td {
        border: none;
        margin: 0;
        padding: 0 5px;
    }
    table.styles {
        margin-right: 5px;
        /* border-bottom: 1px solid var(--uchu-yin-1); */
        width: 100%;
    }
    .rightpane {
        margin-left: 10px;
    }
    textarea.preview {
        min-width: 300px;
        min-height: 250px;
        resize: none;
        font-size: 85%;
    }
    button {
        width: 100%;
        margin-top: 5px;
    }
</style>