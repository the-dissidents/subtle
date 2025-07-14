<script lang="ts" module>
export type ReferencesHandler = {
  readonly query: (term?: string) => void;
  readonly focus: () => void;
};
</script>

<script lang="ts">
import { PencilLineIcon } from '@lucide/svelte';
import { _ } from 'svelte-i18n';
import Collapsible from '../ui/Collapsible.svelte';
import { Reference, type ReferenceSource } from '../frontend/References';
import { Frontend, guardAsync } from '../frontend/Frontend';
import { Toolboxes } from '../frontend/Toolboxes';
import { Dialogs } from '../frontend/Dialogs';
import { Memorized } from '../config/MemorizedValue.svelte';
import * as z from 'zod/v4-mini';

let keyword = $state('');
let params = new Map<string, string>();
let sources = Reference.sources;
let currentSourceName = Memorized.$('currentReferenceSource', z.string(), '');
let currentSource = $state<ReferenceSource>();
let iframe = $state<HTMLIFrameElement>();
let input = $state<HTMLInputElement>();

let toolboxFocus = Frontend.toolboxFocus;

const handler: ReferencesHandler = {
  query(term?: string) {
    if (term) keyword = term;
    if ($toolboxFocus !== 'references') $toolboxFocus = 'references';
    guardAsync(async () => {
      const k = keyword.trim();
      if (currentSource === undefined || iframe === undefined || k.length == 0) return;
      Frontend.setStatus($_('msg.querying-source', {values: {source: currentSource.name}}));
      await Reference.displayInFrame(currentSource, { keyword: k, variables: params }, iframe);
      Frontend.setStatus($_('msg.query-successful'));
    }, $_('msg.error-when-querying-reference-source'))
  },
  focus() {
    $toolboxFocus = 'references';
    setTimeout(() => input?.focus(), 0);
  },
};
Toolboxes.references = handler;

currentSourceName.subscribe((x) => {
  const s = $sources.find((a) => a.name == x);
  if (s) currentSource = s;
});
</script>

<div class='vlayout fill'>
  <div class='hlayout'>
    <input type="text" class='flexgrow' bind:value={keyword} bind:this={input}
      onkeydown={(ev) => {
        if (ev.key == 'Enter') handler.query();
      }} />
    <button onclick={() => handler.query()}
            disabled={currentSource === undefined || keyword.trim().length == 0}>
      {$_('refs.query')}
    </button>
  </div>
  <div class='hlayout'>
    <select class='flexgrow' bind:value={currentSource} 
            onchange={() => currentSourceName.set(currentSource!.name)}>
      {#each $sources as source}
        <option value={source}>{source.name}</option>
      {/each}
    </select>
    <button onclick={() => Dialogs.referenceSources.showModal!()}>
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
              oninput={(ev) => params.set(name, ev.currentTarget.value)} />
          </td>
        </tr>
      {/each}
      </tbody>
    </table>
  </Collapsible>
  {/if}
  <iframe sandbox="allow-same-origin" title="reference" class='flexgrow' bind:this={iframe}>
  </iframe>
</div>

<style>
  iframe {
    margin-top: 5px;
    border-radius: 4px;
    border: 1px solid gray;
  }
</style>