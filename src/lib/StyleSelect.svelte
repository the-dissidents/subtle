<script lang="ts">
import { onDestroy } from "svelte";
import type { SubtitleStyle } from "./core/Subtitles.svelte";
import { ChangeType, Source } from "./frontend/Source";
import { EventHost } from "./frontend/Frontend";

interface Props {
  disabled?: boolean,
  currentStyle: SubtitleStyle;
  onsubmit?: (style: SubtitleStyle) => void;
}

let { disabled = false, currentStyle = $bindable(), onsubmit }: Props = $props();
let refresh = $state(0);
let styles = $state(Source.subs.styles);

const me = {};
onDestroy(() => EventHost.unbind(me));

Source.onSubtitlesChanged.bind(me, (t) => {
  if (t == ChangeType.StyleDefinitions || t == ChangeType.General) {
    styles = Source.subs.styles;
    currentStyle = Source.subs.defaultStyle;
    refresh++;
  }
});
</script>

<select tabindex='-1'
  disabled={disabled}
  oninput={(ev) => {
    currentStyle = styles[ev.currentTarget.selectedIndex];
    onsubmit?.(currentStyle);
  }}
  onclick={() => refresh++}
>
  {#key refresh}
    {#each styles as style}
      <option selected={currentStyle.name == style.name}>{style.name}</option>
    {/each}
  {/key}
</select>