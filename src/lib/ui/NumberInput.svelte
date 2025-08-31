<script lang="ts">
  import type { ChangeEventHandler, HTMLInputAttributes } from "svelte/elements";

  interface Props extends HTMLInputAttributes {
    value: number,
    width?: string,
    onchange?: ChangeEventHandler<HTMLInputElement>
  };

  let { value = $bindable(), width, onchange, ...rest }: Props = $props();
</script>

<input type="number" value={value}
  style={width ? `width: ${width};` : ''}
  onchange={(ev) => {
    if (ev.currentTarget.value !== '' && ev.currentTarget.validity.valid) {
      value = ev.currentTarget.valueAsNumber;
      onchange?.(ev);
    } else {
      ev.currentTarget.value = value.toString();
    }
  }} {...rest}/>

<style>
  input {
    font-family: var(--monospaceFontFamily);
  }
</style>