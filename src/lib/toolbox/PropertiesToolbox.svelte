<!-- TODO: PropertiesToolbox
 1. investigate the use of reactivity here; make sure the refreshes are correct 
-->
<script lang="ts">
import { onDestroy } from 'svelte';

import { Subtitles, type SubtitleStyle } from '../core/Subtitles.svelte';
import StyleEdit from '../StyleEdit.svelte';
import Collapsible from '../ui/Collapsible.svelte';

import { EventHost } from '../frontend/Frontend';
import { Playback } from '../frontend/Playback';
import { ChangeType, Source } from '../frontend/Source';

import { _ } from 'svelte-i18n';
import { flip } from 'svelte/animate';
import { SubtitleTools } from '../core/SubtitleUtil.svelte';
import { Debug } from '../Debug';
    import NumberInput from '../ui/NumberInput.svelte';
    import Tooltip from '../ui/Tooltip.svelte';

let metadata = $state(Source.subs.metadata);
let styles = $state(Source.subs.styles);
let subtitles = $state(Source.subs);
let updateCounter = $state(0);

let playbackLoaded = Playback.isLoaded;

const me = {};
onDestroy(() => EventHost.unbind(me));

Source.onSubtitlesChanged.bind(me, (t) => {
  if (t == ChangeType.StyleDefinitions || t == ChangeType.General) {
    // commented out to keep animations playing
    // updateCounter += 1;
  }
});

Source.onSubtitleObjectReload.bind(me, () => {
  metadata = Source.subs.metadata;
  styles = Source.subs.styles;
  subtitles = Source.subs;
  updateCounter += 1;
});

function newStyle() {
  let newStyle = Subtitles.createStyle(
    SubtitleTools.getUniqueStyleName(Source.subs, 'new'));
  Source.subs.styles.push(newStyle);
  Source.markChanged(ChangeType.StyleDefinitions);
}

function removeUnusedStyles() {
  let usedStyles = new Set<SubtitleStyle>(
    Source.subs.entries.flatMap((x) => [...x.texts.keys()]));
  Source.subs.styles = Source.subs.styles.filter((x) => 
    usedStyles.has(x) || Source.subs.defaultStyle.name == x.name);
  Source.markChanged(ChangeType.StyleDefinitions);
  styles = Source.subs.styles;
}

function markMetadataChange() {
  Source.markChanged(ChangeType.Metadata);
}

function changeResolution() {
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
          <NumberInput class='res' bind:value={metadata.width}
            min={1} max={10000}
            onchange={changeResolution}/>
          ×
          <NumberInput class='res' bind:value={metadata.height} 
            min={1} max={10000}
            onchange={changeResolution}/>
          <button disabled={!$playbackLoaded} onclick={() => {
            Debug.assert(Playback.video?.videoSize !== undefined);
            Debug.assert(Playback.video?.sampleAspectRatio !== undefined);
            const [w, h] = Playback.video.videoSize;
            const sar = Playback.video.sampleAspectRatio;
            metadata.width = Math.round(w * sar);
            metadata.height = Math.round(h);
            changeResolution();
          }}>
            {$_('ppty.match-video-resolution')}
          </button>
        </td>
      </tr>
      <tr>
        <td>{$_('ppty.scaling')}</td>
        <td>
          <NumberInput class='res' bind:value={metadata.scalingFactor} 
            step='any' min={0.01}
            onchange={changeResolution}/>
          <Tooltip text={$_('ppty.scaling-d')} />
        </td>
      </tr>
    </tbody>
  </table>
  <Collapsible header={$_('ppty.styles')} active={true}>
    {#key updateCounter}
      {#each styles as style (style)}
        <div animate:flip={{duration: 200}}>
          <StyleEdit style={style} {subtitles}
            onsubmit={() => styles = Source.subs.styles}/>
          <hr>
        </div>
      {/each}
    {/key}
    <button style="width: 25px"
      onclick={() => newStyle()}>+</button>
    <button
      onclick={() => removeUnusedStyles()}>{$_('ppty.remove-all-unused')}</button>
  </Collapsible>
</div>

<style>
.txt {
  width: 100%;
}
</style>