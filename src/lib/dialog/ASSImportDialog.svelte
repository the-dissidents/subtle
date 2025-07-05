<script lang="ts">
import DialogBase from '../DialogBase.svelte';
import type { ASSParser, ASSParseWarning } from '../core/ASS.svelte';
import type { DialogHandler } from '../frontend/Dialogs';
import { groupBy, type GroupedBy } from '../details/GroupBy';
import { CircleAlertIcon, CircleCheckIcon } from '@lucide/svelte';
import { Debug } from '../Debug';

import { _ } from 'svelte-i18n';
import Tooltip from '../ui/Tooltip.svelte';

interface Props {
  handler: DialogHandler<ASSParser, boolean>;
}

let {
  handler = $bindable(),
}: Props = $props();

let inner: DialogHandler<void> = {};
let parser = $state<ASSParser>();
let warningGroups = $state<GroupedBy<ASSParseWarning, 'type'>>();
let nInvalid = $state(0);
let nUnsupported = $state(0);

handler.showModal = async (p) => {
  parser = p;
  parse();
  Debug.assert(inner !== undefined);
  let btn = await inner.showModal!();
  return btn == 'ok';
}

function parse() {
  Debug.assert(parser !== undefined);
  parser.parse();
  nInvalid = parser.warnings.filter((x) => x.category == 'invalid').length;
  nUnsupported = parser.warnings.filter((x) => x.category == 'unsupported').length;
  warningGroups = groupBy(parser.warnings, 'type');
}
</script>

