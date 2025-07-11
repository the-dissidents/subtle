<script lang="ts" module>
export type MessageGroupFormat = {
  heading: string,
  items?: string[],
  description?: string
};

export type FormatImportOption<P extends SubtitleParser> = {
  type: 'boolean',
  name: string,
  description?: string,
  getValue: (p: P) => boolean,
  setValue: (p: P, v: boolean) => void
};

export type ImportFormat<P extends SubtitleParser> = {
  header: string,
  formatMessage<T extends P['messages'][0]['type']>(
    type: T, group: OneGroup<P['messages'][0], 'type', T>): MessageGroupFormat;
  categoryDescription(category: P['messages'][0]['category']): string | undefined;
  options?: FormatImportOption<P>[];
};
</script>

<script lang="ts" generics="P extends SubtitleParser">
import DialogBase from '../DialogBase.svelte';
import type { SubtitleParseMessage, SubtitleParser } from '../core/Subtitles.svelte';
import { DialogHandler } from '../frontend/Dialogs';
import { groupBy, type GroupedBy, type OneGroup } from '../details/GroupBy';
import { CircleAlertIcon, CircleCheckIcon } from '@lucide/svelte';
import { Debug } from '../Debug';

import { _ } from 'svelte-i18n';
import Tooltip from '../ui/Tooltip.svelte';

interface Props {
  handler: DialogHandler<[P, ImportFormat<P>], boolean>;
}

let {
  handler = $bindable(),
}: Props = $props();

let inner = new DialogHandler<void>();
let parser = $state<P>();
let categories = $state<GroupedBy<P['messages'][0], 'category'>>();
let format = $state<ImportFormat<P>>();

handler.showModal = async ([p, f]) => {
  format = f;
  parser = p;
  parse();
  Debug.assert(inner !== undefined);
  let btn = await inner.showModal!();
  return btn == 'ok';
};

function parse() {
  Debug.assert(parser !== undefined);
  parser.update();
  categories = groupBy(parser.messages, 'category');
}
</script>

<DialogBase handler={inner}>
  {#snippet header()}
  <h3>{format?.header}</h3>
  {/snippet}

  <div class="hlayout">
    <div class="left">
      <ul class="ass-import-warnings">
      {#if categories}
      {#each Object.entries(categories) as [k, v]}
      {@const groups = groupBy(v as SubtitleParseMessage[], 'type')}
      {@const info = format!.categoryDescription(k)}
        {#each Object.entries(groups) as [type, msgs]}
        {@const f = format!.formatMessage(type, msgs as any)}
          <li>
            <CircleAlertIcon />
            {f.heading}
            {#if f.items?.length}
            <ul>
              {#each f.items as item}
              <li>{item}</li>
              {/each}
            </ul>
            {/if}
          </li>
          {#if f.description}
          <li class="info">{f.description}</li>
          {/if}
        {/each}
        {#if info}
        <hr/>
        <li class="info-group">
          {info}
        </li>
        {/if}
      {:else}
        <li class='ok'>
          <CircleCheckIcon />
          {$_('assimportdialog.no-problems')}
        </li>
      {/each}
      {/if}
      </ul>
    </div>

  {#if format?.options}
    <div class="right">
      <h5>{$_('assimportdialog.options')}</h5>
      {#each format.options as opt}
        {#if opt.type == 'boolean'}
          <label>
            <input type="checkbox" checked={opt.getValue(parser!)}
              onchange={(x) => {opt.setValue(parser!, x.currentTarget.checked); parse()}}/>
            {opt.name}
            {#if opt.description}
              <Tooltip text={opt.description} />
            {/if}
          </label>
          <br/>
        {:else}
          {Debug.never(opt.type)}
        {/if}
      {/each}
    </div>
  {/if}
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
      padding-left: 2em;
      font-size: 90%;
      color: gray;
      line-height: 1.5;
      text-align: justify;
    }
    & > li.info-group {
      font-weight: normal;
      padding: 0 0.2em 0 0.2em;
      font-size: 90%;
      color: gray;
      line-height: 1.5;
      text-align: justify;
    }
  }

  ul.ass-import-warnings ul {
    padding: 3px 0 0 3em;
    list-style-type: circle;
    font-weight: normal;
    & > li {
      padding: 2px 0 0 0;
      font-size: 95%;
    }
  }

  hr {
    padding-top: 5px;
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