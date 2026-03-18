<script lang="ts">
import DialogBase from '../DialogBase.svelte';
import { onMount } from 'svelte';

import { _ } from 'svelte-i18n';

interface Props {
  args: [/*...*/],
  close: (ret: void /*...*/) => void
}

let {
  args: _args, close
}: Props = $props();

let inner: DialogBase;

onMount(async () => {
  /* insert preparation here */
  await inner.showModal!();
  /* insert processing here */
  close(/*...*/);
});
</script>

<DialogBase bind:this={inner}>
  {#snippet header()}
    <h3><!-- dialog title --></h3>
  {/snippet}

  <!-- content here -->
</DialogBase>
