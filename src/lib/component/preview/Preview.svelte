<script lang="ts">
  import { PauseIcon, PlayIcon, Volume2Icon } from "@lucide/svelte";
  import { Playback } from "../../frontend/Playback";
  import TimestampInput from "../../TimestampInput.svelte";
  import { PreviewLayout } from "./Layout";
  import { MediaPlayerInterface2 } from "./MediaPlayer2";
  import SubtitleView, { type EntryBox } from "./SubtitleView.svelte";
  import { MediaConfig } from "./Config";
  import Popup, { type PopupHandler } from "../../ui/Popup.svelte";
  import { Memorized } from "../../config/MemorizedValue.svelte";
  import { z } from "zod/v4-mini";

  let volume = Memorized.$('playbackVolume', z.number().check(z.gt(0)).check(z.lt(1)), 0.8);
  volume.subscribe((x) => Playback.player?.setVolume(x));

  let isPlaying = $state(false);
  let playPos = $state(0);
  let playPosInput = $state(0);
  let loadState = Playback.loadState;
  let layout = $state<PreviewLayout>();
  let volumePopup = $state<PopupHandler>({});

  let boxes = $state<EntryBox[]>([]);

  const setup = (canvas: HTMLCanvasElement) => {
    layout = new PreviewLayout(canvas);
    layout.subsRenderer.getBoxes.bind(layout, (x) => {boxes = x});
  };

  const me = {};

  Playback.onPositionChanged.bind(me, () => {
    playPos = $loadState == 'loaded' ? Playback.position / Playback.duration : 0;
    playPosInput = Playback.position;
  });

  MediaPlayerInterface2.onPlayStateChanged.bind(me, () => {
    isPlaying = Playback.isPlaying;
  });
</script>

<Popup bind:handler={volumePopup} style="padding: 0; display: flex">
  <input type="range" class="volume flexgrow"
    min="0" max="1" step="any"
    value={$volume}
    oninput={(x) => $volume = x.currentTarget.valueAsNumber}/>
</Popup>

<div class="vlayout fill">
  <div class='player-container fixminsize'>
    <canvas class="fill" use:setup></canvas>
    {#if MediaConfig.data.subtitleRenderer == 'dom'}
      <SubtitleView manager={layout?.manager} {boxes}/>
    {/if}
    {#if MediaConfig.data.showDebug}
      <label style="position: absolute; left: 0; bottom: 0;">
        <input type="checkbox" checked={MediaConfig.data.subtitleRenderer == 'dom'}
          onchange={(x) => {
            if (x.currentTarget.checked)
              MediaConfig.data.subtitleRenderer = 'dom';
            else
              MediaConfig.data.subtitleRenderer = 'canvas';
            layout?.manager.requestRender();
          }}/>
        dom
      </label>
    {/if}
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
      step="any" max="1" min="0"
      disabled={$loadState !== 'loaded'}
      bind:value={playPos}
      oninput={() => {
        if ($loadState !== 'loaded') {
          playPos = 0;
          return;
        }
        Playback.setPosition(playPos * Playback.duration, {imprecise: true});
      }}/>
    <button onclick={(e) => {
      const self = e.currentTarget;
      const rect = self.getBoundingClientRect();
      volumePopup.openAt?.(rect.left, rect.bottom, 100);
    }} disabled={$loadState !== 'loaded'}>
      <Volume2Icon />
    </button>
    <TimestampInput bind:timestamp={playPosInput}
      disabled={$loadState !== 'loaded'}
      onchange={() => Playback.setPosition(playPosInput)}/>
  </div>
</div>

<style>
@media (prefers-color-scheme: light) {
  canvas {
    background-color: lightgray;
  }
}

@media (prefers-color-scheme: dark) {
  canvas {
    background-color: black;
  }
}

.player-container {
  position: relative;
  min-height: 0;
  min-width: 0;
  height: 100%;
  padding: 3px;
}

canvas {
  display: block; /* to get rid of extra spacing at the bottom */
  box-sizing: border-box;
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
</style>