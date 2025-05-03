<!-- TODO: OrderableList
 1. investigate that items fail to animate when dragging an item back and forth
 2. improve accessibility by providing keyboard control?
-->
<script lang="ts" generics="TItem extends WeakKey">
  import type { Snippet } from 'svelte';
  import { flip } from 'svelte/animate';
  import { Debug } from '../Debug';
  import type { Action } from 'svelte/action';
  import type { HTMLOlAttributes } from 'svelte/elements';

  type Props = {
    list: TItem[],
    row: Snippet<[item: TItem, i: number]>,
    /**
     * Footer of the list, e.g. an 'add item' button.
     */
    footer?: Snippet<[]>,
    /**
     * Fires when a list item is reordered by dragging its handle; more precisely, fires each time an item is dragged past another item.
     */
    onreorder?: () => void,
    /**
     * Fires when the reordering of a list item is finished, i.e. when the mouse is released.
     */
    onsubmit?: () => void
  } & HTMLOlAttributes;

  let { list = $bindable(), row, footer, onreorder, onsubmit, ...rest }: Props = $props();
  let itemToRow = new WeakMap<WeakKey, HTMLLIElement>;
  let draggingItem: TItem | undefined = $state(undefined);
  let draggingIndex = -1, draggingIndexStart = -1;

  const setupRow: Action<HTMLLIElement, WeakKey> = (node, item) => {
    $effect(() => {
      itemToRow.set(item, node);
    });
  };
</script>

<ol {...rest}>
  {#each list as item, i (item)}
    <li class="hlayout" 
      animate:flip={{ duration: () => draggingItem == item ? 0 : 200 }} 
      use:setupRow={item}
    >
      <div role="button" tabindex="0" class="handle" 
        onmousedown={(ev) => {
          const elem = ev.currentTarget.parentElement;
          Debug.assert(elem !== null);
          const rowRect = elem.getBoundingClientRect();
          const dragStart = ev.clientY;
          let transformOffsetStart = dragStart;
          draggingIndex = i;
          draggingIndexStart = i;
          const move = (ev2: MouseEvent) => {
            draggingItem = item;
            const deltay = ev2.clientY - dragStart;
            const newPos = rowRect.top + rowRect.height * 0.5 + deltay;
            if (deltay < 0 && draggingIndex > 0) {
              let prev = itemToRow.get(list[draggingIndex-1]);
              Debug.assert(prev !== undefined);
              const rect = prev.getBoundingClientRect();
              if (rect.top + rect.height * 0.5 > newPos) {
                // move up
                list.splice(draggingIndex, 1);
                list.splice(draggingIndex-1, 0, item);
                draggingIndex--;
                transformOffsetStart = ev.clientY + rect.top - rowRect.top;
                onreorder?.();
              }
            }
            if (deltay > 0 && draggingIndex < list.length - 1) {
              let next = itemToRow.get(list[draggingIndex+1]);
              Debug.assert(next !== undefined);
              const rect = next.getBoundingClientRect();
              if (rect.top + rect.height * 0.5 < newPos) {
                // move down
                list.splice(draggingIndex, 1);
                list.splice(draggingIndex+1, 0, item);
                draggingIndex++;
                transformOffsetStart = ev.clientY + rect.top - rowRect.top;
                onreorder?.();
              }
            }
            elem.style.transform = 
              `translate(0, ${ev2.clientY - transformOffsetStart}px)`;
          }
          document.addEventListener('mousemove', move);
          document.addEventListener('mouseup', () => {
            draggingItem = undefined;
            elem.style.transform = 'none';
            document.removeEventListener('mousemove', move);
            if (draggingIndex != draggingIndexStart)
              onsubmit?.();
          }, {once: true});
        }}
      ></div>
      {@render row(item, i)}
    </li>
  {/each}
  {#if footer !== undefined}
    <li>
      {@render footer()}
    </li>
  {/if}
</ol>

<style>
  ol {
    list-style: none;
    margin: 0;
    padding: 3px;
  }
  li {
    padding: 3px 0px;
  }
  .handle {
    display: inline-block;
    width: 8px;
    height: auto;
    margin: 3px;
    background-image: url("data:image/svg+xml;charset=utf8,<svg xmlns='http://www.w3.org/2000/svg' version='1.1' height='4px' width='4px'><circle cx='2' cy='2' r='1' fill='gray' /></svg>");
    background-repeat: repeat;
    background-size: 4px;
    cursor: grab;
  }
</style>