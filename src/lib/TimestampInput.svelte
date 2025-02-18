<script lang='ts'>
	import { createEventDispatcher } from 'svelte';
    import { SubtitleUtil } from './Subtitles';

    interface Props {
        timestamp?: number;
        stretch?: boolean;
    }

    let { timestamp = $bindable(0), stretch = false }: Props = $props();
    let value = $state('00:00:00.000');
    let changed = false;
    
	const dispatch = createEventDispatcher<{
        change: number; input: number;
    }>();
	const change = () => dispatch('change', timestamp);
	const input = () => dispatch('input', timestamp);

    $effect(() => {
        let newValue = SubtitleUtil.formatTimestamp(timestamp);
        if (newValue != value) {
            changed = true;
            value = newValue;
        }
    });
</script>

<input class={'timestamp ' + (stretch ? 'stretch' : '')} bind:value={value}
    onbeforeinput={(ev) => {
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
    onkeydown={(ev) => {
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
    onblur={(ev) => {
        if (!changed) return;
        timestamp = SubtitleUtil.parseTimestamp(ev.currentTarget.value) ?? 0;
        change();
    }}/>

<style>
	.timestamp {
        font-family: Menlo, Consolas, 'Courier New', Courier, monospace;
		text-align: center;
        box-sizing: border-box;
        min-width: 80px;
	}
    .stretch {
        width: 100%;
    }
</style>
