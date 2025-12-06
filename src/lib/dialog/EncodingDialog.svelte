<script lang="ts">
import type { AnalyseResult, EncodingName } from 'chardet';
import { Debug } from "../Debug";
import { MAPI } from '../API';
import DialogBase from '../DialogBase.svelte';

import { onMount } from 'svelte';
import { _ } from 'svelte-i18n';

interface Props {
  args: [path: string, source: Uint8Array, result: AnalyseResult],
  close: (ret: {decoded: string, encoding: EncodingName} | null) => void
}

let { args, close }: Props = $props();
let [path, source, result] = args;
let inner: DialogBase;

onMount(async () => {
  Debug.assert(inner !== undefined);
  candidates = result;
  if (candidates.length > 0) {
    selectedEncoding = candidates[0].name;
    makePreview();
  }
  let btn = await inner.showModal!();
  if (btn !== 'ok' || !selectedEncoding)
    return close(null);
  
  close({
    encoding: selectedEncoding, 
    decoded: await MAPI.decodeFile(path, selectedEncoding)
  });
});

let selectedEncoding: EncodingName | undefined = $state();
let okDisabled = $state(false);
let preview = $state('');
let candidates: AnalyseResult | undefined = $state();

async function makePreview() {
  if (selectedEncoding && source) {
    try {
      preview = (await MAPI.decodeFile(path, selectedEncoding)).substring(0, 6000);
      okDisabled = false;
    } catch (e) {
      Debug.warn(e);
      preview = '';
      okDisabled = true;
    }
  } else {
    preview = '';
    okDisabled = true;
  }
}
</script>

<DialogBase bind:this={inner} maxWidth="35em"
  buttons={[{
    name: 'cancel',
    localizedName: () => $_('cancel')
  }, {
    name: 'ok', 
    localizedName: () => $_('ok'), 
    disabled: () => okDisabled
  }]}
>
  {#snippet header()}
  <h4>{$_('encodingdialog.header')}</h4>
  {/snippet}
  <p>{$_('encodingdialog.info')}</p>
  <div class='hlayout'>
    <table class='data'>
      <thead>
      <tr>
        <th></th>
        <th>{$_('encodingdialog.encoding')}</th>
        <th>{$_('encodingdialog.confidence')}</th>
      </tr>
      </thead>
      <tbody>
      {#if candidates && candidates.length > 0}
        {#each candidates as c, i (c)}
        <tr class={{
          important: c.confidence == 100, 
          unimportant: c.confidence < 20 
            || (i > 0 && candidates[0].confidence == 100)
        }}>
          <td class="right">
            <input type="radio" value={c.name}
              bind:group={selectedEncoding}
              onchange={() => makePreview()}>
          </td>
          <td class="middle">{c.name}</td>
          <td class="right">{c.confidence}%</td>
        </tr>
        {/each}
      {:else}
        <tr>
          <td colspan="3">
            {$_('encodingdialog.unable-to-guess-encoding')}
          </td>
        </tr>
      {/if}
      </tbody>
    </table>
    <textarea class="flexgrow" readonly>{preview}</textarea>
  </div>
  <p>{$_('encodingdialog.conclusion')}</p>
</DialogBase>

<style>
  h4 {
    font-size: 100%;
    font-weight: bold;
    margin: 1em 0 0;
  }
  textarea {
    resize: none;
    height: auto;
  }
  table {
    margin-right: 5px;
  }
  .important {
    font-weight: bold;
  }
  .unimportant {
    color: gray;
  }
  .right {
    text-align: right;
  }
  .middle {
    padding-right: 10px;
  }
</style>