<DialogBase handler={inner}>
  {#snippet header()}
  <h4>{$_('assimportdialog.header')}</h4>
  {/snippet}

  <div class="hlayout">
    <div class="left">
      <ul class="ass-import-warnings">
      {#if warningGroups}
        {#if Object.entries(warningGroups).length == 0}
        <li class='ok'>
          <CircleCheckIcon />
          {$_('assimportdialog.no-problems')}
        </li>
        {/if}

        {#if 'duplicate-style-definition' in warningGroups}
        <li>
          <CircleAlertIcon />
          {$_('assimportdialog.duplicate-style-definition')}
          <ul>
            {#each warningGroups['duplicate-style-definition'] as w}
              <li><code>{w.name}</code></li>
            {/each}
          </ul>
        </li>
        {/if}
        {#if 'undefined-style' in warningGroups}
        <li>
          <CircleAlertIcon />
          {$_('assimportdialog.undefined-style')}
          <ul>
            {#each warningGroups['undefined-style'] as w}
              <li><code>{w.name}</code></li>
            {/each}
          </ul>
        </li>{/if}
        {#if 'no-styles' in warningGroups}
        <li>
          <CircleAlertIcon />
          {$_('assimportdialog.no-styles')}
        </li>
        {/if}
        {#if 'invalid-style-field' in warningGroups}
        <li>
          <CircleAlertIcon />
          {$_('assimportdialog.invalid-style-field')}
          <ul>
            {#each warningGroups['invalid-style-field'] as w}
              <li>
                {$_('assimportdialog.in-a-b-equals-c', {values: {a: w.name, b: w.field, c: w.value}})}
              </li>
            {/each}
          </ul>
        </li>
        {/if}
        {#if 'invalid-event-field' in warningGroups}
        <li>
          <CircleAlertIcon />
          {$_('assimportdialog.invalid-style-field')}
          <ul>
            {#each warningGroups['invalid-event-field'] as w}
              <li>
                {$_('assimportdialog.in-line-a-b-equals-c', {values: {a: w.line, b: w.field, c: w.value}})}
              </li>
            {/each}
          </ul>
        </li>
        {/if}

        {#if nInvalid}
        <li class="info">
          {$_('assimportdialog.info-invalid', {values: {n: nInvalid}})}
        </li>
        {/if}

        {#if 'ignored-style-field' in warningGroups}
        <li>
          <CircleAlertIcon />
          {$_('assimportdialog.ignored-style-field')}
          <ul>
            {#each warningGroups['ignored-style-field'] as w}
              <li>
                {$_('assimportdialog.in-a-b-equals-c', {values: {a: w.name, b: w.field, c: w.value}})}
              </li>
            {/each}
          </ul>
        </li>{/if}
        {#if 'ignored-event-field' in warningGroups}
        <li>
          <CircleAlertIcon />
          {$_('assimportdialog.ignored-event-field')}
          <ul>
            {#each warningGroups['ignored-event-field'] as w}
              <li>
                <code>{w.field}</code>
                {$_('assimportdialog.occurred-n-times', {values: {n: w.occurrence}})}
              </li>
            {/each}
          </ul>
        </li>
        {/if}
        {#if 'ignored-special-character' in warningGroups}
        <li>
          <CircleAlertIcon />
          {$_('assimportdialog.ignored-special-character')}
          <ul>
            {#each warningGroups['ignored-special-character'] as w}
              <li>
                <code>{w.name}</code>
                {$_('assimportdialog.occurred-n-times', {values: {n: w.occurrence}})}
              </li>
            {/each}
          </ul>
        </li>
        {/if}
        {#if 'ignored-drawing-command' in warningGroups}
        <li>
          <CircleAlertIcon />
          {$_('assimportdialog.ignored-drawing-command')}
          {$_('assimportdialog.occurred-n-times', {values: {n: warningGroups['ignored-drawing-command'][0].occurrence}})}
        </li>
        {/if}
        {#if 'ignored-override-tag' in warningGroups}
        <li>
          <CircleAlertIcon />
          {$_('assimportdialog.ignored-override-tag')}
          {$_('assimportdialog.occurred-n-times', {values: {n: warningGroups['ignored-override-tag'][0].occurrence}})}
        </li>
        {/if}
        {#if 'ignored-embedded-fonts' in warningGroups}
        <li>
          <CircleAlertIcon />
          {$_('assimportdialog.ignored-embedded-fonts')}
        </li>
        {/if}

        {#if nUnsupported}
        <li class="info">
          {$_('assimportdialog.info-ignored', {values: {n: nUnsupported}})}
        </li>
        {/if}
      {/if}
      </ul>
    </div>
    <div class="right">
      <h5>{$_('assimportdialog.options')}</h5>
      <label>
        <input type="checkbox" checked={parser?.preserveInlines}
          disabled={warningGroups && !('ignored-override-tag' in warningGroups)}
          onchange={(x) => 
            {parser!.preserveInlines = x.currentTarget.checked; parse()}}/>
        {$_('assimportdialog.preserve-inlines')}
      </label>
      <br/>
      <label>
        <input type="checkbox" checked={parser?.transformInlineMultichannel}
          onchange={(x) => 
            {parser!.transformInlineMultichannel = x.currentTarget.checked; parse()}}/>
        {$_('assimportdialog.transform-inline-multichannel')}
        <Tooltip text={$_('assimportdialog.transform-info')}/>
      </label>
    </div>
  </div>

</DialogBase>

<style>
  .left {
    min-width: 15em;
  }

  .right {
    padding-left: 20px;
  }

  label {
    white-space: pre;
  }

  ul.ass-import-warnings {
    margin: 0;
    list-style: none;
    padding: 0px;
    & > li {
      margin: 5px 0px;
      font-weight: bold;
    }
    & > li.info {
      font-weight: normal;
      padding-left: 3em;
      font-size: 90%;
      color: gray;
      line-height: 1.5;
      text-align: justify;
    }
  }

  ul.ass-import-warnings ul {
    padding: 0 0 0 3em;
    list-style-type: circle;
    font-weight: normal;
    & > li {
      padding: 5px 0 0 0;
      font-size: 95%;
    }
  }

  :global(.ass-import-warnings .lucide) {
    display: inline;
    color: red;
    vertical-align: text-bottom;
    max-height: 1.2em;
    stroke-width: 1.5px;
  }

  :global(.ass-import-warnings .ok .lucide) {
    color: green;
  }
</style>