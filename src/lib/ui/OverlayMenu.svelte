<script lang="ts">
import type { Action } from "svelte/action";
import { Debug } from "../Debug";

let dialog: HTMLDialogElement | undefined = $state();
let closed = false;

interface Props {
  items: { text: string, disabled?: boolean }[],
  rememberedItem?: string,
  text?: string,
  emptyText?: string,
  title?: string,
  onSubmit: (x: number) => void
}

let {
  onSubmit,
  rememberedItem, emptyText,
  items, text = '', title = '',
}: Props = $props();

$effect(() => {
  Debug.assert(dialog !== undefined);
  dialog.showModal();
});

const autofocus: Action<HTMLButtonElement, string> = (node, text) => {
  $effect(() => {
    if (text == rememberedItem)
      node.focus();
  });
};

</script>

<dialog
  bind:this={dialog}
  tabindex="-1"
  onclose={() => {
    if (!closed) onSubmit(-1);
  }}
>
  {#if title}
    <h4>{title}</h4>
  {/if}
  {#if text}
    <p>{text}</p>
  {/if}
  <div class='vlayout'>
    {#each items as item, i}
      <button class="noborder"
        type="submit"
        tabindex="0"
        disabled={item.disabled ?? false}
        onclick={() => {closed = true; onSubmit(i)}}
        use:autofocus={item.text}
      >
        {item.text}
      </button>
    {:else}
    {#if emptyText}
      <button class="noborder" disabled={true}>
        {emptyText}
      </button>
    {/if}
    {/each}
  </div>
</dialog>

<style>
  @media (prefers-color-scheme: light) {
    dialog {
      box-shadow: 0 0 10px gray;
    }
  }

  @media (prefers-color-scheme: dark) {
    dialog {
      box-shadow: 0 0 10px black;
      background-color: var(--uchu-yin-9);
      color: var(--uchu-yang);
    }
  }
  dialog::backdrop {
    background: rgba(0, 0, 0, 0.3);
  }

  dialog {
    border-radius: 0.3em;
    border: none;
    margin: 0;
    padding: 5px 15px;
    z-index: 100;
    max-height: 80vh;

    position: absolute;
    top: 50%;
    left: 50%;
    /* Use transform to offset the dialog by half its own width and height */
    transform: translate(-50%, -50%);
  }

  dialog[open] {
    animation: zoom 0.2s ease-out;
  }
  dialog[open]::backdrop {
    animation: fade 0.2s ease-out;
  }
  @keyframes zoom {
    from { transform: translate(-50%, -50%) scale(0.95); }
    to { transform: translate(-50%, -50%) scale(1); }
  }
  @keyframes fade {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  h4 {
    margin: 10px 0 10px 0;
  }
  div {
    list-style: none;
    padding: 0 0 10px 0;
    min-width: 10em;
  }

  button {
    box-shadow: none;
    text-align: start;
    border-radius: 0;
    border-bottom: 1px solid gray;
  }
  button:focus {
    outline: 2px solid color-mix(in oklab, var(--uchu-blue-3), transparent);
  }
</style>