<script lang="ts">
import { SubtitleStyle } from './Subtitles'
import DialogBase from './DialogBase.svelte';
import StyleEdit from './StyleEdit.svelte';
import { Frontend } from './frontend';

export let frontend: Frontend;
export let show = false;

$: show, frontend.subs.styles = frontend.subs.styles;
</script>

<DialogBase bind:frontend bind:show>
  <h2 slot='header'>Properties</h2>
  <table class="config">
    <tr>
      <td>title</td>
      <td>
        <input class='txt' />
      </td>
    </tr>
    <tr>
      <td>language</td>
      <td>
        <input class='txt' />
      </td>
    </tr>
    <tr>
      <td>resolution</td>
      <td>
        <input type='number' class='res' bind:value={frontend.subs.width}
          on:change={() => frontend.playback.video?.subRenderer?.changeResolution()}/>
        ×
        <input type='number' class='res' bind:value={frontend.subs.height}/>
      </td>
    </tr>
    <tr>
      <td>styles</td>
      <td><hr/></td>
    </tr>
  </table>
  <table class="txt">
    <StyleEdit {frontend} style={frontend.subs.defaultStyle} subtitles={frontend.subs} />
    {#each frontend.subs.styles as style (style.uniqueID)}
      <StyleEdit {frontend} style={style} subtitles={frontend.subs}
        on:submit={() => frontend.subs.styles = frontend.subs.styles}/>
    {/each}
    <tr><td style="padding-right: 10px;">
      <button style="width: 25px; height: 20px"
        on:click={() => {
          let newStyle = new SubtitleStyle('new');
          frontend.subs.styles = [...frontend.subs.styles, newStyle];
        }}>+</button>
    </td></tr>
  </table>
</DialogBase>

<style>
.res {
  width: 80px;
}
.txt {
  width: 100%;
}
</style>