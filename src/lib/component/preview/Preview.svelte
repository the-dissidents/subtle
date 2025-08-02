<script lang="ts">
  import { PauseIcon, PlayIcon } from "@lucide/svelte";
  import { Playback } from "../../frontend/Playback";
  import TimestampInput from "../../TimestampInput.svelte";
  import { PreviewLayout } from "./Layout";
  import { MediaPlayerInterface2 } from "./MediaPlayer2";
  import SubtitleView, { type EntryBox } from "./SubtitleView.svelte";
  import { MediaConfig } from "./Config";

  let isPlaying = $state(false);
  let playPos = $state(0);
  let playPosInput = $state(0);
  let isMediaLoaded = Playback.isLoaded;
  let layout = $state<PreviewLayout>();

  let boxes = $state<EntryBox[]>([]);

  const setup = (canvas: HTMLCanvasElement) => {
    layout = new PreviewLayout(canvas);
    layout.subsRenderer.getBoxes.bind(layout, (x) => {boxes = x});
  };

  const me = {};

  Playback.onPositionChanged.bind(me, () => {
    playPos = $isMediaLoaded ? Playback.position / Playback.duration : 0;
    playPosInput = Playback.position;
  });

  MediaPlayerInterface2.onPlayStateChanged.bind(me, () => {
    isPlaying = Playback.isPlaying;
  });
</script>

<div class="vlayout fill">
  <div class='player-container fixminsize'>
    <canvas class="fill" use:setup></canvas>
    {#if MediaConfig.data.subtitleRenderer == 'dom'}
      <SubtitleView manager={layout?.manager} {boxes}/>
    {/if}
    {#if MediaConfig.data.showDebug}
      <label style="position: absolute; left: 0; top: 0;">
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
      onclick={() => Playback.toggle()}>
      {#if isPlaying}
        <PauseIcon />
      {:else}
        <PlayIcon />
      {/if}
    </button>
    <input type='range' class='play-pointer flexgrow'
      step="any" max="1" min="0"
      disabled={!$isMediaLoaded}
      bind:value={playPos}
      oninput={() => {
        if (!$isMediaLoaded) {
          playPos = 0;
          return;
        }
        Playback.setPosition(playPos * Playback.duration, {imprecise: true});
      }}/>
    <TimestampInput bind:timestamp={playPosInput}
      disabled={!$isMediaLoaded}
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
  min-height: 0;
  min-width: 0;
  height: 100%;
  padding: 3px;
}

canvas {
  display: block; /* to get rid of extra spacing at the bottom */
  box-sizing: border-box;
}
</style>