<script lang="ts">
import { SubtitleStyle } from './Subtitles'
import StyleEdit from './StyleEdit.svelte';
import { ChangeCause, ChangeType, Frontend } from './Frontend';
import Collapsible from './ui/Collapsible.svelte';
    import CombineDialog from './CombineDialog.svelte';

export let frontend: Frontend;
export let show = false;

$: show, frontend.subs.styles = frontend.subs.styles;

function newStyle() {
  let newStyle = new SubtitleStyle('new');
  frontend.subs.styles = [...frontend.subs.styles, newStyle];
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
  <tr>
    <td>title</td>
    <td>
      <input class='txt' bind:value={frontend.subs.metadata.title}
        on:change={() => markMetadataChange()} />
    </td>
  </tr>
  <tr>
    <td>language</td>
    <td>
      <input class='txt' bind:value={frontend.subs.metadata.language}
        on:change={() => markMetadataChange()} />
    </td>
  </tr>
  <tr>
    <td>resolution</td>
    <td>
      <input type='number' class='res' bind:value={frontend.subs.metadata.width}
        on:change={() => changeResolution()}/>
      ×
      <input type='number' class='res' bind:value={frontend.subs.metadata.height}
        on:change={() => changeResolution()}/>
    </td>
  </tr>
</table>
<Collapsible header="STYLES" active={true}>
  <StyleEdit {frontend} style={frontend.subs.defaultStyle} subtitles={frontend.subs} />
  <hr><hr>
  {#each frontend.subs.styles as style (style.uniqueID)}
    <StyleEdit {frontend} style={style} subtitles={frontend.subs}
      on:submit={() => frontend.subs.styles = frontend.subs.styles}/>
    <hr>
  {/each}
  <button style="width: 25px; height: 20px"
    on:click={() => newStyle()}>+</button>
  <button style="height: 20px"
    on:click={() => removeUnusedStyles()}>remove all unused</button>
</Collapsible>


<style>
.res {
  width: 80px;
}
.txt {
  width: 100%;
}
</style>