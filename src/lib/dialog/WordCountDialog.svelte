<script lang="ts">
import DialogBase from '../DialogBase.svelte';
import { Source } from '../frontend/Source';
import { Selection } from '../frontend/Editing';
import { RichText } from '../core/RichText';
import type { SubtitleStyle } from '../core/Subtitles.svelte';

import { onMount } from 'svelte';
import { _ } from 'svelte-i18n';
import { ButtonStrip, ConfigRow, ConfigTable, StripItem, Tooltip } from '@the_dissidents/svelte-ui';

interface Props {
  args: [],
  close: (ret: void) => void
}

let { args: _args, close }: Props = $props();

let inner: DialogBase;

type StyleToggle = { style: SubtitleStyle, enabled: boolean };

type Counts = {
  entries: number,
  lines: number,
  words: number,
  characters: number,
  letters: number,
  numbers: number,
  punctuations: number,
  whitespaces: number,
  others: number,
};

const LETTER = /\p{L}/u;
const NUMBER = /\p{N}/u;
const PUNCTUATION = /\p{P}/u;
const WHITESPACE = /\p{White_Space}/u;

function countWords(text: string) {
  return text.split(/\s+/).length;
}

function classify(ch: string, c: Counts) {
  if (LETTER.test(ch)) c.letters++;
  else if (NUMBER.test(ch)) c.numbers++;
  else if (PUNCTUATION.test(ch)) c.punctuations++;
  else if (WHITESPACE.test(ch)) c.whitespaces++;
  else c.others++;
}

let styles = $state<StyleToggle[]>([]);
let selectionOnly = $state(false);
let selectionAvailable = $state(false);

let counts = $derived.by(() => {
  const enabled = new Set<SubtitleStyle>();
  for (const t of styles)
    if (t.enabled) enabled.add(t.style);

  const entries = selectionOnly ? Selection.entries : Source.subs.entries;
  const c: Counts = {
    entries: 0,
    lines: 0, words: 0, characters: 0,
    letters: 0, numbers: 0, punctuations: 0, whitespaces: 0, others: 0,
  };

  for (const entry of entries) {
    let isEntry = false;
    for (const [style, text] of entry.texts) {
      if (!enabled.has(style)) continue;
      isEntry = true;
      c.lines++;
      const str = RichText.toString(text);
      c.words += countWords(str);
      for (const ch of str) {
        classify(ch, c);
        c.characters++;
      }
    }
    if (isEntry) c.entries++;
  }

  return c;
});

onMount(async () => {
  const used = new Set<SubtitleStyle>();
  for (const entry of Source.subs.entries)
    for (const style of entry.texts.keys())
      used.add(style);
  styles = Source.subs.styles
    .filter((style) => used.has(style))
    .map((style) => ({ style, enabled: true }));
  selectionAvailable = Selection.size > 0;

  await inner.showModal!();
  close();
});
</script>

<DialogBase bind:this={inner} buttons={[{
  name: 'close',
  localizedName: () => $_('wordcountdialog.close')
}]}>
  {#snippet header()}
    <h4>{$_('wordcountdialog.header')}</h4>
  {/snippet}

  <div class="container">
    <div style="flex-grow: 1;">
      <ConfigTable>
        <ConfigRow name={$_('wordcountdialog.entry-count')}>
          {counts.entries}
        </ConfigRow>
        <ConfigRow name={$_('wordcountdialog.line-count')}>
          {counts.lines}
          <Tooltip position='right'
            text={$_('wordcountdialog.line-count-d')} />
          <hr>
        </ConfigRow>
        <ConfigRow name={$_('wordcountdialog.word-count')}>
          {counts.words}
          <Tooltip position='right'
            text={$_('wordcountdialog.word-count-d')} />
        </ConfigRow>
        <ConfigRow name={$_('wordcountdialog.character-count')}>
          {counts.characters}
        </ConfigRow>
        <ConfigRow name={$_('wordcountdialog.letters')}>
          {counts.letters}
        </ConfigRow>
        <ConfigRow name={$_('wordcountdialog.numbers')}>
          {counts.numbers}
        </ConfigRow>
        <ConfigRow name={$_('wordcountdialog.punctuations')}>
          {counts.punctuations}
        </ConfigRow>
        <ConfigRow name={$_('wordcountdialog.whitespaces')}>
          {counts.whitespaces}
        </ConfigRow>
        <ConfigRow name={$_('wordcountdialog.others')}>
          {counts.others}
        </ConfigRow>
      </ConfigTable>
      <hr>
      <label>
        <input type="checkbox" bind:checked={selectionOnly} disabled={!selectionAvailable}>
        {$_('wordcountdialog.selection-only')}
      </label>
    </div>

    <fieldset>
      <legend>{$_('wordcountdialog.channels')}</legend>
      <ButtonStrip>
        <StripItem onclick={() => styles.forEach((x) => x.enabled = true)}>
          {$_('wordcountdialog.select-all')}
        </StripItem>
        <StripItem onclick={() => styles.forEach((x) => x.enabled = false)}>
          {$_('wordcountdialog.deselect-all')}
        </StripItem>
      </ButtonStrip>
      <div class="list">
        {#each styles as t (t.style)}
          <label>
            <input type="checkbox" bind:checked={t.enabled}>
            {t.style.name}
          </label>
        {/each}
      </div>
    </fieldset>
  </div>
</DialogBase>

<style lang='scss'>
  .container {
    min-width: 20em;

    display: flex;
    flex-direction: row;
    gap: 20px
  }

  .list {
    display: flex;
    flex-direction: column;
    overflow-y: auto;
    padding-top: 10px;
  }

  fieldset {
    border-radius: 2px;
    border: 1px solid gray;
    padding: 5px 10px 10px 7px;
  }

  label {
    display: flex;
    flex-direction: row;
    align-items: start;
    input {
      margin-right: 5px;
    }
  }
</style>
