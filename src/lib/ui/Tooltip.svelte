<script lang="ts">
import { Debug } from '../Debug';

export type TooltipPosition = 'top' | 'bottom' | 'left' | 'right';
interface Props {
  position?: TooltipPosition;
  text?: string;
  children?: import('svelte').Snippet;
  // TODO: add delay parameter
}

let { position = 'top', text = '<Tooltip>', children }: Props = $props();
let id = $props.id();
let container: HTMLElement | undefined = $state();
let tooltip: HTMLElement | undefined = $state();

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

function computePosition(rect: DOMRect, pos: TooltipPosition): [number, number] {
  const offset = 5;
  switch (pos) {
    case 'top':
      return [rect.left + rect.width  / 2, rect.top - offset];
    case 'bottom':
      return [rect.left + rect.width / 2, rect.bottom + offset];
    case 'left':
      return [rect.left - offset, rect.top + rect.height /2];
    case 'right':
      return [rect.right + offset, rect.top + rect.height /2];
    default:
      Debug.never(pos);
  }
}

function setPosition() {
  if (!tooltip) return;
  Debug.assert(container !== undefined);
  const rect = findBoundingRect(container);
  const [x, y] = computePosition(rect, position);
  tooltip.style.left = `${Math.round(x)}px`;
  tooltip.style.top = `${Math.round(y)}px`;
}
</script>

<style>
  @media (prefers-color-scheme: light) {
    .tooltip {
      background-color: var(--uchu-yin);
      color: var(--uchu-yang);
      box-shadow: 2px 5px 10px -3px rgba(0,0,0,0.4);
    }
  }
  @media (prefers-color-scheme: dark) {
    .tooltip {
      background-color: var(--uchu-yin-2);
      color: var(--uchu-yin);
      box-shadow: 2px 5px 10px -3px rgba(255, 255, 255, 0.4);
    }
  }

  .tooltip {
    text-align: center;
    font-size: 0.85rem;
    line-height: 1.25;

    border: none;
    border-radius: 6px;
    max-width: 200px;
    padding: 6px 8px;
    margin: 0;
    position: absolute;

    transition: opacity 0.2s;
    opacity: 0;

    &:popover-open {
      opacity: 1;
      @starting-style {
        & {
          opacity: 0;
        }
      }
    }
  }

  .right {
    transform: translate(0%, -50%);
  }
  .left {
    transform: translate(-100%, -50%);
  }
  .top {
    transform: translate(-50%, -100%);
  }
  .bottom {
    transform: translate(-50%, 0);
  }
</style>

<div bind:this={container}
  role="group"
  aria-describedby={`${id}-tooltip`}
  onmouseenter={() => {
    setPosition();
    tooltip?.showPopover();
  }}
  onmouseleave={() => tooltip?.hidePopover()}
  style="display: contents;"
>
  {@render children?.()}
</div>
{#if text != ''}
<span popover bind:this={tooltip}
  role="tooltip"
  id={`${id}-tooltip`}
  class='tooltip {position}'>{text}</span>
{/if}