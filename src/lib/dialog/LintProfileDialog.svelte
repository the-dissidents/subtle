<script lang="ts">
import DialogBase from '../DialogBase.svelte';
import { BracketPresetName, RegexLintPresetName, type LintProfile } from '../core/LintProfile';
import { BracketSetPresets } from '../linter/brackets/Presets';
import LintProfileSelect from '../LintProfileSelect.svelte';

import { SvelteSet } from 'svelte/reactivity';
import { onMount } from 'svelte';

import { _ } from 'svelte-i18n';
  import { ConfigRow, ConfigTable } from '@the_dissidents/svelte-ui';
  import { DashType, type DashesConfig } from '../linter/Dashes';
  import { resetSavedLintProfiles } from '../frontend/LintProfiles';

interface Props {
  args: [profile: LintProfile],
  close: (ret: LintProfile | null) => void
}

let {
  args: _args, close
}: Props = $props();

let inner: DialogBase;

function load(profile: LintProfile) {
  bracketGroups.clear();
  regexes.clear();
  profile.bracketGroups.forEach((x) => bracketGroups.add(x));
  profile.regexes.forEach((x) => regexes.add(x));
  forbidden = profile.forbiddenPunctuation;
  dashes = profile.dashes;
}

onMount(async () => {
  load(_args[0]);
  const r = await inner.showModal!();
  close(r == 'ok' ? result : null);
});

const bracketGroups = new SvelteSet<BracketPresetName>();
const regexes = new SvelteSet<RegexLintPresetName>();
let dashes = $state<DashesConfig>();
let forbidden = $state('');

const result = $derived<LintProfile>({
  bracketGroups: [...bracketGroups.keys()],
  regexes: [...regexes.keys()],
  forbiddenPunctuation: forbidden,
  dashes,
});
</script>

