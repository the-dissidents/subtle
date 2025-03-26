<script lang="ts">
import { tick } from "svelte";
import { assert } from "./Basic";
import { DialogHandler, Dialogs } from "./frontend/Dialogs";
import { _ } from 'svelte-i18n';

export type DialogButton = {
  name: string,
  localizedName: string,
  disabled?: boolean
};

interface Props {
  handler: DialogHandler<void, string>;
  centerWhenOpen?: boolean;
  maxWidth?: string;
  header?: import('svelte').Snippet;
  children?: import('svelte').Snippet;
  buttons?: DialogButton[];
}

let {
  handler = $bindable(),
  maxWidth = '32em',
  header,
  children,
  buttons = [{
    name: 'cancel',
    localizedName: $_('cancel')
  }, {
    name: 'ok',
    localizedName: $_('ok')
  }],
}: Props = $props();

let dialog: HTMLDialogElement | undefined = $state();
let dialogBody: HTMLDivElement | undefined = $state();
let cx: number, cy: number, ox: number, oy: number;
let posx: number = $state(0), posy: number = $state(0);
let shadow = $state(false);

function makeCenter() {
  assert(dialog !== undefined);
  posx = (window.innerWidth - dialog.clientWidth) / 2;
  posy = (window.innerHeight - dialog.clientHeight) / 2;
}

function checkScroll() {
  assert(dialogBody !== undefined);
  shadow = dialogBody.scrollHeight - dialogBody.scrollTop > dialogBody.clientHeight + 10;
}

function startDrag(ev: MouseEvent) {
  cx = ev.clientX;
  cy = ev.clientY;
  ox = posx; oy = posy;
  let handler1 = (ev: MouseEvent) => {
    posx = ox + ev.clientX - cx;
    posy = oy + ev.clientY - cy;
  };
  let handler2 = () => {
    document.removeEventListener('mousemove', handler1);
    document.removeEventListener('mouseup', handler2);
  };
  document.addEventListener('mousemove', handler1);
  document.addEventListener('mouseup', handler2);
}

let resolve: ((btn: string) => void) | undefined;
assert(handler !== null);
handler.showModal = async () => {
  return new Promise((r) => {
    resolve = (btn) => {
      r(btn);
      dialog?.close();
      resolve = undefined;
    };
    assert(dialog !== undefined);
    assert(!dialog.open);
    dialog.showModal();
    tick().then(() => {
      makeCenter();
      checkScroll();
    });
    Dialogs.modalOpenCounter++;
  });
}
</script>
  
<dialog
  bind:this={dialog}
  class='modal'
  style="top: {posy}px; left: {posx}px; max-width: {maxWidth};"
  onclose={() => Dialogs.modalOpenCounter--}
>
<div class='vlayout'>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <header onmousedown={(ev) => startDrag(ev)}>
    {@render header?.()}
  </header>
  <div class='body' bind:this={dialogBody} 
     onscroll={() => checkScroll()}
  >
    {@render children?.()}
  </div>
  <footer class={{shadow}}>
    {#each buttons as btn}
      <button 
        class='submit'
        disabled={btn.disabled ?? false}
        onclick={() => {
          assert(resolve !== undefined);
          resolve(btn.name);
        }}
      >{btn.localizedName}</button>
    {/each}
  </footer>
</div>
</dialog>

<style>
  dialog {
    border-radius: 0.3em;
    border: none;
    margin: 0;
    padding: 0;
    box-shadow: 0 0 10px gray;
    position: absolute;
    /* transform: translate(-50%, -50%); */
    z-index: 100;
    max-height: 80vh;
  }
  dialog[open] {
    animation: zoom 0.2s ease-out;
  }
  dialog.modal::backdrop {
    background: rgba(0, 0, 0, 0.3);
  }
  dialog.modal[open]::backdrop {
    animation: fade 0.2s ease-out;
  }
  @keyframes zoom {
    from { transform: scale(0.95); }
    to { transform: scale(1); }
  }
  @keyframes fade {
    from { opacity: 0; }
    to { opacity: 1; }
  }
  dialog > div {
    max-height: 80vh;
  }
  /* hr {
    border: 1px solid gray;
    margin: 10px 0 10px 0;
  } */
  header {
    /* cursor: move; */
    padding: 1em 1.5em 1px;
    /* box-shadow: 0 -10px 10px 10px gray; */
  }
  dialog .body {
    padding: 0 1.5em 1em;
    box-sizing: border-box;
    overflow-y: auto;
  }
  footer {
    padding: 1em 1.5em 1em;
    text-align: right;
    background-color: rgb(226, 226, 226);
  }
  .shadow {
    box-shadow: 0px 10px 10px 10px #555;
  }
  .submit {
    padding: 4px 6px;
    margin-left: 5px;
  }
</style>
