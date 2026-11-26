<script lang="ts">
  import { Debug } from "../../Debug";

  import { Memorized } from "../../config/MemorizedValue.svelte";
  import { Playback } from "../../frontend/Playback";
  import { Frontend, focusablePanel } from "../../frontend/Frontend";

  import { PreviewLayout } from "./Layout";
  import { MediaPlayerInterface } from "./MediaPlayer";
  import type { LineBox } from "./SubtitleRenderer";

  import SubtitleView from "./SubtitleView.svelte";
  import TimestampInput from "../../TimestampInput.svelte";
  import { Popup } from "@the_dissidents/svelte-ui";

  import { PauseIcon, PlayIcon, Volume2Icon } from "@lucide/svelte";
  import { onMount } from "svelte";
  import { _ } from "svelte-i18n";
  import * as z from "zod/v4-mini";

  const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3, 4] as const;

  let volume = Memorized.$('playbackVolume', z.number().check(z.gt(0)).check(z.lt(1)), 0.8);
  volume.subscribe((x) => void Playback.player?.setVolume(x));

  let playbackRate = Memorized.$('playbackRate', z.number().check(z.gte(0.25)).check(z.lte(4)), 1);
  playbackRate.subscribe((x) => void Playback.player?.setPlaybackRate(x));

  let isPlaying = $state(false);
  let playPosStart = $state(0);
  let playPosEnd = $state(1);
  let playPos = $state(0);
  let playPosInput = $state(0);
  let loadState = Playback.loadState;
  let uiFocus = Frontend.uiFocus;
  let layout = $state<PreviewLayout>();
  let boxes = $state<LineBox[]>([]);

  let volumePopup: Popup;

  let canvas: HTMLCanvasElement;
  let overlay = $state<HTMLElement>();

  onMount(() => {
    Debug.assert(!!canvas);
    Debug.assert(!!overlay);
    layout = new PreviewLayout(canvas, overlay);
    layout.subsRenderer.onLayoutChanged.bind(layout, (x) => {boxes = x});
  });

  const me = {};

  Playback.onLoaded.bind(me, () => {
    playPosStart = Playback.player!.startTime;
    playPosEnd = Playback.player!.startTime + Playback.duration;
    playPos = Playback.position;
    void Playback.player!.setVolume($volume);
    void Playback.player!.setPlaybackRate($playbackRate);
  });

  let lastUiPosUpdate = 0;
  Playback.onPositionChanged.bind(me, () => {
    const now = performance.now();
    if (Playback.isPlaying && now - lastUiPosUpdate < 66) return;
    lastUiPosUpdate = now;
    playPos = $loadState == 'loaded' ? Playback.position : 0;
    playPosInput = Playback.position;
  });

  MediaPlayerInterface.onPlayStateChanged.bind(me, () => {
    isPlaying = Playback.isPlaying;
    if (!isPlaying) {
      playPos = $loadState == 'loaded' ? Playback.position : 0;
      playPosInput = Playback.position;
    }
  });
</script>

<Popup bind:this={volumePopup} style="padding: 0; display: flex">
  <input type="range" class="volume flexgrow"
    min="0" max="1" step="any"
    value={$volume}
    oninput={(x) => $volume = x.currentTarget.valueAsNumber}/>
</Popup>



<div class="vlayout fill area"
  class:focused={$uiFocus == 'Preview'}
  {@attach focusablePanel('Preview')}
>
  <div class='player-container fixminsize'>
    <canvas class="fill" bind:this={canvas}></canvas>
    <SubtitleView bind:element={overlay} manager={layout?.manager} {boxes}/>
  </div>

  <!-- video playback controls -->
  <div class='hlayout'>
    <button aria-label="play/pause"
      disabled={$loadState !== 'loaded'}
      onclick={() => Playback.toggle()}>
      {#if isPlaying}
        <PauseIcon />
      {:else}
        <PlayIcon />
      {/if}
    </button>
    <input type='range' class='play-pointer flexgrow'
      step="any" min={playPosStart} max={playPosEnd}
      bind:value={playPos}
      disabled={$loadState !== 'loaded'}
      oninput={async () => {
        if ($loadState !== 'loaded') {
          playPos = 0;
          return;
        }
        await Playback.setPosition(playPos, {imprecise: true});
      }}/>
    <button onclick={(e) => {
      const self = e.currentTarget;
      const rect = self.getBoundingClientRect();
      volumePopup.openAt(rect.left, rect.bottom, 100);
    }} disabled={$loadState !== 'loaded'}>
      <Volume2Icon />
    </button>
    <select class="speed-select"
      aria-label={$_('preview.playback-speed')}
      title={$_('preview.playback-speed')}
      disabled={$loadState !== 'loaded'}
      value={$playbackRate}
      onchange={(e) => $playbackRate = Number(e.currentTarget.value)}
    >
      {#each PLAYBACK_RATES as rate (rate)}
        <option value={rate}>{rate}x</option>
      {/each}
    </select>
    <TimestampInput bind:timestamp={playPosInput}
      tight={true}
      disabled={$loadState !== 'loaded'}
      onchange={() => Playback.setPosition(playPosInput)}/>
  </div>
</div>

<style lang='scss'>
@media (prefers-color-scheme: light) {
  canvas {
    background-color: gray;
  }
}

@media (prefers-color-scheme: dark) {
  canvas {
    background-color: black;
  }
}

.area {
  overflow: hidden;
}

.player-container {
  position: relative;
  min-height: 0;
  min-width: 0;
  height: 100%;
  padding-bottom: 3px;
}

canvas {
  display: block; /* to get rid of extra spacing at the bottom */
  box-sizing: border-box;
}

.hlayout {
  gap: 3px;
}

.volume {
  padding: 3px;

  &::-webkit-slider-thumb {
    -webkit-appearance: none;
    height: 10px;
    width: 10px;
  }

  &::-webkit-slider-runnable-track {
    height: 6px;
  }
}

.speed-select {
  font-variant-numeric: tabular-nums;
}
</style>
