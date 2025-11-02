<script lang="ts">
import type { Snippet } from 'svelte';
import { Debug } from '../Debug';
    import type { HTMLAttributes } from 'svelte/elements';

export type PopupHandler = {
  open?: (rect: {
    left: number, top: number, width?: number, height?: number,
    popupWidth?: number, popupHeight?: number
  }) => void;
  openAt?: (x: number, y: number, w?: number, h?: number) => void;
  close?: () => void;
  isOpen?: () => boolean;
};

export type TooltipPosition = 'top' | 'bottom' | 'left' | 'right';

interface Props extends HTMLAttributes<HTMLSpanElement> {
  handler: PopupHandler;
  kind?: 'panel' | 'tooltip';
  maxWidth?: string;
  position?: TooltipPosition;
  onclose?: () => void;
  children?: Snippet;
}

let { 
  position = 'top', kind = 'panel', maxWidth = '200px',
  handler = $bindable(), onclose, children, ...rest
}: Props = $props();

let id = $props.id();
let transformClass = $state('');
let isOpen = false;
let tooltip: HTMLElement | undefined = $state();

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

handler.open = ({left, top, width = 0, height = 0, popupHeight, popupWidth}) => {
  Debug.assert(tooltip !== undefined);
  const [x1, y1] = computePosition(new DOMRect(left, top, width, height), position);
  tooltip.style.left = `${Math.round(x1)}px`;
  tooltip.style.top = `${Math.round(y1)}px`;
  tooltip.style.width = popupWidth ? `${popupWidth}px` : '';
  tooltip.style.height = popupHeight ? `${popupHeight}px` : '';
  transformClass = position;
  tooltip.showPopover();
};

handler.openAt = (x, y, w, h) => {
  Debug.assert(tooltip !== undefined);
  tooltip.style.left = `${x}px`;
  tooltip.style.top = `${y}px`;
  tooltip.style.width = w ? `${w}px` : '';
  tooltip.style.height = h ? `${h}px` : '';
  transformClass = '';
  tooltip.showPopover();
};

handler.close = () => {
  Debug.assert(tooltip !== undefined);
  if (!isOpen) return Debug.early();
  tooltip.hidePopover();
};

handler.isOpen = () => isOpen;
</script>

<style>
  @media (prefers-color-scheme: light) {
    .tooltip {
      background-color: var(--uchu-yin);
      color: var(--uchu-yang);
      box-shadow: 1px 3px 10px -3px rgba(0,0,0,0.4);
    }
    .panel {
      background-color: var(--uchu-yang);
      color: var(--uchu-yin);
      box-shadow: 1px 3px 10px -3px rgba(0,0,0,0.4);
    }
  }
  @media (prefers-color-scheme: dark) {
    .tooltip {
      background-color: var(--uchu-yin-2);
      color: var(--uchu-yin);
      box-shadow: 1px 3px 10px -3px rgba(255, 255, 255, 0.4);
    }
    .panel {
      background-color: var(--uchu-yin-9);
      color: var(--uchu-yang);
      box-shadow: 1px 3px 10px -1px rgba(0,0,0,0.4);
    }
  }

  .popup {
    border: none;
    border-radius: 6px;
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

  .tooltip {
    text-align: start;
    white-space: pre-wrap;
    font-size: 0.85rem;
    line-height: 1.25;
  }

  .panel {
    font-size: 0.85rem;
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

<span popover="auto" bind:this={tooltip}
  style="max-width: {maxWidth};"
  role="tooltip"
  id={`${id}-tooltip`}
  class='popup {kind} {transformClass}'
  ontoggle={(e) => {
    isOpen = e.newState == 'open';
    if (!isOpen) onclose?.();
  }}
  {...rest}
>
  {@render children?.()}
</span>
