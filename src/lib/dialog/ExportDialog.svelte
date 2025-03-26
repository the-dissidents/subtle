<script lang="ts">
    import { SubtitleEntry, type SubtitleStyle } from '../core/Subtitles.svelte';
    import { LinearFormatCombineStrategy, SimpleFormats } from '../core/SimpleFormats';
    import { Source } from '../frontend/Source';
    import { Interface } from '../frontend/Interface';
    import type { DialogHandler } from '../frontend/Dialogs';
    import DialogBase from '../DialogBase.svelte';

    import { _ } from 'svelte-i18n';

    interface Props {
		handler: DialogHandler<void, {content: string, ext: string} | null>;
	}

    let {
        handler = $bindable(),
    }: Props = $props();

    let inner: DialogHandler<void, string> = {};
    handler.showModal = async () => {
        let subs = Source.subs;
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
        for (const e of Source.subs.entries) {
            const txts = e.texts.filter((x) => styleSet.has(x.style.uniqueID));
            if (txts.length > 0)
                entries.push(new SubtitleEntry(e.start, e.end, ...txts));
        }
        preview = formatters[format](entries, combine);
    }

    async function copy() {
        await navigator.clipboard.writeText(preview);
        Interface.status.set($_('msg.copied-exported-data'));
    }
</script>

<DialogBase handler={inner} maxWidth="48em">
    {#snippet header()}
        <h4>{$_('exportdialog.header')}</h4>
    {/snippet}
    <div class="hlayout">
        <div>
            <table class="styles">
                <thead>
                <tr>
                    <th></th>
                    <th class="stylename">{$_('exportdialog.style')}</th>
                    <th>{$_('exportdialog.usage')}</th>
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

            <h5>{$_('exportdialog.combine-strategy')}</h5>
            <label><input type="radio" bind:group={combine}
                        value={LinearFormatCombineStrategy.KeepOrder}
                        onchange={() => makePreview()} />
                {$_('exportdialog.keep-order')}
            </label><br/>
            <label><input type="radio" bind:group={combine}
                        value={LinearFormatCombineStrategy.Sorted}
                        onchange={() => makePreview()} />
                {$_('exportdialog.sorted')}
            </label><br/>
            <label><input type="radio" bind:group={combine}
                        value={LinearFormatCombineStrategy.Recombine}
                        onchange={() => makePreview()} />
                {$_('exportdialog.recombine')}
            </label><br/>

            <h5>{$_('exportdialog.format')}</h5>
            <label><input type="radio" bind:group={format} value="srt"
                        onchange={() => makePreview()} />
                {$_('exportdialog.srt')}
            </label><br/>
            <label><input type="radio" bind:group={format} value="txt"
                        onchange={() => makePreview()} />
                {$_('exportdialog.plaintext')}
            </label><br/>
            <label><input type="radio" bind:group={format} value="tab"
                        onchange={() => makePreview()} />
                {$_('exportdialog.tab-delimited')}
            </label><br/>
        </div>
        <div class='vlayout rightpane'>
            <textarea class="preview" readonly>{preview}</textarea>
            <button onclick={() => copy()}>{$_('exportdialog.copy-to-clipboard')}</button>
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