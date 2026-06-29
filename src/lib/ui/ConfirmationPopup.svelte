<script lang="ts" module>
  export function showConfirmationPopup(element: Element, prompt: string) {
    return new Promise<boolean>((resolve) => {
      const component = mount(ConfirmationPopup, {
        props: {
          element, prompt,
          onSubmit: async (x: boolean) => {
            await unmount(component);
            resolve(x);
          }
        },
        target: document.body
      });
    });
  }
</script>

<script lang="ts">
  import ConfirmationPopup from "./ConfirmationPopup.svelte";

  import { Popup, type TooltipPosition } from "@the_dissidents/svelte-ui";
  import { mount, onMount, unmount } from "svelte";
  import { _ } from "svelte-i18n";

  let { element, position = 'bottom', prompt, onSubmit }: {
    element: Element,
    position?: TooltipPosition,
    prompt: string,
    onSubmit: (ok: boolean) => void
  } = $props();

  let popup: Popup;

  onMount(() => {
    popup.open(element.getBoundingClientRect());
  });
</script>

<Popup bind:this={popup} {position} onclose={() => onSubmit(false)}>
  <button onclick={() => {
    onSubmit(true);
  }}>{prompt}</button>
</Popup>
