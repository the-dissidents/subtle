<script lang="ts">
import { Popup } from "@the_dissidents/svelte-ui";
import type { Diagnostic } from "../../linter/Common";
import { RichText } from "../../core/RichText";
import { Filter, type SimpleMetricFilter } from "../../core/Filter";

import { Debug } from "../../Debug";
import { ArrowRightIcon } from "@lucide/svelte";

import { _ } from 'svelte-i18n';

type Data = {
  text: RichText,
  diagnostics: Diagnostic[],
  failedFilters: SimpleMetricFilter[],
};

let data: Data | undefined = $state();

let segments: {
  text: string,
  superscripts: number[],
}[] = $state([]);

let popup: Popup;

export function open(d: Data, o: Parameters<Popup['open']>[0]) {
  data = d;

  const events: {
    pos: number,
    type: 'start' | 'end',
    id: number
  }[] = [];
  d.diagnostics.forEach((x, i) => {
    events.push({ pos: x.start, type: 'start', id: i + 1 });
    events.push({ pos: x.to, type: 'end', id: i + 1 });
  });
  events.sort((a, b) => a.pos - b.pos);

  const plain = RichText.toString(d.text);
  segments = [];

  let stack: number[] = [], last = 0;
  for (const { pos, type, id } of events) {
    if (last < pos && stack.length == 0)
      segments.push({ text: plain.slice(last, pos), superscripts: [] });

    if (type == 'start') {
      if (last < pos && stack.length > 0)
        segments.push({ text: plain.slice(last, pos), superscripts: [stack.at(-1)!] });
      stack.push(id);
    } else {
      if (stack.length > 0) {
        if (last < pos)
          segments.push({ text: plain.slice(last, pos), superscripts: [id] });
        else {
          Debug.assert(stack.length > 0);
          segments.at(-1)!.superscripts.push(id);
        }
      }

      const index = stack.indexOf(id);
      Debug.assert(index >= 0);
      stack.splice(index, 1);
    }
    last = pos;
  }
  if (last < plain.length)
    segments.push({ text: plain.slice(last), superscripts: [] });
  popup.open(o);
}

export function openState() { return popup.openState(); }
export function close() { popup.close(); }
</script>

<Popup bind:this={popup} kind='panel' position='left'>
  {#if data}
  <div class="vlayout">
    {#if data.failedFilters.length > 0}
      <h5>{$_('table.requirement-not-met', {values: {n: data.failedFilters.length}})}</h5>
      <ul>
      {#each data.failedFilters as f}
        <li>{Filter.describe(f)}</li>
      {/each}
      </ul>
    {/if}

    {#if data.diagnostics.length > 0}
      <h5>{$_('table.lint-messages', {values: {n: data.diagnostics.length}})}</h5>
      <div class="text">
        {#each segments as s}
          {#if s.superscripts.length > 0}
            <span class="lint">{s.text}<sup>{s.superscripts.join(', ')}</sup></span>
          {:else}
            <span class="segment">{s.text}</span>
          {/if}
        {/each}
      </div>
      <ol>
      {#each data.diagnostics as d}
        <li>
          {d.description}
          {#if d.fix}
            <span class="fix">
              <ArrowRightIcon/>
              <code>{d.fix.substitute}</code>
            </span>
          {/if}
        </li>
      {/each}
      </ol>
    {/if}
  </div>
  {/if}
</Popup>

<style>
  div.text {
    background-color: #eee;
    padding: 0 6px;
    border-radius: 6px;
  }
  span.lint {
    text-decoration: underline wavy;
    text-decoration-color: red;
  }

  sup {
    color: maroon;
    padding-right: 1px;
    line-height: 0;
  }

  span.lint, span.segment {
    white-space: pre-wrap;
  }

  span.fix {
    display: inline-block;

    code {
      white-space: pre-wrap;
      background-color: #eee;
      border-radius: 3px;
      padding: 0 3px;
    }
  }

  span.fix :global(.lucide) {
    display: inline;
    height: 1em;
    width: 1em;
    vertical-align: middle;
  }

  ol, ul {
    padding-left: 2em;
    margin: 5px 0;
  }
</style>
