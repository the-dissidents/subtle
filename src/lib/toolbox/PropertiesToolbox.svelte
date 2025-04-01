<script lang="ts">
import { onDestroy } from 'svelte';

import { Subtitles, type SubtitleStyle } from '../core/Subtitles.svelte'
import Collapsible from '../ui/Collapsible.svelte';
import StyleEdit from '../StyleEdit.svelte';

import { ChangeType, Source } from '../frontend/Source';
import { Playback } from '../frontend/Playback';
import { EventHost } from '../frontend/Frontend';

import { _ } from 'svelte-i18n';

let metadata = $state(Source.subs.metadata);
let styles = $state(Source.subs.styles);
let subtitles = $state(Source.subs);
let updateCounter = $state(0);

const me = {};
onDestroy(() => EventHost.unbind(me));

Source.onSubtitlesChanged.bind(me, (t) => {
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
  let newStyle = Subtitles.createStyle('new');
  Source.subs.styles.push(newStyle);
  Source.markChanged(ChangeType.StyleDefinitions);
}

function removeUnusedStyles() {
  let usedStyles = new Set<SubtitleStyle>();
  Source.subs.entries.forEach((x) => 
    x.texts.forEach((t) => usedStyles.add(t.style)));
  Source.subs.styles = Source.subs.styles.filter((x) => usedStyles.has(x));
  Source.markChanged(ChangeType.StyleDefinitions);
}

function markMetadataChange() {
  Source.markChanged(ChangeType.Metadata);
}

function changeResolution() {
  console.log('change', metadata.width, metadata.height);
  Playback.video?.subRenderer?.changeResolution();
  markMetadataChange();
}
</script>

<div class="vlayout">
  <table class="config">
    <tbody>
      <tr>
        <td>{$_('ppty.title')}</td>
        <td>
          <input type="text" class='txt' bind:value={metadata.title}
            onchange={() => markMetadataChange()} />
        </td>
      </tr>
      <tr>
        <td>{$_('ppty.language')}</td>
        <td>
          <input type="text" class='txt' bind:value={metadata.language}
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
      {#each styles as style}
        <StyleEdit style={style} {subtitles}
          onsubmit={() => styles = Source.subs.styles}/>
        <hr>
      {/each}
    {/key}
    <button style="width: 25px"
      onclick={() => newStyle()}>+</button>
    <button
      onclick={() => removeUnusedStyles()}>{$_('ppty.remove-all-unused')}</button>
  </Collapsible>
</div>

<style>
.res {
  width: 80px;
}
.txt {
  width: 100%;
}
</style>