<script lang="ts" module>
let dialogs = new Map<number, HTMLDialogElement>();
let setChanged = new EventHost();
</script>

<script lang="ts">
import { _ } from "svelte-i18n";
import { Debug } from "../Debug";
import { XIcon } from "@lucide/svelte";
import type { DialogButton } from "../DialogBase.svelte";
import { EventHost } from "../details/EventHost";
import { onDestroy } from "svelte";

let dialog: HTMLDialogElement | undefined = $state();
let closed = false;
let bottomMargin = $state('2em');
let transform = $state('translateX(200%)');
let id = 0;

interface Props {
  text: string,
  open?: boolean,
  style?: 'normal' | 'error',
  buttons?: DialogButton[],
  onSubmit?: (x: string) => void
}

let me = {};
onDestroy(() => EventHost.unbind(me));
setChanged.bind(me, () => {
  const diags = [...dialogs.entries()].filter((x) => x[0] < id);
  const sum = diags.reduce((a, b) => a + b[1].offsetHeight, 0);
  const result = `calc(${sum}px + ${diags.length + 2}em)`;
  bottomMargin = result;
});

let {
  onSubmit,
  open = $bindable(),
  style = 'normal',
  buttons = [],
  text
}: Props = $props();

$effect(() => {
  if (open) {
    Debug.assert(dialog !== undefined);
    id = dialogs.size;
    closed = false;
    dialogs.set(id, dialog);
    setChanged.dispatch();
    transform = 'none';
    dialog.show();
  }
});

</script>

<dialog
  bind:this={dialog}
  {open}
  class={[style]}
  style:bottom={bottomMargin}
  style:transform={transform}
  onclose={() => {
    if (!closed) onSubmit?.('');
    dialogs.delete(id);
    setChanged.dispatch();
    transform = 'translateX(200%)';
    open = false;
  }}
>
<form class='vlayout' method="dialog">
  <p>{text}</p>
  {#if buttons?.length}
    <div class="buttons">
    {#each buttons as btn (btn)}
      <button type="submit" class="noborder"
        disabled={typeof btn.disabled == 'function' 
          ? btn.disabled() 
          : (btn.disabled ?? false)}
        onclick={() => {closed = true; onSubmit?.(btn.name)}}
      >
        {btn.localizedName()}
      </button>
    {/each}
    </div>
  {:else}
    <button type="submit" class="close noborder" onclick={() => {closed = true; onSubmit?.('')}}>
      <XIcon />
    </button>
  {/if}
</form>
</dialog>

<style>
@media (prefers-color-scheme: light) {
  dialog {
    box-shadow: 2px 4px 10px gray;
  }
}

@media (prefers-color-scheme: dark) {
  dialog {
    box-shadow: 2px 4px 10px black;
    background-color: var(--uchu-yin-6);
    color: var(--uchu-yang);
  }
}

dialog {
  position: absolute;
  margin-right: 2em;
  padding: 1.2em 1.7em;
  border-radius: 0.3em;
  border: none;
  z-index: 100;
  transition:
    transform 0.15s ease-in,
    bottom 0.1s ease-in,
    display 0.5s allow-discrete,
    overlay 0.5s allow-discrete;
}

p {
  margin: 0;
}

.error p {
  font-weight: bold;
}

.buttons {
  text-align: right;
  transform: translate(0.5em, 0.5em);
}

button {
  box-shadow: none;
  text-transform: uppercase;
  padding: 0.5em 0.8em;
  font-size: 90%;
}

.error {
  background-color: var(--uchu-red-4);
  color: var(--uchu-yang);
  & button {
    color: var(--uchu-yang);
  }
  & button:hover {
    background-color: var(--uchu-red-3) !important;
  }
}

.close {
  position: absolute;
  right: 0.2em;
  top: 0.2em;
  padding: 0.3em;
}
</style>