{#snippet dashSelector(dashObj?: { type: DashType })}
  {#each Object.entries(DashType) as [k, v]}
    <label>
      <input type='radio' checked={dashObj?.type == k}
        onchange={(e) => {
          if (dashObj && e.currentTarget.checked)
            dashObj.type = k as DashType;
        }}>
      <span>{$_(`dash.${k}`)} <code>{v}</code></span>
    </label>
  {/each}
{/snippet}

{#snippet regexCheckboxes(data: [group: RegexLintPresetName, name: string][])}
  {#each data as [group, name]}
    <label>
      <input type='checkbox' checked={regexes.has(group)}
        onchange={(e) => {
          if (e.currentTarget.checked)
            regexes.add(group);
          else
            regexes.delete(group);
        }}>
      {name}
    </label>
  {/each}
{/snippet}

{#snippet regexRadios(data: [group: RegexLintPresetName, name: string][])}
  <label>
    <input type='radio' checked={!data.find((x) => regexes.has(x[0]))}
      onchange={(e) => {
        if (e.currentTarget.checked)
          for (const [g, _] of data)
            regexes.delete(g);
      }}>
    {$_('lint.unchecked')}
  </label>

  {#each data as [group, name]}
    <label>
      <input type='radio' checked={regexes.has(group)}
        onchange={(e) => {
          if (e.currentTarget.checked) {
            for (const [g, _] of data)
              regexes.delete(g);
            regexes.add(group);
          }
        }}>
      {name}
    </label>
  {/each}
{/snippet}

{#snippet bracketBoxes(data: [group: BracketPresetName, name: string][])}
  <label>
    <input type='radio' checked={!data.find((x) => bracketGroups.has(x[0]))}
      onchange={(e) => {
        if (e.currentTarget.checked)
          for (const [g, _] of data)
            bracketGroups.delete(g);
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

      <span>
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
      </span>
    </label>
  {/each}
{/snippet}

<DialogBase bind:this={inner}>
{#snippet header()}
  <h3>{$_('lint.edit-lint-profile')}</h3>
{/snippet}

<div class="vlayout">
  <LintProfileSelect value={result}
    onChange={(x) => x ? load(x) : {}} allowManage={true} />
  <button onclick={() => resetSavedLintProfiles()}>{$_('lint.reset-presets')}</button>

  <div class="hlayout">
    <fieldset>
      <legend>{$_('lint.bracket-checking')}</legend>
      <div class="list">
        {@render bracketBoxes([
          ['curlyQuotes', $_('lint.curly-quotes')],
          ['invertedCurlyQuotes', $_('lint.inverted-curly-quotes')],
          ['cornerQuotes', $_('lint.corner-quotes')],
          ['frenchGuillemetQuotes', $_('lint.french-guillemet')],
        ])}
        <hr>
        {@render bracketBoxes([
          ['halfwidthParentheses', $_('lint.halfwidth-parens')],
          ['fullwidthParentheses', $_('lint.fullwidth-parens')],
        ])}
      </div>
    </fieldset>

    <div class="vlayout">
      <fieldset>
        <legend>{$_('lint.ellipsis')}</legend>
        <div class="hlayout">
          <div class="list flexgrow">
            {@render regexRadios([
              ['useSingleEllipsis', $_('lint.single-ellipsis')],
              ['useDoubleEllipsis', $_('lint.double-ellipsis')],
            ])}
          </div>
          <div class="list flexgrow">
            {@render regexRadios([
              ['spaceAroundEllipsis', $_('regexlint.space-around-ellipsis')],
              ['noSpaceAroundEllipsis', $_('regexlint.no-space-around-ellipsis')],
            ])}
          </div>
        </div>
      </fieldset>

      <fieldset>
        <legend>{$_('lint.spaces-and-punct')}</legend>
        <div class="list">
          {@render regexCheckboxes([
            ['noConsecutiveSpaces', $_('regexlint.consecutive-spaces')],
            ['noLeadingTrailingSpaces', $_('regexlint.leading-trailing-spaces')],
            ['noSpaceBeforePunctuation', $_('regexlint.no-space-before-punct')],
            ['spaceAfterLatinPunctuation', $_('regexlint.space-after-latin-punct')],
            ['noSpaceAroundFullwidthPunctuation', $_('regexlint.space-around-fullwidth-punct')],
            ['useChineseWordConnector', $_('regexlint.chinese-word-connector')],
            ['useFullwidthPunctuationInCJK', $_('regexlint.use-fullwidth-punct')],
            ['useHalfwidthPunctuationInLatin', $_('regexlint.use-halfwidth-punct')],
          ])}
        </div>
      </fieldset>
    </div>
  </div>

  <fieldset disabled={!dashes}>
    <legend>
      <input type='checkbox'
        bind:checked={
          () => !!dashes,
          (x) => x ? dashes = {
            dash: { type: 'emDash', spaces: true, endOnly: false },
            dialog: { type: 'emDash', spaces: true, separateLines: true },
          } : dashes = undefined
        }>
      {$_('lint.dashes')}
    </legend>
    <div class="hlayout">
      <div class="list flexgrow">
        <h5>{$_('lint.dialog-dashes')}</h5>
        {@render dashSelector(dashes?.dialog)}
        <hr>
        <label>
          <input type='checkbox' bind:checked={
            () => dashes?.dialog.spaces ?? false,
            (x) => dashes!.dialog.spaces = x}>
          {$_('lint.dashes-need-spaces-around')}
        </label>
        <label>
          <input type='checkbox' bind:checked={
            () => dashes?.dialog.separateLines ?? false,
            (x) => dashes!.dialog.separateLines = x}>
          {$_('lint.dashes-require-newline')}
        </label>
      </div>
      <div class="list flexgrow">
        <h5>{$_('lint.latin-dashes')}</h5>
        {@render dashSelector(dashes?.dash)}
        <hr>
        <label>
          <input type='checkbox' bind:checked={
            () => dashes?.dash.spaces ?? false,
            (x) => dashes!.dash.spaces = x}>
          {$_('lint.dashes-need-spaces-around')}
        </label>
        <label>
          <input type='checkbox' bind:checked={
            () => dashes?.dash.endOnly ?? false,
            (x) => dashes!.dash.endOnly = x}>
          {$_('lint.dashes-line-end-only')}
        </label>
      </div>
      <div class="list flexgrow">
        <h5>CJK破折号</h5>
        <label>
          <input type='radio' checked={!dashes?.cjkDash}
            onchange={(e) => e.currentTarget.checked
              ? (dashes!.cjkDash = undefined) : {}}>
          {$_('lint.unchecked')}
        </label>
        <label>
          <input type='radio' checked={dashes?.cjkDash?.type == 'standard'}
            onchange={(e) => e.currentTarget.checked
              ? (dashes!.cjkDash = { type: 'standard' }) : {}}>
          {$_('lint.dashes-normal')}
        </label>
        <label>
          <input type='radio' checked={dashes?.cjkDash?.type == 'unicode'}
            onchange={(e) => e.currentTarget.checked
              ? (dashes!.cjkDash = { type: 'unicode' }) : {}}>
          {$_('lint.dashes-unicode')}
        </label>
      </div>
    </div>
  </fieldset>

  <fieldset>
    <legend>{$_('lint.special')}</legend>
    <ConfigTable>
      <ConfigRow name={$_('lint.forbidden-punctuations')}>
        <input style:width="100%" type='text' bind:value={forbidden}>
      </ConfigRow>
    </ConfigTable>
  </fieldset>
</div>
</DialogBase>

<style>
  .hlayout {
    gap: 5px
  }

  h5 {
    border: none;
    padding: 0;
  }

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
    font-family: var(--uiFontFamily);
    padding-inline: 2px;
  }

  .list {
    display: flex;
    flex-direction: column;
    gap: 5px;
  }

  label {
    display: flex;
    flex-direction: row;
    align-items: start;
    input {
      margin-right: 5px;
    }
  }

  /* .vr {
    border-left: 1px solid var(--separator-light);
    width: 1px;
    height: 100%;
  } */
</style>
