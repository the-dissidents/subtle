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
import { groupBy, type GroupedBy, type OneGroup } from '../details/GroupBy';
import { CircleAlertIcon, CircleCheckIcon } from '@lucide/svelte';
import { Debug } from '../Debug';

import { _ } from 'svelte-i18n';
import Tooltip from '../ui/Tooltip.svelte';
  import { onMount } from 'svelte';

interface Props {
  args: [P, ImportFormat<P>];
  close: (ret: boolean) => void;
}

let {
  args, close
}: Props = $props();

let [parser, format] = $state(args);

let inner: DialogBase;
let categories = $state<GroupedBy<P['messages'][0], 'category'>>();

onMount(async () => {
  parse();
  let btn = await inner.showModal!();
  return close(btn == 'ok');
});

function parse() {
  Debug.assert(parser !== undefined);
  parser.update();
  categories = groupBy(parser.messages, 'category');
}
</script>

<DialogBase bind:this={inner}>
  {#snippet header()}
  <h3>{format?.header}</h3>
  {/snippet}

  <div class="hlayout">
    <div class="left">
      <ul class="ass-import-warnings">
      {#if categories}
      {#each Object.entries(categories) as [k, v] (k)}
      {@const groups = groupBy(v as SubtitleParseMessage[], 'type')}
      {@const info = format!.categoryDescription(k)}
        {#each Object.entries(groups) as [type, msgs] (type)}
        {@const f = format!.formatMessage(type, msgs as never)}
          <li>
            <CircleAlertIcon />
            {f.heading}
            {#if f.items?.length}
            <ul>
              {#each f.items as item (item)}
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
      {#each format.options as opt (opt)}
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