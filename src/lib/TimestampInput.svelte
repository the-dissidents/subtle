<script lang='ts'>
import { Basic } from './Basic';

interface Props {
  timestamp?: number;
  stretch?: boolean;
  disabled?: boolean;
  oninput?: (t: number) => void;
  // FIXME: this is nearly useless
  onchange?: (t: number) => void;
}

let { 
  timestamp = $bindable(0), 
  stretch = false, 
  disabled = false, 
  onchange, oninput 
}: Props = $props();
let value = $state('00:00:00.000');

// FIXME: this is useless
let changed = false;

$effect(() => {
  let newValue = Basic.formatTimestamp(timestamp);
  if (newValue != value) {
    changed = true;
    value = newValue;
  }
});
</script>

<input class={{timestamp: true, stretch}}
  type="text" {disabled}
  bind:value={value}
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
      timestamp = Basic.parseTimestamp(ev.currentTarget.value) ?? 0;
      changed = true;
      oninput?.(timestamp);
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
      timestamp = Basic.parseTimestamp(ev.currentTarget.value) ?? 0;
      changed = true;
      oninput?.(timestamp);
    };
  }}
  onblur={(ev) => {
    if (!changed) return;
    timestamp = Basic.parseTimestamp(ev.currentTarget.value) ?? 0;
    onchange?.(timestamp);
  }}/>

<style>
  .timestamp {
    font-family: var(--monospaceFontFamily);
    text-align: center;
    box-sizing: border-box;
    width: 110px;
  }
  .stretch {
    width: 100%;
  }
</style>
