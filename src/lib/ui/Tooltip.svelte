<script lang="ts">
import type { Snippet } from 'svelte';
import { Debug } from '../Debug';
import Popup, { type PopupHandler } from './Popup.svelte';
import { CircleHelpIcon } from '@lucide/svelte';

export type TooltipPosition = 'top' | 'bottom' | 'left' | 'right';
interface Props {
  position?: TooltipPosition;
  text?: string;
  children?: Snippet;
  // TODO: add delay parameter
}

let { position = 'top', text = '<Tooltip>', children }: Props = $props();
let handler: PopupHandler = $state({});
let container: HTMLElement | undefined = $state();

function findBoundingRect(element: HTMLElement): DOMRect {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let foundVisibleChild = false;
  for (const child of element.children) {
    if (child instanceof HTMLElement) {
      const isVisuallyRendered = 
           child.offsetWidth > 0 
        || child.offsetHeight > 0 
        || child.getClientRects().length > 0;

      if (isVisuallyRendered) {
        const rect = child.getBoundingClientRect();

        // Ensure the rect has actual dimensions before including it
        if (rect.width > 0 || rect.height > 0) {
             minX = Math.min(minX, rect.left);
             minY = Math.min(minY, rect.top);
             maxX = Math.max(maxX, rect.right);
             maxY = Math.max(maxY, rect.bottom);
             foundVisibleChild = true;
        }
      }
    }
  }

  // If no visible children with dimensions were found, return a zero rect.
  if (!foundVisibleChild) {
     return new DOMRect(0, 0, 0, 0);
  }

  const width = maxX - minX;
  const height = maxY - minY;
  return new DOMRect(minX, minY, width, height);
}
</script>

<div bind:this={container}
  class="tooltip-container"
  role="group"
  onmouseenter={() => {
    Debug.assert(container !== undefined);
    const rect = findBoundingRect(container);
    handler.open!(rect);
  }}
  onmouseleave={() => handler.close!()}
  style="display: contents;"
>
  {#if children}
    {@render children?.()}
  {:else}
    <span>
      <CircleHelpIcon />
    </span>
  {/if}
</div>
<Popup style='tooltip' bind:handler={handler} {position}>
  <div class="content">
    {text}
  </div>
</Popup>

<style>
  :global(.tooltip-container > span > .lucide) {
    display: inline;
    stroke-width: 1.5px; 
    /* margin: 0 3px 0 3px; */
    max-height: 16px;
    color: gray;
    vertical-align: middle;
  }

  .content {
    font-weight: normal;
    text-transform: none;
  }

  /* :global(.tooltip-container:first-child > span > .lucide) {
    margin: 0 3px 0 0;
  }
  :global(.tooltip-container:last-child > span > .lucide) {
    margin: 0 0 0 3px;
  } */
</style>