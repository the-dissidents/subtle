<script lang="ts">
  import { onMount } from "svelte";
  import * as Color from "colorjs.io/fn";

  import type { CanvasManager } from "../../CanvasManager";
  import { EventHost } from "../../details/EventHost";
  import { MediaConfig } from "./Config";
  import type { LineBox } from "./SubtitleRenderer";
  import { toCSSStyle, type Line } from "../../details/TextLayout";

  interface Props {
    manager?: CanvasManager,
    element?: HTMLElement,
    boxes: LineBox[]
  }

  let { manager, boxes, element = $bindable() }: Props = $props();

  let width = $state(0);
  let height = $state(0);
  let transform = $state(`scale(${1/devicePixelRatio})`);
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
    transform = `scale(${manager!.scale}) translate(${-manager!.scroll[0]}px, ${-manager!.scroll[1]}px) scale(${1/devicePixelRatio})`;
  }

  function cloneEvent<E extends Event>(e: E): E {
    // @ts-expect-error
    return new e.constructor(e.type, e);
  }
</script>

{#snippet line(line: Line)}
  <!-- {#if MediaConfig.data.showBoundingBoxes}
    <div class="origin"></div>
  {/if} -->
  {#each line.chunks as word, i}
    {#each word.chunks as chunk}
    {@const css = toCSSStyle(chunk.format)}
      <span style="
        font: {css.font};
        text-decoration: {css.textDecoration};
        width: {chunk.width}px;
      ">{chunk.text}</span>
    {/each}
    {#if i < line.chunks.length - 1}
      <span style="width: {word.spaceWidth}px; height: 1lh;"></span>
    {/if}
  {/each}
{/snippet}

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="subview" style="width: {width}px; height: {height}px;"
  bind:this={element}
>
  <div style="transform: {transform}; transform-origin: left top;">
  {#each boxes as box (box)}
  {@const outline = box.style.outline * 2 * box.scale}
  {@const shadow = box.style.shadow * box.scale}
  {@const color = Color.serialize(box.style.color)}
  {@const outlineColor = Color.serialize(box.style.outlineColor)}
  {@const shadowColor = Color.serialize(box.style.shadowColor)}
    <div class="box" style="
      left: {box.x}px;
      top: {box.y}px;
      width: {box.line.width}px;
      height: {box.line.height}px;
      border: {MediaConfig.data.showBoundingBoxes ? '0.5px solid white' : 'none'};
    ">
      <!-- outline + shadow -->
      <div class="text" style="
        {outline > 0
          ? `color: ${outlineColor};
            -webkit-text-stroke-width: ${outline}px;
            -webkit-text-stroke-color: ${outlineColor};`
          : `color: ${color};`}
        {shadow > 0 
          ? `filter: drop-shadow(${shadow}px ${shadow}px 0 ${shadowColor});` 
          : ''}
      ">
        {@render line(box.line)}
      </div>

      <!-- text -->
      <div class="text" style="
        color: {color};
      ">
        {@render line(box.line)}
      </div>
    </div>
  {/each}
  </div>
</div>

<style>
  .subview {
    box-sizing: border-box;
    position: absolute;
    left: 0;
    top: 0;
    overflow: hidden;
    pointer-events: none;
  }

  .text {
    position: absolute;
    left: 0;
    top: 0;
    box-sizing: content-box;
    white-space: pre;
    display: flex;
    flex-direction: row;
    font-synthesis: style;
    /* align-items: baseline; */
  }

  .box {
    position: absolute;
    box-sizing: content-box;
  }
</style>