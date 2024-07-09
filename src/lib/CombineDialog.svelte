<script lang="ts">
    import DialogBase from './DialogBase.svelte';
    import { SubtitleStyle, type SubtitleEntry } from './Subtitles';
    import { ChangeCause, ChangeType, Frontend } from './frontend';

    export let frontend: Frontend;
	export let show = false;

    let start = 0.005;
    let end = 0.005;
    let number = [0, 0];
    let only = true, different = false, hasbeen = false;
    
    function run(doit: boolean, s: number, e: number, 
            selectionOnly: boolean, differentOnly: boolean) 
    {
        number = [0, 0];

        let selection: SubtitleEntry[]
        if (selectionOnly) {
            let s = frontend.getSelection();
            if (s.length > 0) selection = s;
            else selection = [...frontend.subs.entries];
        } else   selection = [...frontend.subs.entries];

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
                        frontend.subs.entries.splice(
                            frontend.subs.entries.indexOf(entry1), 1);
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
                frontend.clearSelection();
                for (let ent of selection.filter((x) => !done.has(x)))
                    frontend.selection.submitted.add(ent);
                frontend.markChanged(ChangeType.Times, ChangeCause.Action);
            }
        }
    }

    $: start, end, only, different, hasbeen = false;
    $: run(false, start, end, only, different);
</script>

<DialogBase bind:frontend bind:show>
    <table class="config">
        <tr>
            <td>start time threshold</td>
            <td><input type='number' min='0' step="0.001" bind:value={start} /></td>
        </tr>
        <tr>
            <td>end time threshold</td>
            <td><input type='number' min='0' step="0.001" bind:value={end}/></td>
        </tr>
        <tr>
            <td></td>
            <td><input type="checkbox" bind:checked={only}> selection only
            <br><input type="checkbox" bind:checked={different}> different style only</td>
        </tr>
        <tr>
            <td></td>
            <td><hr></td>
        </tr>
        <tr>
            <td>{number[0]}<br><br>{number[1]}</td>
            <td>{number[0] == 1 ? 'entry' : 'entries'}
            <br>{hasbeen ? `${number[0] == 1 ? 'has' : 'have'} been` : 'will be'} combined in
            <br>{number[1] == 1 ? 'group' : 'groups'}</td>
        </tr>
        <tr>
            <td colspan="2"><button style="width: 100%;" 
                on:click={() => run(true, start, end, only, different)}>combine</button></td>
        </tr>
        <tr>
            <td></td>
            <td><hr></td>
        </tr>
    </table>
</DialogBase>