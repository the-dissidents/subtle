<script lang="ts">
import { type AnalyseResult, type EncodingName } from 'chardet';
import * as iconv from 'iconv-lite';

import { assert } from '../Basic';
import type { DialogHandler } from '../frontend/Dialogs';
import DialogBase from '../DialogBase.svelte';

import { _ } from 'svelte-i18n';

interface Props {
  handler: DialogHandler<
    {source: Uint8Array, result: AnalyseResult}, 
    {decoded: string, encoding: EncodingName} | null>;
}

let {
  handler = $bindable(),
}: Props = $props();

let inner: DialogHandler<void, string> = {};
  handler.showModal = async ({source: s, result}) => {
  assert(inner !== undefined);
  source = s;
  candidates = result;
  if (candidates.length > 0) {
    selectedEncoding = candidates[0].name;
    makePreview();
  }
  let btn = await inner.showModal!();
  if (btn !== 'ok' || !selectedEncoding) return null;
  return {
    encoding: selectedEncoding, 
    decoded: iconv.decode(source, selectedEncoding)
  };
}

let selectedEncoding: EncodingName | undefined = $state();
let okDisabled = $state(false);
let preview = $state('');
let source: Uint8Array;
let candidates: AnalyseResult | undefined = $state();

function makePreview() {
  if (selectedEncoding && source) {
    try {
      preview = iconv.decode(
        source.subarray(0, Math.min(6000, source.length)), selectedEncoding);
      okDisabled = false;
    } catch {
      preview = '';
      okDisabled = true;
    }
  } else {
    preview = '';
    okDisabled = true;
  }
}
</script>

<DialogBase handler={inner} maxWidth={'35em'}
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
    <table>
      <thead>
      <tr>
        <th></th>
        <th>{$_('encodingdialog.encoding')}</th>
        <th>{$_('encodingdialog.confidence')}</th>
      </tr>
      </thead>
      <tbody>
      {#if candidates && candidates.length > 0}
        {#each candidates as c, i}
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
  th {
    background-color: var(--uchu-yin-1);
    border-collapse: collapse;
    border-spacing: 0;
    text-transform: uppercase;
    color: var(--uchu-yin-6);
    font-size: 85%;
  }
  th, td {
    border: none;
    margin: 0;
    padding: 0 5px;
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