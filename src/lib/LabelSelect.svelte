<script lang="ts">
import { LABEL_TYPES, type LabelType } from "./core/Labels";
import { LabelColor } from "./Theming.svelte";

import { _ } from 'svelte-i18n';

interface Props {
  disabled?: boolean;
  stretch?: boolean;
  value: LabelType;
  onsubmit?: (style: LabelType) => void;
}

let { disabled = false, stretch = false, value = $bindable(), onsubmit }: Props = $props();
</script>

<select tabindex='-1' disabled={disabled}
  bind:value={value}
  onchange={() => onsubmit?.(value)}
  class={{stretch}}
  style={`background-color: ${LabelColor(value)}`}
>
  {#each LABEL_TYPES as color}
    <option value={color}>{$_(`label.${color}`)}</option>
  {/each}
</select>


<style>
  .stretch {
    width: 100%;
  }
</style>
