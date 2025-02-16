<script lang='ts'>
	import { createEventDispatcher } from 'svelte';
    import { SubtitleUtil } from './Subtitles';

	export let timestamp = 0;
    export let stretchX = false;
    let value = '00:00:00.000';
    let changed = false;
    
    $: {
        let newValue = SubtitleUtil.formatTimestamp(timestamp);
        updateValueIfChanged(newValue);
    }
    function updateValueIfChanged(newValue: string) {
        if (newValue != value) {
            changed = true;
            value = newValue;
        }
    }
	const dispatch = createEventDispatcher<{
        change: number; input: number;
    }>();
	const change = () => dispatch('change', timestamp);
	const input = () => dispatch('input', timestamp);
</script>

<input class={'timestamp ' + (stretchX ? 'stretch' : '')} bind:value={value}
    on:beforeinput={(ev) => {
        // Note: Safari fires beforeinput and input *before* keydown if the IME is on, so
        // we must handle numerical input here
        let text = ev.currentTarget.value;
        let pos = ev.currentTarget.selectionStart ?? 0;
        let data = ev.data;
        if (!data) return;
        ev.preventDefault();
        if (pos < text.length && data.match(/^\d$/)) {
            if (text[pos] == ':' || text[pos] == '.') pos++;
            ev.currentTarget.value = 
                text.slice(0, pos) + data + text.slice(pos+1);
            ev.currentTarget.selectionStart = pos+1;
            ev.currentTarget.selectionEnd = pos+1;
            timestamp = SubtitleUtil.parseTimestamp(ev.currentTarget.value) ?? 0;
            changed = true;
            input();
        } 
    }}
    on:keydown={(ev) => {
        let text = ev.currentTarget.value;
        let pos = ev.currentTarget.selectionStart ?? 0;
        if (ev.key == 'Backspace' && pos > 0) {
            if (text[pos-1] == ':' || text[pos-1] == '.') pos--;
            ev.currentTarget.value = 
                text.slice(0, pos-1) + '0' + text.slice(pos);
            ev.currentTarget.selectionStart = pos-1;
            ev.currentTarget.selectionEnd = pos-1;
            ev.preventDefault();
            timestamp = SubtitleUtil.parseTimestamp(ev.currentTarget.value) ?? 0;
            changed = true;
            input();
        };
    }}
    on:blur={(ev) => {
        if (!changed) return;
        timestamp = SubtitleUtil.parseTimestamp(ev.currentTarget.value) ?? 0;
        change();
    }}/>

<style>
	.timestamp {
        font-family: Menlo, Consolas, 'Courier New', Courier, monospace;
		text-align: center;
        box-sizing: border-box;
        width: 120px;
	}
    .stretch {
        width: 100%;
        height: 100%;
    }
</style>
