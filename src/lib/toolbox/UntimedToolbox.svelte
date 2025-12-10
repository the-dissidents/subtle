<script lang="ts" module>
import { UICommand } from "../frontend/CommandBase";
import { CommandBinding, KeybindingManager } from '../frontend/Keybinding';
import { get } from "svelte/store";

const tokenizers = {
  'default': fuzzyAlgorithm.DefaultTokenizer,
  'character': fuzzyAlgorithm.CharacterTokenizer,
  'syllable': fuzzyAlgorithm.SyllableTokenizer,
};

let textarea: HTMLTextAreaElement;

let fuzzy = $state({
  enabled: false,
  tokenizer: 'character' as keyof typeof tokenizers,
  useStyle: Source.subs.defaultStyle,
  engine: null as fuzzyAlgorithm.Searcher | null,
  currentEntry: null as SubtitleEntry | null
});

function offset(from: number, dir: 'left' | 'right') {
  const text = textarea.value;
  if (dir == 'right' && from == text.length) return from;
  if (dir == 'left' && from == 0) return from;

  if (!fuzzy.engine)
    return from + (dir == 'right' ? 1 : -1);

  const prefix = fuzzy.engine.prefixLengthList();
  let result = dir == 'right' 
    ? prefix.find((x) => x > from) 
    : prefix.findLast((x) => x < from);
  Debug.assert(result !== undefined);
  return result;
}

const UntimedCommands = {
  shiftStartPointLeft: new UICommand(() => get(_)('category.fuzzy'), 
    [ CommandBinding.from(['Z'], ['Table', 'Other']) ],
  {
    name: () => get(_)('untimed.fuzzy.action-start-left'),
    isApplicable: () => fuzzy.enabled,
    call: () => textarea.selectionStart = offset(textarea.selectionStart, 'left')
  }),
  shiftStartPointRight: new UICommand(() => get(_)('category.fuzzy'), 
    [ CommandBinding.from(['X'], ['Table', 'Other']) ],
  {
    name: () => get(_)('untimed.fuzzy.action-start-right'),
    isApplicable: () => fuzzy.enabled,
    call: () => textarea.selectionStart = offset(textarea.selectionStart, 'right')
  }),
  shiftEndPointLeft: new UICommand(() => get(_)('category.fuzzy'), 
    [ CommandBinding.from(['C'], ['Table', 'Other']) ],
  {
    name: () => get(_)('untimed.fuzzy.action-end-left'),
    isApplicable: () => fuzzy.enabled,
    call: () => textarea.selectionEnd = offset(textarea.selectionEnd, 'left')
  }),
  shiftEndPointRight: new UICommand(() => get(_)('category.fuzzy'), 
    [ CommandBinding.from(['V'], ['Table', 'Other']) ],
  {
    name: () => get(_)('untimed.fuzzy.action-end-right'),
    isApplicable: () => fuzzy.enabled,
    call: () => textarea.selectionEnd = offset(textarea.selectionEnd, 'right')
  }),
  applyMatch: new UICommand(() => get(_)('category.fuzzy'), 
    [ CommandBinding.from(['A'], ['Table', 'Other']) ],
  {
    name: () => get(_)('untimed.fuzzy.action-apply-match'),
    isApplicable: () => fuzzy.enabled,
    call: () => {
      if (fuzzy.currentEntry !== Editing.getFocusedEntry())
        return Debug.early();

      Debug.assert(fuzzy.useStyle !== null && fuzzy.currentEntry !== null);
      Editing.focused.style.set(fuzzy.useStyle);
      const str = textarea.value
        .substring(textarea.selectionStart, textarea.selectionEnd);
      if (fuzzy.currentEntry.texts.get(fuzzy.useStyle) != str) {
        fuzzy.currentEntry.texts.set(fuzzy.useStyle, str);
        Source.markChanged(ChangeType.InPlace, get(_)('c.fuzzy-replace'));
      }
    }
  }),
};
KeybindingManager.register(UntimedCommands);
</script>

<script lang="ts">
import * as clipboard from "@tauri-apps/plugin-clipboard-manager";
import * as dialog from "@tauri-apps/plugin-dialog";
import { onDestroy } from "svelte";

import { SubtitleEntry } from "../core/Subtitles.svelte";
import { Debug } from "../Debug";
import * as fuzzyAlgorithm from "../details/Fuzzy";
import { EventHost } from "../details/EventHost";

import StyleSelect from "../StyleSelect.svelte";
import Collapsible from "../ui/Collapsible.svelte";
import NumberInput from "../ui/NumberInput.svelte";

import { Editing, SelectMode } from "../frontend/Editing";
import { Frontend } from "../frontend/Frontend";
import { ChangeType, Source } from "../frontend/Source";

import { _ } from 'svelte-i18n';
import { Memorized } from "../config/MemorizedValue.svelte";
import * as z from "zod/v4-mini";

let fillAsStyle = $state(Source.subs.defaultStyle);
let selection = $state<SubtitleEntry[]>([]);
let focusedEntry = Editing.focused.entry;

