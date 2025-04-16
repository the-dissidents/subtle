<script lang="ts">
import { tick } from "svelte";
import { _ } from 'svelte-i18n';
import { Debug } from "./Debug";
import { DialogHandler, Dialogs } from "./frontend/Dialogs";

export type DialogButton = {
  name: string,
  localizedName: () => string,
  disabled?: boolean | (() => boolean)
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
  maxWidth = '40em',
  header,
  children,
  buttons = [{
    name: 'cancel',
    localizedName: () => $_('cancel')
  }, {
    name: 'ok',
    localizedName: () => $_('ok')
  }],
}: Props = $props();

let dialog: HTMLDialogElement | undefined = $state();
let dialogBody: HTMLDivElement | undefined = $state();
let cx: number, cy: number, ox: number, oy: number;
let posx: number = $state(0), posy: number = $state(0);
let shadow = $state(false);

function makeCenter() {
  Debug.assert(dialog !== undefined);
  posx = (window.innerWidth - dialog.clientWidth) / 2;
  posy = (window.innerHeight - dialog.clientHeight) / 2;
}

function checkScroll() {
  Debug.assert(dialogBody !== undefined);
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
Debug.assert(handler !== null);
handler.showModal = async () => {
  return new Promise((r) => {
    resolve = (btn) => {
      Debug.debug('dialog returning', btn);
      r(btn);
      if (dialog?.open) dialog?.close();
      resolve = undefined;
    };
    Debug.assert(dialog !== undefined);
    Debug.assert(!dialog.open);
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
  tabindex="-1"
  style="top: {posy}px; left: {posx}px; max-width: {maxWidth};"
  onclose={() => {
    resolve?.('');
    Dialogs.modalOpenCounter--;
  }}
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
        disabled={typeof btn.disabled == 'function' 
          ? btn.disabled() 
          : (btn.disabled ?? false)}
        onclick={() => {
          Debug.assert(resolve !== undefined);
          resolve(btn.name);
        }}
      >{btn.localizedName()}</button>
    {/each}
  </footer>
</div>
</dialog>

<style>
  @media (prefers-color-scheme: light) {
    dialog {
      box-shadow: 0 0 10px gray;
    }
    dialog::backdrop {
      background: rgba(0, 0, 0, 0.3);
    }
    .shadow {
      box-shadow: 0px 10px 10px 10px #555;
    }
    footer {
      background-color: var(--uchu-yin-2);
    }
  }

  @media (prefers-color-scheme: dark) {
    dialog {
      box-shadow: 0 0 10px black;
      background-color: var(--uchu-yin-9);
      color: var(--uchu-yang);
    }
    dialog::backdrop {
      background: rgba(0, 0, 0, 0.3);
    }
    .shadow {
      box-shadow: 0px 10px 10px 10px #ccc;
    }
    footer {
      background-color: var(--uchu-yin-8);
    }
  }

  dialog {
    border-radius: 0.3em;
    border: none;
    margin: 0;
    padding: 0;
    position: absolute;
    /* transform: translate(-50%, -50%); */
    z-index: 100;
    max-height: 80vh;
  }
  dialog[open] {
    animation: zoom 0.2s ease-out;
  }
  dialog[open]::backdrop {
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
  header {
    padding: 1em 1.5em 1px;
  }
  dialog .body {
    padding: 0 1.5em 1em;
    box-sizing: border-box;
    overflow-y: auto;
  }
  footer {
    padding: 1em 1.5em 1em;
    text-align: right;
  }
  .submit {
    padding: 4px 6px;
    margin-left: 5px;
  }
</style>
