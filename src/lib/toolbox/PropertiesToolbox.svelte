<script lang="ts">
import { Debug } from '../Debug';
import { SubtitleStyle } from '../core/Subtitles.svelte';
import { SubtitleTools } from '../core/SubtitleUtil.svelte';

import { ConfigRow, ConfigTable, NumberInput, Tooltip } from "@the_dissidents/svelte-ui";
import StyleEdit from '../StyleEdit.svelte';

import { EventHost } from '../details/EventHost';
import { Playback } from '../frontend/Playback';
import { ChangeType, Source } from '../frontend/Source';

import { onDestroy } from 'svelte';
import { flip } from 'svelte/animate';
import { _ } from 'svelte-i18n';
import { Menu } from '@tauri-apps/api/menu';
import { PackageOpenIcon, PlusIcon } from '@lucide/svelte';
  import { SavedStyles } from '../config/SavedStyles';

let metadata = $state(Source.subs.metadata);
let styles = $state(Source.subs.styles);
let subtitles = $state(Source.subs);
let updateCounter = $state(0);

let loadState = Playback.loadState;

const me = {};
onDestroy(() => EventHost.unbind(me));

Source.onSubtitleObjectReload.bind(me, () => {
  metadata = Source.subs.metadata;
  styles = Source.subs.styles;
  subtitles = Source.subs;
  updateCounter += 1;
});

async function newStyle() {
  let newStyle = SubtitleStyle.new(
    SubtitleTools.getUniqueStyleName(Source.subs, 'new'));
  Source.subs.styles.push(newStyle);
  await Source.markChanged(ChangeType.StyleDefinitions, $_('c.add-style'));
}

async function removeUnusedStyles() {
  let usedStyles = new Set<SubtitleStyle>(
    Source.subs.entries.flatMap((x) => [...x.texts.keys()]));
  Source.subs.styles = Source.subs.styles.filter((x) =>
    usedStyles.has(x) || Source.subs.defaultStyle.name == x.name);
  await Source.markChanged(ChangeType.StyleDefinitions, $_('ppty.remove-all-unused'));
  styles = Source.subs.styles;
}

async function markMetadataChange() {
  await Source.markChanged(ChangeType.Metadata, $_('c.metadata'));
}

async function manageSavedStyles() {
  await (await Menu.new({
    items: $SavedStyles.length > 0
      ? $SavedStyles.map((x) => ({
        text: x.name,
        items: [
          {
            text: $_('ppty.add-to-project'),
            action() {
              let style = $state(SubtitleStyle.clone(x));
              style.name = SubtitleTools.getUniqueStyleName(Source.subs, style.name);
              Source.subs.styles.push(style);
            }
          }, {
            text: $_('ppty.delete'),
            action() {
              const i = $SavedStyles.indexOf(x);
              Debug.assert(i >= 0);
              $SavedStyles.splice(i, 1);
              SavedStyles.markChanged();
            }
          }
        ],
      }))
      : [{
        text: $_('msg.no-saved-styles'),
        enabled: false
      }]
  })).popup();
}
</script>

<div class="vlayout">
  <ConfigTable>
    <ConfigRow name={$_('ppty.title')} style='display: flex; flex-direction: row;'>
      <input type="text" class='txt' bind:value={metadata.title}
        onchange={markMetadataChange} />
    </ConfigRow>
    <ConfigRow name={$_('ppty.language')}>
      <input type="text" class='txt' bind:value={metadata.language}
        onchange={markMetadataChange} />
    </ConfigRow>
    <ConfigRow name={$_('ppty.resolution')}>
      <NumberInput class='res' bind:value={metadata.width}
        min={1} max={10000}
        onchange={markMetadataChange}/>
      ×
      <NumberInput class='res' bind:value={metadata.height}
        min={1} max={10000}
        onchange={markMetadataChange}/>
      <button disabled={$loadState !== 'loaded'} onclick={async () => {
        Debug.assert(Playback.player?.videoSize !== undefined);
        Debug.assert(Playback.player?.sampleAspectRatio !== undefined);
        const [w, h] = Playback.player.videoSize;
        const sar = Playback.player.sampleAspectRatio;
        metadata.width = Math.round(w * sar);
        metadata.height = Math.round(h);
        await markMetadataChange();
      }}>
        {$_('ppty.match-video-resolution')}
      </button>
    </ConfigRow>

    <ConfigRow name={$_('ppty.scaling')}>
      <NumberInput class='res' bind:value={metadata.scalingFactor}
        step='any' min={0.01}
        onchange={markMetadataChange}/>
      <Tooltip text={$_('ppty.scaling-d')} />
    </ConfigRow>
  </ConfigTable>

  <h5>{$_('ppty.styles')}</h5>
  {#key updateCounter}
    {#each styles as style (style)}
      <div animate:flip={{duration: 200}}>
        <StyleEdit style={style} {subtitles}
          onsubmit={() => styles = Source.subs.styles}/>
      </div>
    {/each}
  {/key}
  <hr>
  <div class='hlayout'>
    <button onclick={newStyle}>
      <PlusIcon/>
    </button>
    <button onclick={manageSavedStyles}>
      <PackageOpenIcon/>
    </button>
    <button onclick={removeUnusedStyles}>
      {$_('ppty.remove-all-unused')}
    </button>
  </div>
</div>

<style lang='scss'>
  .txt {
    width: 100%;
  }
</style>
