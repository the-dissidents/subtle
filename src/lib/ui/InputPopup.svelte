<script lang="ts" module>
  function getBoundary(element: Element) {
    while (!(element instanceof HTMLDialogElement)
        && !(element instanceof HTMLBodyElement)
        && !(element instanceof HTMLElement && element.popover)
        && element.parentElement)
    {
      element = element.parentElement;
    }
    return element;
  }

  export function showInputPopup(element: Element, prompt: string, options?: {
    validate?: (s: string) => boolean,
    position?: TooltipPosition,
  }) {
    return new Promise<string | null>((resolve) => {
      const component = mount(InputPopup, {
        props: {
          element, prompt,
          validate: options?.validate,
          position: options?.position,
          onSubmit: async (x) => {
            await unmount(component);
            resolve(x ?? null);
          }
        },
        target: getBoundary(element)
      });
    });
  }
</script>

<script lang="ts">
  import InputPopup from "./InputPopup.svelte";

  import { Popup, type TooltipPosition } from "@the_dissidents/svelte-ui";
  import { mount, onMount, unmount } from "svelte";
  import { _ } from "svelte-i18n";

  let { element, position = 'bottom', prompt, value = '', validate, onSubmit }: {
    element: Element,
    position?: TooltipPosition,
    prompt: string,
    value?: string,
    validate?: (s: string) => boolean,
    onSubmit: (result?: string) => void
  } = $props();

  let invalid = $derived(!(validate?.(value) ?? true));
  let popup: Popup, input: HTMLInputElement;

  onMount(() => {
    popup.open(element.getBoundingClientRect());
    input.focus();
  });
</script>

<Popup bind:this={popup} {position} onclose={() => onSubmit()}>
  <label>
    <span>{prompt}</span>
    <input bind:this={input} type='text' bind:value class:invalid onkeydown={(e) => {
      if (e.key == 'Enter' && !invalid) {
        onSubmit(value);
      }
    }} />
  </label>
  <div class="hlayout">
    <span class="flexgrow"></span>
    <button disabled={invalid} onclick={() => {
      onSubmit(value);
    }}>{$_('ok')}</button>
  </div>
</Popup>

<style>
  label {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  input.invalid {
    background-color: lightpink;
  }

  button {
    margin-top: 10px;
  }
</style>
