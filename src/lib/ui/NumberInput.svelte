<script lang="ts">
  import type { ChangeEventHandler, HTMLInputAttributes } from "svelte/elements";

  interface Props extends HTMLInputAttributes {
    value: number,
    onchange?: ChangeEventHandler<HTMLInputElement>
  };

  let { value = $bindable<number>(), onchange, ...rest }: Props = $props();
</script>

<input type="number" value={value} {...rest}
  onchange={(ev) => {
    if (ev.currentTarget.validity.valid) {
      value = ev.currentTarget.valueAsNumber;
      onchange?.(ev);
    } else {
      ev.currentTarget.value = value.toString();
    }
  }} />