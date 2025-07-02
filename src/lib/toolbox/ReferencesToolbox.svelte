<script lang="ts">
import { PencilLineIcon } from '@lucide/svelte';
import { _ } from 'svelte-i18n';
import { Reference, type ReferenceSource } from '../frontend/References';
import Collapsible from '../ui/Collapsible.svelte';
    import { guardAsync } from '../frontend/Frontend';
    import { Debug } from '../Debug';

let keyword = $state('');
let currentSource = $state<ReferenceSource>();
let params = new Map<string, string>();
let sources = Reference.sources;
let iframe = $state<HTMLIFrameElement>();

function query() {
  guardAsync(async () => {
    Debug.assert(currentSource !== undefined);
    Debug.assert(iframe !== undefined);
    const html = await Reference.fetch(currentSource, { keyword, variables: params });
    iframe.srcdoc = html;
  }, $_('msg.error-when-querying-reference-source'))
}
</script>

<div class='vlayout fill'>
  <div class='hlayout'>
    <input type="text" class='flexgrow' bind:value={keyword} />
    <button onclick={query}
            disabled={currentSource === undefined || keyword.trim().length == 0}>
      {$_('refs.query')}
    </button>
  </div>
  <div class='hlayout'>
    <select class='flexgrow' bind:value={currentSource}>
      {#each $sources as source}
        <option value={source}>{source.name}</option>
      {/each}
    </select>
    <button>
      <PencilLineIcon />
    </button>
  </div>
  {#if currentSource && currentSource.variables.length > 0}
  <Collapsible header={$_('refs.parameters')}>
    <table class="config">
      <tbody>
      {#each currentSource.variables as {name, defaultValue}}
        <tr>
          <td>{name}</td>
          <td>
            <input type='text'
              value={params.has(name) ? params.get(name) : defaultValue}
              onchange={(ev) => params.set(name, ev.currentTarget.value)} />
          </td>
        </tr>
      {/each}
      </tbody>
    </table>
  </Collapsible>
  {/if}
  <iframe title="reference" class='flexgrow' bind:this={iframe}>
  </iframe>
</div>

<style>
  iframe {
    margin-top: 5px;
    border-radius: 4px;
    border: 1px solid gray;
  }
</style>