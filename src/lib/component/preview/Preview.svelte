<script lang="ts">
  import { PauseIcon, PlayIcon } from "@lucide/svelte";
  import type { Action } from "svelte/action";
  import { Debug } from "../../Debug";
  import { Playback } from "../../frontend/Playback";
  import TimestampInput from "../../TimestampInput.svelte";
  import { PreviewLayout } from "./Layout";
  import { MediaPlayerInterface } from "./MediaPlayer";

  

  let videoCanvas: HTMLCanvasElement | undefined = $state();
  let isPlaying = $state(false);
  let playPos = $state(0);
  let playPosInput = $state(0);

  let isMediaLoaded = Playback.isLoaded;

  const setup: Action = () => {
    Debug.assert(videoCanvas !== undefined);
    new PreviewLayout(videoCanvas);
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

<!-- video player -->
<div class='player-container' use:setup>
  <canvas width="0" height="0" bind:this={videoCanvas}></canvas>
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

<style>
@media (prefers-color-scheme: light) {
  .player-container canvas {
    background-color: lightgray;
  }
}

@media (prefers-color-scheme: dark) {
  .player-container canvas {
    background-color: black;
  }
}

.player-container {
  width: 100%;
  height: 100%;
  padding: 3px;
}

.player-container canvas {
  width: 100%;
  height: 100%;
  display: block; /* to get rid of extra spacing at the bottom */
  box-sizing: border-box;
}
</style>