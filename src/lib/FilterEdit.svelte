<script lang="ts">
import { newMetricFilter, Metric, MetricFilterMethods, TextMetricFilterNullMethods, Metrics, type SimpleMetricFilter, type MetricFilter, type MetricFilterMethod } from "./core/Filter";
import { _, locale } from 'svelte-i18n';
import { Debug } from "./Debug";
import type { Action } from "svelte/action";
import { tick } from "svelte";
import { Menu } from "@tauri-apps/api/menu";
import StyleSelect from "./StyleSelect.svelte";
import type { SubtitleStyle } from "./core/Subtitles.svelte";
import TimestampInput from "./TimestampInput.svelte";
import { Source } from "./frontend/Source";

interface Props {
  filter: MetricFilter | null
  onchange?: () => void;
}

let { filter = $bindable(), onchange }: Props = $props();
let updateCounter = $state(0);

locale.subscribe(() => updateCounter++);

const metrics = Object.entries(Metrics) as [keyof typeof Metrics, Metric<any>][];
const methods = Object.entries(MetricFilterMethods) as 
  [keyof typeof MetricFilterMethods, MetricFilterMethod<any, any, any>][];

const entryMetrics = metrics.filter(([_, y]) => y.per == 'entry');
const channelMetrics = metrics.filter(([_, y]) => y.per == 'channel');

const autoWidth: Action<HTMLSelectElement> = (elem) => {
  function updateSelectWidth() {
    const checked = elem.querySelector('option:checked');
    if (checked === null) return Debug.early('checked is null');
    const text = (<HTMLElement>checked).innerText;
    const { fontWeight, fontSize, fontFamily } = window.getComputedStyle(elem);

    const span = document.createElement('span');
    span.innerHTML = text;
    span.style.fontSize = fontSize;
    span.style.fontWeight = fontWeight;
    span.style.fontFamily = fontFamily;
    span.style.visibility = 'hidden';

    document.body.appendChild(span);
    elem.style.width = `${span.offsetWidth + 25}px`;
    span.remove();
  }
  $effect(() => {
    tick().then(() => updateSelectWidth());
    elem.addEventListener("input", updateSelectWidth);
    return () => {
      elem.removeEventListener("input", updateSelectWidth);
    }
  });
}

function createDefaultFilter(): SimpleMetricFilter {
  return newMetricFilter({
    metric: 'chars',
    method: 'numberNull',
    negated: false,
    parameters: []
  });
}
</script>

