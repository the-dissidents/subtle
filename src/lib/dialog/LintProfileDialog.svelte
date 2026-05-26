<script lang="ts">
  import { SvelteSet } from 'svelte/reactivity';
import DialogBase from '../DialogBase.svelte';
import { BracketPresetName, type LintProfile } from '../core/LintProfile';
import { onMount } from 'svelte';

import { _ } from 'svelte-i18n';
  import { BracketSetPresets } from '../linter/brackets/Presets';

interface Props {
  args: [profile: LintProfile],
  close: (ret: LintProfile | null) => void
}

let {
  args: _args, close
}: Props = $props();

let inner: DialogBase;

onMount(async () => {
  const profile = _args[0];
  profile.bracketGroups.forEach((x) => bracketGroups.add(x));

  const result = await inner.showModal!();
  close(result == 'ok' ? buildResult() : null);
});

const bracketGroups = new SvelteSet<BracketPresetName>();

function buildResult(): LintProfile {
  return {
    bracketGroups: [...bracketGroups.keys()]
  };
}
</script>

{#snippet radioboxes(data: [group: BracketPresetName, name: string][])}
<label>
  <input type='radio' checked={!data.find((x) => bracketGroups.has(x[0]))}
    onchange={(e) => {
      if (e.currentTarget.checked) {
        for (const [g, _] of data)
          bracketGroups.delete(g);
      }
    }}>
  {$_('lint.unchecked')}
</label>

{#each data as [group, name]}
  <label>
    <input type='radio' checked={bracketGroups.has(group)}
      onchange={(e) => {
        if (e.currentTarget.checked) {
          for (const [g, _] of data)
            bracketGroups.delete(g);
          bracketGroups.add(group);
        }
      }}>
    {name}

    <code>
      {BracketSetPresets[group].preferred.primary[0]}
    </code>
    {#if 'secondary' in BracketSetPresets[group].preferred}
      <code>
        {BracketSetPresets[group].preferred.secondary[0]}
      </code>
      <code>
        {BracketSetPresets[group].preferred.secondary[1]}
      </code>
    {/if}
    <code>
      {BracketSetPresets[group].preferred.primary[1]}
    </code>
  </label>
{/each}
{/snippet}

<DialogBase bind:this={inner}>
  {#snippet header()}
    <h3>{$_('lint.edit-lint-profile')}</h3>
  {/snippet}

  <div class="hlayout">
    <fieldset>
      <legend>{$_('lint.bracket-checking')}</legend>
      <div class="list">
        <button onclick={() => bracketGroups.clear()} disabled={bracketGroups.size == 0}>
          {$_('lint.clear')}
        </button>
        {@render radioboxes([
          ['curlyQuotes', $_('lint.curly-quotes')],
          ['invertedCurlyQuotes', $_('lint.inverted-curly-quotes')],
          ['cornerQuotes', $_('lint.corner-quotes')],
          ['frenchGuillemetQuotes', $_('lint.french-guillemet')],
        ])}
        <hr>
        {@render radioboxes([
          ['halfwidthParentheses', $_('lint.halfwidth-parens')],
          ['fullwidthParentheses', $_('lint.fullwidth-parens')],
        ])}
      </div>
    </fieldset>

    <!-- <fieldset>
      <legend>标点</legend>
      <div class="list">
        <label>
          <input type='checkbox'>
          禁止连续多个空格
        </label>
        <label>
          <input type='checkbox'>
          西文标点符号后应该恰好有一个空格
        </label>
        <label>
          <input type='checkbox'>
          全角标点符号前后不应有空格
        </label>
        <label>
          <input type='checkbox'>
          全角文字中标点符号不应为半角
        </label>
      </div>
    </fieldset> -->
  </div>
  <!-- <fieldset>
    <legend>正则表达式规则</legend>
    <ul>
      <li></li>
    </ul>
  </fieldset> -->
</DialogBase>

<style>
  fieldset {
    border-radius: 2px;
    border: 1px solid gray;
    margin: 3px;
    padding: 5px 10px 10px 7px;
  }

  code {
    color: white;
    background-color: gray;
    border-radius: 3px;
    font-family: var(--monospaceFontFamily);
    padding-inline: 2px;
  }

  .list {
    display: flex;
    flex-direction: column;
    gap: 5px;
  }
</style>
