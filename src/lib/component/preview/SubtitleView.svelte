<script lang="ts" module>
  export type EntryBox = {
    x: number, y: number,
    w: number, h: number, 
    ascent: number,
    style: SubtitleStyle,
    text: string,
    font: string,
  };
</script>

<script lang="ts">
  import type { CanvasManager } from "../../CanvasManager";
  import type { SubtitleStyle } from "../../core/Subtitles.svelte";

  interface Props {
    manager?: CanvasManager,
    disabled?: boolean,
    boxes: EntryBox[]
  }

  let {manager, disabled = false, boxes}: Props = $props();

  let width = $state(0);
  let height = $state(0);
  let transform = $state('scale(0.5)');

  $effect(() => {
    if (manager) {
      [width, height] = manager.size;
      manager.onDisplaySizeChanged.bind(manager, (w, h) => {
        width = w;
        height = h;
      });
      manager.onViewportChanged.bind(manager, updateTransform);
    }
  })

  function updateTransform() {
    transform = `scale(${manager!.scale}) translate(${-manager!.scroll[0]}px, ${-manager!.scroll[1]}px) scale(0.5)`;
  }
</script>

<div class={{disabled, subview: true}} style="width: {width}px; height: {height}px;">
  <div style="transform: {transform}; transform-origin: left top;">
  {#each boxes as box}
  {@const bold = box.style.styles.bold ? 'bold' : 'normal'}
  {@const italic = box.style.styles.italic ? 'italic' : 'normal'}
  {@const deco = ((box.style.styles.underline ? 'underline' : '')
                + (box.style.styles.strikethrough ? ' line-through' : ''))
              || 'none'}
    <div class="box" style="
      left: {box.x}px;
      top: {box.y}px;
      width: {box.w}px;
      height: {box.h}px;
    "></div>

    <!-- outline -->
    {#if box.style.outline > 0}
    <div class="text" style="
      left: {box.x}px;
      top: {box.y}px;
      width: {box.w}px;
      height: {box.h}px;
      color: {box.style.outlineColor || 'black'};
      font: {box.font};
      font-weight: {bold};
      font-style: {italic};
      text-decoration: {deco};
      -webkit-text-stroke-width: {box.style.outline / devicePixelRatio * 2}px;
      -webkit-text-stroke-color: {box.style.outlineColor || 'black'};
    ">
      {box.text}
    </div>
    {/if}

    <!-- text -->
    <div class="text" style="
      left: {box.x}px;
      top: {box.y}px;
      width: {box.w}px;
      height: {box.h}px;
      color: {box.style.color};
      font: {box.font};
      font-weight: {bold};
      font-style: {italic};
      text-decoration: {deco};
    ">
      {box.text}
    </div>
  {/each}
  </div>
</div>

<style>
  .subview {
    display: block; /* to get rid of extra spacing at the bottom */
    box-sizing: border-box;
    position: absolute;
    left: 3px;
    top: 3px;
    pointer-events: none;
    overflow: hidden;
  }

  .disabled {
    display: none;
  }

  .text {
    position: absolute;
    box-sizing: border-box;
    white-space: pre;
  }

  .box {
    position: absolute;
    box-sizing: border-box;
    border: 1px solid white;
  }
</style>