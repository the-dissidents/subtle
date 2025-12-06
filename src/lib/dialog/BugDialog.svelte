<script lang="ts">
import DialogBase from '../DialogBase.svelte';
import { onMount } from 'svelte';
import { _ } from 'svelte-i18n';
import { openPath, openUrl } from '@tauri-apps/plugin-opener';
import { appLogDir } from '@tauri-apps/api/path';

interface Props {
  args: [],
  close: (ret: void) => void
}

let {
  args: _args, close
}: Props = $props();

let inner: DialogBase;

onMount(async () => {
  await inner.showModal!();
  close();
});
</script>

<DialogBase bind:this={inner} buttons={[{
  name: 'close',
  localizedName: () => $_('ok')
}]}>
  {#snippet header()}
    <h3>{$_('bugdialog.header')}</h3>
  {/snippet}

  <!-- eslint-disable-next-line svelte/no-at-html-tags -->
  <p class="bugs">{@html $_('bugdialog.p1')}</p>
  <button onclick={async () => openPath(await appLogDir())}>{$_('bugdialog.open-log-directory')}</button>
  <p>{$_('bugdialog.p2')}</p>
  <button onclick={async () => openUrl('https://github.com/the-dissidents/subtle/issues')}>{$_('bugdialog.view-issues')}</button>
  <button onclick={async () => openUrl('https://github.com/the-dissidents/subtle/issues/new?template=%E9%97%AE%E9%A2%98%E6%8A%A5%E5%91%8A---bug-report.md')}>{$_('bugdialog.create-issue')}</button>
  <p></p>
</DialogBase>

<style>
  @media (prefers-color-scheme: light) {
    :global(.bugs code) {
      background-color: var(--uchu-blue-1);
    }
  }

  @media (prefers-color-scheme: dark) {
    :global(.bugs code) {
      background-color: var(--uchu-blue-8);
    }
  }

  :global(.bugs code) {
    margin-left: 2px;
    margin-right: 2px;
    border-radius: 0.5lh;
    padding: 1px 4px;
    user-select: text;
    -webkit-user-select: text;
    cursor: text;
  }
</style>