{#snippet makeParameter(f: SimpleMetricFilter, i: number)}
  {@const method = MetricFilterMethods[f.method]}
  {Debug.assert((<any[]>f.parameters).length == MetricFilterMethods[f.method].parameters)}
  {#if method.parameterType == 'string' || method.parameterType == 'number'}
    <input type='text' size='2' value={f.parameters[i]}
      onchange={(ev) => {
        const params = <string[] | number[]>f.parameters;
        if (method.parameterType == 'number') {
          const num = Number.parseFloat(ev.currentTarget.value);
          if (!isNaN(num)) {
            params[i] = num;
            onchange?.();
          } else
            ev.currentTarget.value = params[i].toString();
        } else if (method.parameterType == 'string') {
          params[i] = ev.currentTarget.value;
          onchange?.();
        } else {
          Debug.assert(false);
        }
      }} />
  {:else if method.parameterType == 'style'}
    <span class="flexgrow">
      <StyleSelect stretch={true}
        currentStyle={f.parameters[i]}
        onsubmit={(s) => {
          (<SubtitleStyle[]>f.parameters)[i] = s;
          onchange?.();
        }} />
    </span>
  {:else if method.parameterType == 'time'}
    <span class="flexgrow">
      <TimestampInput stretch={true}
        timestamp={f.parameters[i]}
        onchange={(t) => {
          (<number[]>f.parameters)[i] = t;
          onchange?.();
        }}/>
    </span>
  {:else}
    {Debug.never(method.parameterType)}
  {/if}
{/snippet}

{#snippet makeFilter(
  f: MetricFilter,
  parentType: 'and' | 'or' | null,
  replace: (...to: MetricFilter[]) => void,
  remove?: () => void
)}
  {#if 'type' in f}
    <fieldset>
      <ul class="combination">
        {#each f.filters as subfilter, i}
          <li>
            {#if i > 0}
              <div class='combinator'>
                {f.type == 'and' ? $_('filteredit.and') : $_('filteredit.or')}
              </div>
            {/if}
            {@render makeFilter(subfilter, f.type, (...to) => {
              Debug.assert('type' in f);
              f.filters.splice(i, 1, ...to);
              onchange?.();
            }, () => {
              Debug.assert('type' in f);
              f.filters.splice(i, 1);
              Debug.assert(f.filters.length >= 1);
              if (f.filters.length == 1)
                replace(f.filters[0]);
              onchange?.();
            })}
          </li>
        {/each}
      </ul>
    </fieldset>
  {:else}
    <div class="hlayout flexgrow">
      {#if f.negated}
        <label>
          <input type='checkbox' class="button"
            checked={true} onchange={() => {
              f.negated = false;
              onchange?.();
            }}/>
          {$_('filteredit.not')}
        </label>
      {/if}
      <select value={f.metric}
        use:autoWidth
        onchange={(ev) => {
          const method = MetricFilterMethods[f.method];
          const name = <keyof typeof Metrics>ev.currentTarget.value;
          Debug.assert(name in Metrics);
          const newMetric = Metrics[name as keyof typeof Metrics];

          if (newMetric.type == method.fromType) {
            f.metric = name;
            onchange?.();
          } else replace({
            metric: name,
            method: TextMetricFilterNullMethods[method.fromType],
            negated: false,
            parameters: [] as never
          });
        }}
      >
        {#each entryMetrics as [name, metric]}
          <option value={name}>{metric.localizedName()}</option>
        {/each}
        <hr>
        {#each channelMetrics as [name, metric]}
          <option value={name}>{metric.localizedName()}</option>
        {/each}
      </select>
      <select value={f.method}
        use:autoWidth
        onchange={(ev) => {
          const name = <keyof typeof MetricFilterMethods>ev.currentTarget.value;
          Debug.assert(name in MetricFilterMethods);
          const newMethod = MetricFilterMethods
            [name as keyof typeof MetricFilterMethods];
          f.method = name;
          // fill parameters
          const params = <any[]>f.parameters;
          if (params.length > newMethod.parameters)
            params.splice(newMethod.parameters);
          for (let i = params.length; i < newMethod.parameters; i++)
            params[i] = newMethod.parameterType == 'number' ? 0
                  : newMethod.parameterType == 'string' ? ''
                  : newMethod.parameterType == 'style' ? Source.subs.defaultStyle
                  : newMethod.parameterType == 'time' ? 0
                  : Debug.never(newMethod.parameterType);
          onchange?.();
        }}
      >
        {#each methods as [name, method]}
          {#if method.fromType == Metrics[f.metric].type}
            <option value={name}>{method.localizedName()}</option>
          {/if}
        {/each}
      </select>
      {#each {length: MetricFilterMethods[f.method].parameters}, i}
        {@render makeParameter(f, i)}
      {:else}
        <span class="flexgrow"></span>
      {/each}

      <button aria-label="more" onclick={async () => {
        const menu = await Menu.new({items: [
          {
            text: $_('filteredit.negate'),
            checked: f.negated,
            action: () => {
              f.negated = !f.negated;
              onchange?.();
            }
          },
          { item: 'Separator' },
          {
            text: $_('filteredit.new-and-clause'),
            action: () => parentType == 'and' 
              ? replace(f, createDefaultFilter())
              : replace({
                  type: 'and',
                  filters: [f, createDefaultFilter()]
                })
          },
          {
            text: $_('filteredit.new-or-clause'),
            action: () => parentType == 'or' 
              ? replace(f, createDefaultFilter())
              : replace({
                  type: 'or',
                  filters: [f, createDefaultFilter()]
                })
          },
          { item: 'Separator' },
          {
            text: $_('filteredit.delete'),
            enabled: remove !== undefined,
            action: remove
          },
        ]});
        menu.popup();
      }}>
        <svg class="feather">
          <use href={`/feather-sprite.svg#more-horizontal`} />
        </svg>
      </button>
    </div>
  {/if}
{/snippet}

{#key updateCounter}
  {#if filter === null}
    <button class="hlayout" onclick={() => {
      filter = createDefaultFilter();
      onchange?.();
    }}>
      <svg class="feather">
        <use href={`/feather-sprite.svg#plus`} />
      </svg>
      {$_('filteredit.add-condition')}
    </button>
  {:else}
    {@render makeFilter(filter, null, 
      (to) => { filter = to; onchange?.(); }, 
      () => { filter = null; onchange?.(); }
    )}
  {/if}
{/key}

<style>
  fieldset {
    border-radius: 2px;
    border: 1px solid gray;
    margin: 3px;
    padding: 3px;
  }
  div.combinator {
    text-align: start;
    padding-left: 20px;
    overflow: hidden;
    font-size: 0.85rem;
    &::before, &::after {
      background-color: gray;
      content: "";
      display: inline-block;
      height: 1px;
      position: relative;
      vertical-align: middle;
    }
    &::before {
      width: 50%;
      right: 0.5em;
      margin-left: -50%;
    }
    &::after {
      width: 100%;
      left: 0.5em;
      margin-right: -50%;
    }
  }

  input {
    flex: 1;
    min-width: 0;
  }
  ul.combination {
    display: flex;
    flex-direction: column;
    padding: 3px 0;
    margin: 1px;
    list-style: none;
  }
</style>