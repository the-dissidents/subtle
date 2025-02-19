<script lang="ts">
import { Subtitles, SubtitleStyle } from './Subtitles'
import StyleEdit from './StyleEdit.svelte';
import { ChangeCause, ChangeType, Frontend } from './Frontend';
import Collapsible from './ui/Collapsible.svelte';

interface Props {
  frontend: Frontend
}

let { frontend }: Props = $props();

let metadata = $state(frontend.subs.metadata);
let styles = $state(frontend.subs.styles);
let defaultStyle = $state(frontend.subs.defaultStyle);
let subtitles = $state(frontend.subs);

frontend.onSubtitlesChanged.bind((t, c) => {
  if (t == ChangeType.StyleDefinitions)
    styles = frontend.subs.styles;
})

frontend.onSubtitleObjectReload.bind(() => {
  metadata = frontend.subs.metadata;
  styles = frontend.subs.styles;
  defaultStyle = frontend.subs.defaultStyle;
  subtitles = frontend.subs;
});

function newStyle() {
  let newStyle = new SubtitleStyle('new');
  frontend.subs.styles.push(newStyle);
  frontend.markChanged(ChangeType.StyleDefinitions, ChangeCause.Action);
}

function removeUnusedStyles() {
  let usedStyles = new Set<SubtitleStyle>();
  frontend.subs.entries.forEach((x) => 
    x.texts.forEach((t) => usedStyles.add(t.style)));
  frontend.subs.styles = frontend.subs.styles.filter((x) => usedStyles.has(x));
  frontend.markChanged(ChangeType.StyleDefinitions, ChangeCause.Action);
}

function markMetadataChange() {
  frontend.markChanged(ChangeType.Metadata, ChangeCause.Action);
}

function changeResolution() {
  frontend.playback.video?.subRenderer?.changeResolution();
  markMetadataChange();
}
</script>

<table class="config">
  <tbody>
    <tr>
      <td>title</td>
      <td>
        <input class='txt' bind:value={metadata.title}
          onchange={() => markMetadataChange()} />
      </td>
    </tr>
    <tr>
      <td>language</td>
      <td>
        <input class='txt' bind:value={metadata.language}
          onchange={() => markMetadataChange()} />
      </td>
    </tr>
    <tr>
      <td>resolution</td>
      <td>
        <input type='number' class='res' bind:value={metadata.width}
          onchange={() => changeResolution()}/>
        ×
        <input type='number' class='res' bind:value={metadata.height}
          onchange={() => changeResolution()}/>
      </td>
    </tr>
  </tbody>
</table>
<Collapsible header="STYLES" active={true}>
  {#key subtitles}
    <StyleEdit {frontend} style={defaultStyle} {subtitles} />
    <hr><hr>
    {#each styles as style (style.uniqueID)}
      <StyleEdit {frontend} style={style} {subtitles}
        on:submit={() => styles = frontend.subs.styles}/>
      <hr>
    {/each}
  {/key}
  <button style="width: 25px; height: 20px"
    onclick={() => newStyle()}>+</button>
  <button style="height: 20px"
    onclick={() => removeUnusedStyles()}>remove all unused</button>
</Collapsible>


<style>
.res {
  width: 80px;
}
.txt {
  width: 100%;
}
</style>