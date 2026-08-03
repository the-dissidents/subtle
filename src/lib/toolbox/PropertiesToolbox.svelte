<script lang="ts">
import { Debug } from '../Debug';
import { SavedStyles } from '../config/SavedStyles';
import { SubtitleStyle } from '../core/Subtitles.svelte';
import { SubtitleTools, SubtitleUtil } from '../core/SubtitleUtil.svelte';

import { AsyncEventHost, ConfigRow, ConfigTable, NumberInput, showInputPopup, Tooltip } from "@the_dissidents/svelte-ui";
import StyleEdit from '../StyleEdit.svelte';

import { EventHost } from '@the_dissidents/svelte-ui';
import { Playback } from '../frontend/Playback';
import { ChangeType, Source } from '../frontend/Source';

import { onDestroy } from 'svelte';
import { flip } from 'svelte/animate';
import { _ } from 'svelte-i18n';
import { Menu } from '@tauri-apps/api/menu';
import { PackageOpenIcon, PlusIcon, Trash2Icon } from '@lucide/svelte';

let metadata = $state(Source.subs.metadata);
let styles = $state(Source.subs.styles);
let subtitles = $state(Source.subs);
let updateCounter = $state(0);
let adjustButton = $state<HTMLButtonElement>();

let loadState = Playback.loadState;

const me = {};
onDestroy(() => {
  EventHost.unbind(me);
  AsyncEventHost.unbind(me);
});

let videoSize = $state<[number, number]>();
let videoFramerate = $state<number>();

Source.onSubtitleObjectReload.bind(me, () => {
  metadata = Source.subs.metadata;
  styles = Source.subs.styles;
  subtitles = Source.subs;
  updateCounter += 1;
});

Playback.onLoaded.bind(me, () => {
  Debug.assert(Playback.player?.videoSize !== undefined);
  Debug.assert(Playback.player?.sampleAspectRatio !== undefined);
  const [w, h] = Playback.player.videoSize;
  const sar = Playback.player.sampleAspectRatio;
  videoSize = [w * sar, h];
  videoFramerate = Playback.player.frameRate;
});

Playback.onClose.bind(me, () => {
  videoSize = undefined;
  videoFramerate = undefined;
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
        items: [ {
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
        } ],
      }))
      : [{
        text: $_('msg.no-saved-styles'),
        enabled: false
      }]
  })).popup();
}

async function doAdjust(from: number, to: number) {
  SubtitleUtil.shiftTimes(Source.subs, { scale: to / from });
  metadata.framerate = to;
  await Source.markChanged(ChangeType.Times, $_('c.transform-times'));
}

async function adjustFramerate() {
  await (await Menu.new({
    items: [
      {
        text: '从字幕帧率调整至视频帧率',
        enabled: !!videoFramerate && videoFramerate !== metadata.framerate,
        action() {
          Debug.assert(!!metadata.framerate && !!videoFramerate);
          void doAdjust(metadata.framerate, videoFramerate);
        }
      },
      {
        text: '从字幕帧率调整至其它帧率',
        // eslint-disable-next-line @typescript-eslint/no-misused-promises
        async action() {
          Debug.assert(!!metadata.framerate);
          const value = await showInputPopup(adjustButton!, '输入新帧率',
            { validate: (s) => isFinite(parseFloat(s)) });
          if (!value) return;
          await doAdjust(metadata.framerate, parseFloat(value));
        }
      }
    ]
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
      <NumberInput bind:value={metadata.width}
        min={1} max={10000}
        onchange={markMetadataChange}/>
      ×
      <NumberInput bind:value={metadata.height}
        min={1} max={10000}
        onchange={markMetadataChange}/>

      {let matches = $derived(videoSize
        && videoSize[0] == metadata.width && videoSize[1] == metadata.height)}
      <button
        disabled={$loadState != 'loaded' || matches}
        onclick={async () => {
          Debug.assert(!!videoSize);
          metadata.width = videoSize[0];
          metadata.height = videoSize[1];
          await markMetadataChange();
        }}>
        {matches ? $_('ppty.already-matched-video-resolution'): $_('ppty.match-video-resolution')}
      </button>
    </ConfigRow>

    <ConfigRow name={$_('ppty.framerate')}>
      {#if metadata.framerate}
        <NumberInput bind:value={metadata.framerate}
          step='any' min={1} max={200} style='max-width: 12ch'
          onchange={markMetadataChange}/>
        <button onclick={() => {
          metadata.framerate = null;
          void markMetadataChange();
        }}>
          <Trash2Icon/>
        </button>
      {:else}
        <button onclick={() => {
          metadata.framerate = videoFramerate ?? 24;
          void markMetadataChange();
        }}>
          {$_('ppty.framerate-unset')}
        </button>
      {/if}

      {let matches = $derived(!!metadata.framerate && !!videoFramerate
        && metadata.framerate == videoFramerate)}
      <button disabled={$loadState != 'loaded' || matches}
        onclick={async () => {
          Debug.assert(!!videoFramerate);
          metadata.framerate = videoFramerate;
          await markMetadataChange();
        }}>
        {matches ? $_('ppty.already-matched-video-framerate'): $_('ppty.match-video-framerate')}
      </button>

      <button disabled={!metadata.framerate} onclick={adjustFramerate} bind:this={adjustButton}>
        {$_('ppty.adjust-framerate')}
      </button>
    </ConfigRow>

    <ConfigRow name={$_('ppty.scaling')}>
      <NumberInput bind:value={metadata.scalingFactor}
        step='any' min={0.01} style='max-width: 12ch'
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
