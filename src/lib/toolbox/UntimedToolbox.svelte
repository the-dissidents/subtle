<script lang="ts">
import * as clipboard from "@tauri-apps/plugin-clipboard-manager";
import * as dialog from "@tauri-apps/plugin-dialog";
import { onDestroy } from "svelte";

import { Basic } from "../Basic";
import type { SubtitleEntry } from "../core/Subtitles.svelte";
import { Debug } from "../Debug";
import * as fuzzyAlgorithm from "../details/Fuzzy2";
import { EventHost } from "../details/EventHost";

import StyleSelect from "../StyleSelect.svelte";
import Collapsible from "../ui/Collapsible.svelte";
import NumberInput from "../ui/NumberInput.svelte";

import { Editing } from "../frontend/Editing";
import { Frontend } from "../frontend/Frontend";
import { ChangeCause, ChangeType, Source } from "../frontend/Source";

import { _ } from 'svelte-i18n';
import { Memorized } from "../config/MemorizedValue.svelte";
import * as z from "zod/v4-mini";

let locked = Memorized.$('untimedLocked', z.boolean(), false);
let textsize = Memorized.$('untimedTextSize', z.number().check(z.positive()), 14);
let justify = Memorized.$('untimedJustify', z.boolean(), true);
let useForNew = Editing.useUntimedForNewEntires;

let subs = $state(Source.subs);
let threshold = Memorized.$('fuzzyThreshold', z.number(), 0.6);
let snapToWord = Memorized.$('fuzzySnapToWord', z.boolean(), true);
let snapToPunct = Memorized.$('fuzzySnapToPunct', z.boolean(), false);

let fuzzy = $state({
  enabled: false,
  tokenizer: 'character' as keyof typeof tokenizers,
  useStyle: Source.subs.defaultStyle,
  engine: null as fuzzyAlgorithm.Searcher | null,
  currentEntry: null as SubtitleEntry | null
});

const tokenizers = {
  'default': fuzzyAlgorithm.DefaultTokenizer,
  'character': fuzzyAlgorithm.CharacterTokenizer,
  'syllable': fuzzyAlgorithm.SyllableTokenizer,
};

let textarea: HTMLTextAreaElement;
let changed = false;

const me = {};
onDestroy(() => EventHost.unbind(me));

Source.onSubtitleObjectReload.bind(me, () => {
  subs = Source.subs;
  fuzzy.useStyle = Source.subs.defaultStyle;
});

Editing.onSelectionChanged.bind(me, fuzzyMatch);

function markChanged() {
  if (!changed) return;
  changed = false;
  fuzzy.engine = null;
  Source.markChanged(ChangeType.Metadata, $_('c.metadata'));
}

function fuzzyMatch() {
  if (!fuzzy.enabled) return;

  fuzzy.currentEntry = Editing.selection.focused;
  const current = fuzzy.currentEntry?.texts?.get(fuzzy.useStyle);
  const haystack = textarea.value;

  if (!current || haystack == '') {
    fuzzy.currentEntry = null;
    textarea.selectionEnd = textarea.selectionStart;
    return;
  }

  // create engine if necessary
  if (fuzzy.engine === null) fuzzy.engine = 
    new fuzzyAlgorithm.Searcher(haystack, tokenizers[fuzzy.tokenizer]);

  // perform search
  const fail = () => {
    textarea.selectionEnd = textarea.selectionStart;
    Frontend.setStatus($_('untimed.fuzzy-search-failed-to-find-anything'));
  };

  const result = fuzzy.engine.search(current);
  if (!result || result.matchRatio < $threshold) {
    fail();
    return;
  }

  const latinOrNumber = /[\p{L}\d]/u;
  const punctuation = /\p{P}/u;
  const whitespace = /\s/;

  let start = result.start,
      end = result.end;      // not inclusive
  // snap to whole words
  if ($snapToWord) {
    while (start > 0 
        && latinOrNumber.test(haystack[start-1]) 
        && latinOrNumber.test(haystack[start])) start--;
    while (end < haystack.length
        && latinOrNumber.test(haystack[end-1]) 
        && latinOrNumber.test(haystack[end])) end++;
  }
  // snap to punctuation
  if ($snapToPunct && end < haystack.length
    && !punctuation.test(haystack[end-1]) 
    &&  punctuation.test(haystack[end])) end++;
  // trim whitespaces
  while (end > 0 && whitespace.test(haystack[end-1])) end--;
  while (start < haystack.length && whitespace.test(haystack[start])) start++;
  // display
  if (start >= end) fail(); else {
    setSelectionAndScroll(start, end);
    Frontend.setStatus($_('untimed.fuzzy-match-found', {values: {x: result.matchRatio}}));
  }
}

