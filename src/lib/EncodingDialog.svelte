<script lang="ts">
    import DialogBase, { type DialogHandler } from './DialogBase.svelte';
    import type { Frontend } from './Frontend';
    import { assert } from './Basic';
    import chardet, { type AnalyseResult, type EncodingName } from 'chardet';
    import * as iconv from 'iconv-lite';

    interface Props {
		handler: DialogHandler<
            {source: Uint8Array, result: AnalyseResult}, 
            {decoded: string, encoding: EncodingName} | null>;
		frontend: Frontend;
	}

    let {
        handler = $bindable(),
        frontend = $bindable()
    }: Props = $props();

    let inner: DialogHandler<void, string> = {}
    handler.showModal = async ({source: s, result}) => {
        assert(inner !== undefined);
        source = s;
        candidates = result;
        if (candidates.length > 0) {
            selectedEncoding = candidates[0].name;
            makePreview();
        }
        let btn = await inner.showModal!();
        if (btn !== 'ok' || !selectedEncoding) return null;
        return {
            encoding: selectedEncoding, 
            decoded: iconv.decode(source, selectedEncoding)
        };
    }

    let selectedEncoding: EncodingName | undefined = $state();
    let okButton = $state({name: 'ok', enabled: false});
    let preview = $state('');
    let source: Uint8Array;
    let candidates: AnalyseResult | undefined = $state();

    function makePreview() {
        if (selectedEncoding && source) {
            try {
                preview = iconv.decode(
                    source.subarray(0, Math.min(6000, source.length)), selectedEncoding);
                okButton.enabled = true;
            } catch {
                preview = '';
                okButton.enabled = false;
            }
        } else {
            preview = '';
            okButton.enabled = false;
        }
    }
</script>


<DialogBase bind:frontend handler={inner} maxWidth={'35em'}
    buttons={['cancel', okButton]}
>
    {#snippet header()}
    <h4>The file you're opening seems to be using an unusual encoding format, which can cause problems on today's devices. </h4>
    {/snippet}
    <p>We can guess the format and convert the file to the modern encoding for you. The guess is usually very accurate, unless the file is simply invalid; but when in doubt, consult an expert.</p>
    <div class='hlayout'>
        <table>
            <thead>
            <tr>
                <th></th>
                <th>Encoding</th>
                <th>Confidence</th>
            </tr>
            </thead>
            <tbody>
            {#if candidates && candidates.length > 0}
                {#each candidates as c, i}
                <tr class={{
                        important: c.confidence == 100, 
                        unimportant: c.confidence < 20 
                                  || (i > 0 && candidates[0].confidence == 100)
                }}>
                    <td class="right">
                        <input type="radio" value={c.name}
                            bind:group={selectedEncoding}
                            onchange={() => makePreview()}>
                    </td>
                    <td class="middle">{c.name}</td>
                    <td class="right">{c.confidence}%</td>
                </tr>
                {/each}
            {:else}
                <tr>
                    <td colspan="3">
                        Unable to guess encoding
                    </td>
                </tr>
            {/if}
            </tbody>
        </table>
        <textarea class="flexgrow" readonly>{preview}</textarea>
    </div>
    <p>Choose an encoding, check the preview for correctness, then click 'ok' to convert the file to UTF-8 for use in modern applications.</p>
</DialogBase>

<style>
    h4 {
        font-size: 100%;
        font-weight: bold;
        margin: 1em 0 0;
    }
    textarea {
        resize: none;
        height: auto;
        
    }
    th {
        background-color: var(--uchu-yin-1);
        border-collapse: collapse;
        border-spacing: 0;
        text-transform: uppercase;
        color: var(--uchu-yin-6);
        font-size: 85%;
    }
    th, td {
        border: none;
        margin: 0;
        padding: 0 5px;
    }
    table {
        margin-right: 5px;
    }
    .important {
        font-weight: bold;
    }
    .unimportant {
        color: gray;
    }
    .right {
        text-align: right;
    }
    .middle {
        padding-right: 10px;
    }
</style>