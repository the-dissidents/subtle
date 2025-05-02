<script lang="ts">
import { Debug } from '../Debug';

export type PopupHandler = {
  open?: (rect: {left: number, top: number, width?: number, height?: number}) => void;
  close?: () => void;
  isOpen?: () => boolean;
};

export type TooltipPosition = 'top' | 'bottom' | 'left' | 'right';
interface Props {
  handler: PopupHandler;
  position?: TooltipPosition;
  children?: import('svelte').Snippet;
  // TODO: add delay parameter
}

let { position = 'top', children, handler = $bindable() }: Props = $props();
let id = $props.id();
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

handler.open = ({left, top, width = 0, height = 0}) => {
  Debug.assert(tooltip !== undefined);
  const [x1, y1] = computePosition(new DOMRect(left, top, width, height), position);
  tooltip.style.left = `${Math.round(x1)}px`;
  tooltip.style.top = `${Math.round(y1)}px`;
  tooltip.showPopover();
  isOpen = true;
};

handler.close = () => {
  Debug.assert(tooltip !== undefined);
  if (!isOpen) return Debug.early('popup already open');
  tooltip.hidePopover();
  isOpen = false;
};

handler.isOpen = () => isOpen;
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

<span popover bind:this={tooltip}
  role="tooltip"
  id={`${id}-tooltip`}
  class='tooltip {position}'
>
  {@render children?.()}
</span>