function offset(from: number, right: boolean) {
  const text = textarea.value;
  if (right && from == text.length) return from;
  if (!right && from == 0) return from;

  if (!fuzzy.engine)
    return from + (right ? 1 : -1);

  const prefix = fuzzy.engine.prefixLengthList();
  let result = right 
    ? prefix.find((x) => x > from) 
    : prefix.findLast((x) => x < from);
  Debug.assert(result !== undefined);
  return result;
}

// per https://stackoverflow.com/a/55111246
function setSelectionAndScroll(selectionStart: number, selectionEnd: number) {
    // First scroll selection region to view
    const fullText = textarea.value;
    textarea.value = fullText.substring(0, selectionEnd);
    // For some unknown reason, you must store the scollHeight to a variable
    // before setting the textarea value. Otherwise it won't work for long strings
    const scrollHeight = textarea.scrollHeight
    textarea.value = fullText;
    let scrollTop = scrollHeight;
    const textareaHeight = textarea.clientHeight;
    if (scrollTop > textareaHeight){
        // scroll selection to center of textarea
        scrollTop -= textareaHeight / 2;
    } else{
        scrollTop = 0;
    }
    textarea.scrollTop = scrollTop;

    // Continue to set selection range
    textarea.focus();
    textarea.setSelectionRange(selectionStart, selectionEnd);
}

async function paste() {
  let text = await clipboard.readText();
  if (text.length > 500000 && !await dialog.confirm(
    'The text in your clipboard is very long. Proceed to import?', 
    {kind: 'warning'})) return;
  Source.subs.metadata.special.untimedText = text;
  markChanged();
}

function clear() {
  Source.subs.metadata.special.untimedText = '';
  markChanged();
}
</script>

<svelte:document 
  onkeydown={(ev) => {
    if (fuzzy.enabled) {
      if (ev.getModifierState(Basic.ctrlKey) || ev.altKey) return;
      if (Frontend.modalOpenCounter > 0) return;
      if (document.activeElement !== textarea && Frontend.getUIFocus() !== 'Table') return;

      if (ev.key == 'z') {
        textarea.selectionStart = offset(textarea.selectionStart, false);
      } else if (ev.key == 'v') {
        textarea.selectionEnd = offset(textarea.selectionEnd, true);
      } else if (ev.key == 'x') {
        textarea.selectionStart = offset(textarea.selectionStart, true);
      } else if (ev.key == 'c') {
        textarea.selectionEnd = offset(textarea.selectionEnd, false);
      } else if (ev.key == 'a') {
        let focused = Editing.getFocusedEntry();
        if (fuzzy.currentEntry !== focused) {
          Debug.warn('current entry is not fuzzy.currentEntry, but', focused);
          return;
        }

        ev.preventDefault();
        let str = textarea.value.substring(
          textarea.selectionStart, textarea.selectionEnd);

        Debug.assert(fuzzy.useStyle !== null && fuzzy.currentEntry !== null);
        if (fuzzy.currentEntry.texts.get(fuzzy.useStyle) != str) {
          fuzzy.currentEntry.texts.set(fuzzy.useStyle, str);
          Source.markChanged(ChangeType.InPlace, $_('c.fuzzy-replace'));
        }
        // the above causes the UI to refresh, so we delay a bit
        setTimeout(() => {
          Editing.selection.focused = fuzzy.currentEntry;
          Editing.focused.style.set(fuzzy.useStyle);
          Editing.onSelectionChanged.dispatch(ChangeCause.Action);
          Editing.startEditingFocusedEntry();
        }, 0);
      } 
    }
  }}/>

