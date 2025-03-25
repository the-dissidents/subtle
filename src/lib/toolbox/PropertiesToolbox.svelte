<script lang="ts">
import { onDestroy } from 'svelte';

import { SubtitleStyle } from '../core/Subtitles.svelte'
import Collapsible from '../ui/Collapsible.svelte';
import StyleEdit from '../StyleEdit.svelte';

import { ChangeCause, ChangeType, Source } from '../frontend/Source';
import { Playback } from '../frontend/Playback';
import { EventHost } from '../frontend/Frontend';

import { _ } from 'svelte-i18n';

let metadata = $state(Source.subs.metadata);
let styles = $state(Source.subs.styles);
let subtitles = $state(Source.subs);
let updateCounter = $state(0);

const me = {};
onDestroy(() => EventHost.unbind(me));

Source.onSubtitlesChanged.bind(me, (t, c) => {
  if (t == ChangeType.StyleDefinitions || t == ChangeType.General) {
    styles = Source.subs.styles;
    updateCounter += 1;
  }
});

Source.onSubtitleObjectReload.bind(me, () => {
  metadata = Source.subs.metadata;
  styles = Source.subs.styles;
  subtitles = Source.subs;
  updateCounter += 1;
});


function newStyle() {
  let newStyle = new SubtitleStyle('new');
  Source.subs.styles.push(newStyle);
  Source.markChanged(ChangeType.StyleDefinitions, ChangeCause.Action);
}

function removeUnusedStyles() {
  let usedStyles = new Set<SubtitleStyle>();
  Source.subs.entries.forEach((x) => 
    x.texts.forEach((t) => usedStyles.add(t.style)));
  Source.subs.styles = Source.subs.styles.filter((x) => usedStyles.has(x));
  Source.markChanged(ChangeType.StyleDefinitions, ChangeCause.Action);
}

function markMetadataChange() {
  Source.markChanged(ChangeType.Metadata, ChangeCause.Action);
}

function changeResolution() {
  console.log('change', metadata.width, metadata.height);
  Playback.video?.subRenderer?.changeResolution();
  markMetadataChange();
}
</script>

<table class="config">
  <tbody>
    <tr>
      <td>{$_('ppty.title')}</td>
      <td>
        <input class='txt' bind:value={metadata.title}
          onchange={() => markMetadataChange()} />
      </td>
    </tr>
    <tr>
      <td>{$_('ppty.language')}</td>
      <td>
        <input class='txt' bind:value={metadata.language}
          onchange={() => markMetadataChange()} />
      </td>
    </tr>
    <tr>
      <td>{$_('ppty.resolution')}</td>
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
<Collapsible header={$_('ppty.styles')} active={true}>
  {#key updateCounter}
    <h5>{$_('ppty.default')}</h5>
    <StyleEdit style={Source.subs.defaultStyle} {subtitles} />
    <hr>
    <h5>{$_('ppty.other')}</h5>
    {#each styles as style (style.uniqueID)}
      <StyleEdit style={style} {subtitles}
        on:submit={() => styles = Source.subs.styles}/>
      <hr>
    {/each}
  {/key}
  <button style="width: 25px; height: 20px"
    onclick={() => newStyle()}>+</button>
  <button style="height: 20px"
    onclick={() => removeUnusedStyles()}>{$_('ppty.remove-all-unused')}</button>
</Collapsible>

<style>
.res {
  width: 80px;
}
.txt {
  width: 100%;
}
</style>