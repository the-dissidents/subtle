<script lang="ts">
import { onDestroy } from "svelte";
import type { SubtitleStyle } from "./core/Subtitles.svelte";
import { ChangeType, Source } from "./frontend/Source";
import { EventHost } from "./frontend/Frontend";

interface Props {
  currentStyle: SubtitleStyle;
  onsubmit?: () => void;
}

let { currentStyle = $bindable(), onsubmit }: Props = $props();
let refresh = $state(0);
let styles = $state(Source.subs.styles);

const me = {};
onDestroy(() => EventHost.unbind(me));

Source.onSubtitlesChanged.bind(me, (t) => {
  if (t == ChangeType.StyleDefinitions || t == ChangeType.General) {
    styles = Source.subs.styles;
    refresh++;
  }
});
</script>

<select tabindex='-1'
  oninput={(ev) => {
    let index = ev.currentTarget.selectedIndex;
    if (index <= 0) currentStyle = Source.subs.defaultStyle;
    else currentStyle = styles[index - 1];
    onsubmit?.();
  }}
  onclick={() => refresh++}
>
  {#key refresh}
    <option selected={currentStyle == Source.subs.defaultStyle}>
      {Source.subs.defaultStyle.name}
    </option>
    {#each styles as style (style.uniqueID)}
      <option selected={currentStyle == style}>{style.name}</option>
    {/each}
  {/key}
</select>