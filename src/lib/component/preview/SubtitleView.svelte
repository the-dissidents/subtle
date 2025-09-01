<script lang="ts" module>
  export type EntryBox = {
    x: number, y: number,
    w: number, h: number, 
    ascent: number,
    style: SubtitleStyle,
    scale: number,
    text: string,
    font: string,
  };
</script>

<script lang="ts">
  import { onMount } from "svelte";

  import type { CanvasManager } from "../../CanvasManager";
  import type { SubtitleStyle } from "../../core/Subtitles.svelte";
  import { EventHost } from "../../details/EventHost";

  interface Props {
    manager?: CanvasManager,
    boxes: EntryBox[]
  }

  let {manager, boxes}: Props = $props();

  let width = $state(0);
  let height = $state(0);
  let transform = $state('scale(0.5)');
  let me = {};

  $effect(() => {
    if (manager) {
      [width, height] = manager.size;
      manager.onDisplaySizeChanged.bind(me, (w, h) => {
        width = w;
        height = h;
      });
      manager.onViewportChanged.bind(me, updateTransform);
    }
  });

  onMount(() => () => {
    EventHost.unbind(me);
  });

  function updateTransform() {
    transform = `scale(${manager!.scale}) translate(${-manager!.scroll[0]}px, ${-manager!.scroll[1]}px) scale(0.5)`;
  }
</script>

<div class="subview" style="width: {width}px; height: {height}px;">
  <div style="transform: {transform}; transform-origin: left top;">
  {#each boxes as box}
  {@const bold = box.style.styles.bold ? 'bold' : 'normal'}
  {@const italic = box.style.styles.italic ? 'italic' : 'normal'}
  {@const deco = ((box.style.styles.underline ? 'underline' : '')
                + (box.style.styles.strikethrough ? ' line-through' : ''))
              || 'none'}
  {@const outline = box.style.outline * 2 * box.scale}
  {@const shadow = box.style.shadow * box.scale}
    <div class="box" style="
      left: {box.x}px;
      top: {box.y}px;
      width: {box.w}px;
      height: {box.h}px;
    "></div>

    <!-- outline + shadow -->
    <div class="text" style="
      left: {box.x}px;
      top: {box.y}px;
      width: {box.w}px;
      height: {box.h}px;
      font: {box.font};
      font-weight: {bold};
      font-style: {italic};
      text-decoration: {deco};
      {outline > 0
        ? `color: ${box.style.outlineColor};
           -webkit-text-stroke-width: ${outline}px;
           -webkit-text-stroke-color: ${box.style.outlineColor};`
        : `color: ${box.style.color};`}
      {shadow > 0 
        ? `filter: drop-shadow(${shadow}px ${shadow}px 0 ${box.style.shadowColor});` 
        : ''}
    ">
      {box.text}
    </div>

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
    box-sizing: border-box;
    position: absolute;
    left: 3px;
    top: 3px;
    pointer-events: none;
    overflow: hidden;
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