<script lang="ts">
    import { type SubtitleEntry } from '../core/Subtitles.svelte';
    import { assert } from '../Basic';
    import { Editing } from '../frontend/Editing';
    import { ChangeCause, ChangeType, Source } from '../frontend/Source';
    import type { DialogHandler } from '../frontend/Dialogs';
    import DialogBase from '../DialogBase.svelte';

    import { _ } from 'svelte-i18n';
    
    interface Props {
		handler: DialogHandler<void, void>;
	}

    let {
        handler = $bindable()
    }: Props = $props();

    let inner: DialogHandler<void> = {}
    let start = $state(0.005);
    let end = $state(0.005);
    let number = $state([0, 0]);
    let only = $state(true), different = $state(false), hasbeen = $state(false);
    
    handler.showModal = async () => {
        assert(inner !== undefined);
        await inner.showModal!();
    }

    function run(doit: boolean, s: number, e: number, 
            selectionOnly: boolean, differentOnly: boolean) 
    {
        number = [0, 0];

        let selection: SubtitleEntry[]
        if (selectionOnly) {
            let s = Editing.getSelection();
            if (s.length > 0) selection = s;
            else selection = [...Source.subs.entries];
        } else   selection = [...Source.subs.entries];

        let done = new Set<SubtitleEntry>();
        for (let i = 0; i < selection.length - 1; i++) {
            let entry0 = selection[i];
            let styles = new Set<string>(entry0.texts.map((x) => x.style.name));
            let n = 1;
            if (done.has(entry0)) continue;
            for (let j = i+1; j < selection.length; j++) {
                let entry1 = selection[j];
                if (done.has(entry1)) continue;
                if (Math.abs(entry0.start - entry1.start) < start && 
                    Math.abs(entry0.end - entry1.end) < end)
                {
                    if (differentOnly) {
                        let s2 = entry1.texts.map((x) => x.style.name);
                        if (s2.some((x) => styles.has(x)))
                            continue;
                        s2.forEach((x) => styles.add(x));
                    }
                    if (doit) {
                        entry0.texts.push(...entry1.texts);
                        Source.subs.entries.splice(
                            Source.subs.entries.indexOf(entry1), 1);
                    }
                    n += 1;
                    done.add(entry1);
                }
            }
            if (n > 1) {
                number[0] += n;
                number[1] += 1;
            }
        }

        if (doit) {
            hasbeen = true;
            if (done.size > 0) {
                Editing.clearSelection();
                for (let ent of selection.filter((x) => !done.has(x)))
                    Editing.selection.submitted.add(ent);
                Source.markChanged(ChangeType.Times, ChangeCause.Action);
            }
        } else
            hasbeen = false;
    }
    $effect(() => {
        run(false, start, end, only, different);
    });
</script>

<DialogBase handler={inner}>
    <table class="config">
        <tbody>
            <tr>
                <td>{$_('combinedialog.start-time-threshold')}</td>
                <td><input type='number' min='0' step="0.001" bind:value={start} /></td>
            </tr>
            <tr>
                <td>{$_('combinedialog.end-time-threshold')}</td>
                <td><input type='number' min='0' step="0.001" bind:value={end}/></td>
            </tr>
            <tr>
                <td></td>
                <td>
                    <input type="checkbox" bind:checked={only}>
                    {$_('combinedialog.selection-only')}<br>
                    <input type="checkbox" bind:checked={different}>
                    {$_('combinedialog.different-style-only')}
                </td>
            </tr>
            <tr>
                <td></td>
                <td><hr></td>
            </tr>
            <tr>
                <td>{number[0]}<br><br>{number[1]}</td>
                <td>{$_('combinedialog.entries', {values: {n: number[0]}})}
                <br>{hasbeen 
                    ? $_('combinedialog.have-been-combined-in', {values: {n: number[0]}}) 
                    : $_('combinedialog.will-be-combined-in', {values: {n: number[0]}})}
                <br>{$_('combinedialog.groups', {values: {n: number[1]}})}</td>
            </tr>
            <tr>
                <td colspan="2"><button style="width: 100%;" 
                    onclick={() => run(true, start, end, only, different)}
                >{$_('combinedialog.combine')}</button></td>
            </tr>
            <tr>
                <td></td>
                <td><hr></td>
            </tr>
        </tbody>
    </table>
</DialogBase>