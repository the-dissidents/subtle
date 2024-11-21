<script lang="ts">
import { SubtitleStyle } from './Subtitles'
import StyleEdit from './StyleEdit.svelte';
import { ChangeCause, ChangeType, Frontend } from './Frontend';
import Collapsible from './ui/Collapsible.svelte';

export let frontend: Frontend;
export let show = false;

$: show, frontend.subs.styles = frontend.subs.styles;
</script>

<table class="config">
  <tr>
    <td>title</td>
    <td>
      <input class='txt' bind:value={frontend.subs.metadata.title} />
    </td>
  </tr>
  <tr>
    <td>language</td>
    <td>
      <input class='txt' bind:value={frontend.subs.metadata.language} />
    </td>
  </tr>
  <tr>
    <td>resolution</td>
    <td>
      <input type='number' class='res' bind:value={frontend.subs.metadata.width}
        on:change={() => frontend.playback.video?.subRenderer?.changeResolution()}/>
      ×
      <input type='number' class='res' bind:value={frontend.subs.metadata.height}/>
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
    on:click={() => {
      let newStyle = new SubtitleStyle('new');
      frontend.subs.styles = [...frontend.subs.styles, newStyle];
      frontend.markChanged(ChangeType.StyleDefinitions, ChangeCause.Action);
    }}>+</button>
</Collapsible>


<style>
.res {
  width: 80px;
}
.txt {
  width: 100%;
}

hr {
  border: 0.5px solid rgb(193, 193, 193);
  border-radius: 0.5px;
}
</style>