<script lang="ts">
import { onDestroy } from "svelte";
import type { SubtitleStyle } from "./core/Subtitles.svelte";
import { ChangeType, Source } from "./frontend/Source";
import { EventHost } from "./frontend/Frontend";

interface Props {
  disabled?: boolean,
  stretch?: boolean;
  currentStyle: SubtitleStyle;
  onsubmit?: (style: SubtitleStyle, cancel: () => void) => void;
}

let { disabled = false, stretch = false, currentStyle = $bindable(), onsubmit }: Props = $props();
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

<select tabindex='-1' class={{stretch}}
  disabled={disabled}
  oninput={async (ev) => {
    let oldStyle = currentStyle;
    currentStyle = styles[ev.currentTarget.selectedIndex];
    onsubmit?.(currentStyle, () => currentStyle = oldStyle);
  }}
  onclick={() => refresh++}
>
  {#key refresh}
    {#each styles as style}
      <option selected={currentStyle.name == style.name}>{style.name}</option>
    {/each}
  {/key}
</select>

<style>
  .stretch {
    width: 100%;
  }
</style>