async function fillIn(range: SubtitleEntry[]) {
  const separator = useDoubleNewline ? '\n\n' : '\n';
  const lines = Source.subs.metadata.special.untimedText.split(separator);

  if (lines.length < range.length) {
    if (!await dialog.confirm($_('untimed.fill-in.too-long-msg', 
      {values: { a: range.length, b: lines.length }}))) return false;
    range = range.slice(0, lines.length);
  }
  const already = range.filter((x) => x.texts.has(fillAsStyle));
  if (already.length > 0
   && !await dialog.confirm($_('untimed.fill-in.already-has-style-msg', 
    {values: { a: already.length, b: fillAsStyle.name }}))) return false;

  range.forEach((x) => Editing.fillWithFirstLineOfUntimed(x, fillAsStyle, separator));
  Source.markChanged(ChangeType.InPlace, $_('c.fill-with-untimed'));
  return true;
}

let locked = Memorized.$('untimedLocked', z.boolean(), false);
let textsize = Memorized.$('untimedTextSize', z.number().check(z.positive()), 14);
let justify = Memorized.$('untimedJustify', z.boolean(), true);
let useForNew = Editing.useUntimedForNewEntires;
let useDoubleNewline = Memorized.$('untimedDoubleNewline', z.boolean(), false);

let subs = $state(Source.subs);
let threshold = Memorized.$('fuzzyThreshold', z.number(), 0.6);
let snapToWord = Memorized.$('fuzzySnapToWord', z.boolean(), true);
let snapToPunct = Memorized.$('fuzzySnapToPunct', z.boolean(), false);

let changed = false;

const me = {};
onDestroy(() => EventHost.unbind(me));

Source.onSubtitleObjectReload.bind(me, () => {
  subs = Source.subs;
  fuzzy.useStyle = Source.subs.defaultStyle;
  fillAsStyle = Source.subs.defaultStyle;
});

Editing.onSelectionChanged.bind(me, () => {
  selection = Editing.getSelection();
  fuzzyMatch();
});

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
    Frontend.setStatus($_('untimed.fuzzy.search-failed-to-find-anything'));
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
    Frontend.setStatus($_('untimed.fuzzy.match-found', {values: {x: result.matchRatio}}));
  }
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

  // Since you must focus on the textarea in order to setSelectionRange, but doing 
  // so changes the UIFocus, we must change it back afterwards.
  const focus = Frontend.getUIFocus();
  textarea.focus();
  textarea.setSelectionRange(selectionStart, selectionEnd);
  Frontend.uiFocus.set(focus);
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
    oninput={() => {
      changed = true;
      Source.markChangedNonSaving();
    }}
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
      </tbody>
    </table>
  </Collapsible>
  <Collapsible header={$_('untimed.fill-in.header')}>
    <label>
      <input type='checkbox' bind:checked={$useDoubleNewline}/>使用双换行作为分隔符
    </label>
    <h5>{$_('untimed.fill-in.new-entries')}</h5>
    <label>
      <input id='just' type='checkbox' bind:checked={$useForNew}/>启用（每次一行）
    </label>
    <br />
    <h5>{$_('untimed.fill-in.existing-entries')}</h5>
    <label>
      {$_('untimed.fill-in.with-style')}<StyleSelect bind:currentStyle={fillAsStyle} />
    </label>
    <button disabled={!($focusedEntry instanceof SubtitleEntry)}
      onclick={async () => {
        if (!($focusedEntry instanceof SubtitleEntry))
          return Debug.early();
        if (await fillIn([$focusedEntry]))
          Editing.offsetFocus(1, SelectMode.Single);
      }}
    >{$_('untimed.fill-in.this-entry')}</button>
    <button disabled={selection.length == 0}
      onclick={() => fillIn(selection)}
    >{$_('untimed.fill-in.selection')}</button>
  </Collapsible>
  <Collapsible header={$_('untimed.fuzzy.header')}
    showCheck={true} bind:checked={fuzzy.enabled}
    onCheckedChanged={(x) => {
      if (x) {
        $locked = true;
        fuzzyMatch();
      }
    }}
    helpText={$_('untimed.fuzzy.help')}
  >
    <fieldset disabled={!fuzzy.enabled}>
      <table class="config">
        <tbody>
          <tr>
            <td>{$_('untimed.fuzzy.channel')}</td>
            <td><StyleSelect bind:currentStyle={fuzzy.useStyle} /></td>
          </tr>
          <tr>
            <td>{$_('untimed.fuzzy.tokenizer')}</td>
            <td>
              <select name="tokenizer" onchange={(x) => {
                if (x.currentTarget.value != fuzzy.tokenizer) {
                  fuzzy.tokenizer = x.currentTarget.value as keyof typeof tokenizers;
                  fuzzy.engine = null;
                  fuzzyMatch();
                }
              }} >
                <option value="character">{$_('untimed.fuzzy.each-character')}</option>
                <option value="default">{$_('untimed.fuzzy.word-cjk-character')}</option>
                <option value="syllable">{$_('untimed.fuzzy.syllable-cjk-character')}</option>
              </select>
            </td>
          </tr>
          <tr>
            <td>{$_('untimed.fuzzy.threshold')}</td>
            <td><NumberInput bind:value={$threshold} onchange={() => fuzzyMatch()}
              min='0' max='1' step='0.1'/></td>
          </tr>
          <tr>
            <td>{$_('untimed.fuzzy.snap-to-whole-words')}</td>
            <td>
              <input type='checkbox' bind:checked={$snapToWord} onchange={() => fuzzyMatch()}/>
            </td>
          </tr>
          <tr>
            <td>{$_('untimed.fuzzy.snap-to-following-punctuation')}</td>
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
