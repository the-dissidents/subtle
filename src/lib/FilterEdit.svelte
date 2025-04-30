<script lang="ts">
import { newMetricFilter, TextMetric, TextMetricFilterMethods, TextMetricFilterNullMethods, TextMetrics, type MetricFilter, type MetricFilterCombination, type MetricFilterMethod } from "./core/Filter";
import { _, locale } from 'svelte-i18n';
import { Debug } from "./Debug";
import type { Action } from "svelte/action";
import { tick } from "svelte";
import { Menu } from "@tauri-apps/api/menu";

interface Props {
  filter: MetricFilterCombination | null
  // onsubmit?: () => void;
}

let { filter = $bindable() }: Props = $props();
let updateCounter = $state(0);

locale.subscribe(() => updateCounter++);

const metrics = Object.entries(TextMetrics) as [keyof typeof TextMetrics, TextMetric<any>][];
const methods = Object.entries(TextMetricFilterMethods) as 
  [keyof typeof TextMetricFilterMethods, MetricFilterMethod<any, any, any>][];

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

function createDefaultFilter(): MetricFilter {
  return newMetricFilter({
    metric: 'chars',
    method: 'numberNull',
    negated: false,
    parameters: []
  });
}
</script>

{#snippet makeParameter(f: MetricFilter, i: number)}
  {@const method = TextMetricFilterMethods[f.method]}
  {Debug.assert((<any[]>f.parameters).length == TextMetricFilterMethods[f.method].parameters)}
  <input type='text' size='2' value={f.parameters[i]}
    onchange={(ev) => {
      const params = <string[] | number[]>f.parameters;
      if (method.parameterType == 'number') {
        const num = Number.parseFloat(ev.currentTarget.value);
        if (!isNaN(num))
          params[i] = num;
        else
          ev.currentTarget.value = params[i].toString();
      } else if (method.parameterType == 'string') {
        params[i] = ev.currentTarget.value;
      } else {
        Debug.never(method.parameterType);
      }
    }} />
{/snippet}

{#snippet makeFilter(
  f: MetricFilterCombination,
  parentType: 'and' | 'or' | null,
  replace: (...to: MetricFilterCombination[]) => void,
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
            }, () => {
              Debug.assert('type' in f);
              f.filters.splice(i, 1);
              Debug.assert(f.filters.length >= 1);
              if (f.filters.length == 1)
                replace(f.filters[0]);
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
            checked={true} onchange={() => f.negated = false}/>
          {$_('filteredit.not')}
        </label>
      {/if}
      <select value={f.metric}
        use:autoWidth
        onchange={(ev) => {
          const method = TextMetricFilterMethods[f.method];
          const name = <keyof typeof TextMetrics>ev.currentTarget.value;
          Debug.assert(name in TextMetrics);
          const newMetric = TextMetrics[name as keyof typeof TextMetrics];

          if (newMetric.type == method.fromType)
            f.metric = name;
          else replace({
            metric: name,
            method: TextMetricFilterNullMethods[method.fromType],
            negated: false,
            parameters: [] as never
          });
        }}
      >
        {#each metrics as [name, metric]}
          <option value={name}>{metric.localizedName()}</option>
        {/each}
      </select>
      <select value={f.method}
        use:autoWidth
        onchange={(ev) => {
          const name = <keyof typeof TextMetricFilterMethods>ev.currentTarget.value;
          Debug.assert(name in TextMetricFilterMethods);
          const newMethod = TextMetricFilterMethods
            [name as keyof typeof TextMetricFilterMethods];
          f.method = name;
          // fill parameters
          const params = <string[] | number[]>f.parameters;
          if (params.length > newMethod.parameters)
            params.splice(newMethod.parameters);
          for (let i = params.length; i < newMethod.parameters; i++)
            params[i] = newMethod.parameterType == 'number' ? 0
                  : newMethod.parameterType == 'string' ? ''
                  : Debug.never();
        }}
      >
        {#each methods as [name, method]}
          {#if method.fromType == TextMetrics[f.metric].type}
            <option value={name}>{method.localizedName()}</option>
          {/if}
        {/each}
      </select>
      {#each {length: TextMetricFilterMethods[f.method].parameters}, i}
        {@render makeParameter(f, i)}
      {:else}
        <span class="flexgrow"></span>
      {/each}

      <button aria-label="more" onclick={async () => {
        const menu = await Menu.new({items: [
          {
            text: $_('filteredit.negate'),
            checked: f.negated,
            action: () => f.negated = !f.negated
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
    <button class="hlayout" onclick={() => filter = createDefaultFilter()}> 
      <svg class="feather">
        <use href={`/feather-sprite.svg#plus`} />
      </svg>
      {$_('filteredit.add-condition')}
    </button>
  {:else}
    {@render makeFilter(filter, null, 
      (to) => filter = to, 
      () => filter = null
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