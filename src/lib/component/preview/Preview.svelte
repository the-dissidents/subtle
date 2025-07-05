<script lang="ts">
  import { PauseIcon, PlayIcon } from "@lucide/svelte";
  import { Playback } from "../../frontend/Playback";
  import TimestampInput from "../../TimestampInput.svelte";
  import { PreviewLayout } from "./Layout";
  import { MediaPlayerInterface } from "./MediaPlayer";

  let isPlaying = $state(false);
  let playPos = $state(0);
  let playPosInput = $state(0);
  let isMediaLoaded = Playback.isLoaded;

  const setup = (canvas: HTMLCanvasElement) => {
    new PreviewLayout(canvas);
  };

  const me = {};

  Playback.onPositionChanged.bind(me, () => {
    playPos = $isMediaLoaded ? Playback.position / Playback.duration : 0;
    playPosInput = Playback.position;
  });

  MediaPlayerInterface.onPlayStateChanged.bind(me, () => {
    isPlaying = Playback.isPlaying;
  });
</script>

<div class="vlayout fill">
  <div class='player-container fixminsize'>
    <canvas class="fill" use:setup></canvas>
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