<div class='vlayout fill'>
  <div class="hlayout">
    <button class="flexgrow" onclick={() => clear()}>{$_('untimed.clear')}</button>
    <button class="flexgrow" onclick={() => paste()}>{$_('untimed.paste')}</button>
    <label class="flexgrow" for='lock'>
      <input type='checkbox' class="button" bind:checked={$locked} id='lock'/>
      {$_('untimed.lock')}
    </label>
  </div>
  <textarea class={{flexgrow: true, justify: $justify}}
    readonly={$locked}
    style="min-height: 150px; font-size: {$textsize}px"
    oninput={() => changed = true}
    onblur={() => markChanged()}
    bind:value={subs.metadata.special.untimedText}
    bind:this={textarea}></textarea>
  <Collapsible header={$_('untimed.display')}>
    <table class="config">
      <tbody>
        <tr>
          <td>{$_('untimed.text-size')}</td>
          <td><input id='size' type='number' bind:value={$textsize}/></td>
        </tr>
        <tr>
          <td>{$_('untimed.justify')}</td>
          <td><input id='just' type='checkbox' bind:checked={$justify}/></td>
        </tr>
        <tr>
          <td>{$_('untimed.use-in-new-entries')}</td>
          <td><input id='just' type='checkbox' bind:checked={$useForNew}/></td>
        </tr>
      </tbody>
    </table>
  </Collapsible>
  <Collapsible header={$_('untimed.fuzzy-proofreading-tool')}
    showCheck={true} bind:checked={fuzzy.enabled}
    onCheckedChanged={(x) => {
      if (x) {
        $locked = true;
        fuzzyMatch();
      }
    }}
    helpText={$_('untimed.fuzzy-help')}
  >
    <fieldset disabled={!fuzzy.enabled}>
      <table class="config">
        <tbody>
          <tr>
            <td>{$_('untimed.channel')}</td>
            <td><StyleSelect bind:currentStyle={fuzzy.useStyle} /></td>
          </tr>
          <tr>
            <td>{$_('untimed.tokenizer')}</td>
            <td>
              <select name="tokenizer" onchange={(x) => {
                if (x.currentTarget.value != fuzzy.tokenizer) {
                  fuzzy.tokenizer = x.currentTarget.value as keyof typeof tokenizers;
                  fuzzy.engine = null;
                  fuzzyMatch();
                }
              }} >
                <option value="character">{$_('untimed.each-character')}</option>
                <option value="default">{$_('untimed.word-cjk-character')}</option>
                <option value="syllable">{$_('untimed.syllable-cjk-character')}</option>
              </select>
            </td>
          </tr>
          <tr>
            <td>{$_('untimed.threshold')}</td>
            <td><NumberInput bind:value={$threshold} onchange={() => fuzzyMatch()}
              min='0' max='1' step='0.1'/></td>
          </tr>
          <tr>
            <td>{$_('untimed.snap-to-whole-words')}</td>
            <td>
              <input type='checkbox' bind:checked={$snapToWord} onchange={() => fuzzyMatch()}/>
            </td>
          </tr>
          <tr>
            <td>{$_('untimed.snap-to-following-punctuation')}</td>
            <td>
              <input type='checkbox' bind:checked={$snapToPunct} onchange={() => fuzzyMatch()}/>
            </td>
          </tr>
        </tbody>
      </table>
    </fieldset>
    <!-- <i></i> -->
  </Collapsible>
</div>

<style>
  @media (prefers-color-scheme: light) {
    textarea[readonly] {
      background-color: var(--uchu-gray-1);
    }
  }
  
  @media (prefers-color-scheme: dark) {
    textarea[readonly] {
      background-color: var(--uchu-yin-6);
    }
  }

  textarea {
    resize: none;
  }
  input[type='number'] {
    width: 100%;
  }
  .justify {
    text-align: justify;
  }
</style>
