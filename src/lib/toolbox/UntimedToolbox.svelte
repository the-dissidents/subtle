<script lang="ts">
import * as clipboard from "@tauri-apps/plugin-clipboard-manager";
import * as dialog from "@tauri-apps/plugin-dialog";
import { onDestroy } from "svelte";

import { assert, Basic } from "../Basic";
import type { SubtitleChannel, SubtitleEntry } from "../core/Subtitles.svelte";
import * as fuzzyAlgorithm from "../Fuzzy";

import StyleSelect from "../StyleSelect.svelte";
import Collapsible from "../ui/Collapsible.svelte";

import { Dialogs } from "../frontend/Dialogs";
import { Editing } from "../frontend/Editing";
import { EventHost } from "../frontend/Frontend";
import { Interface, UIFocus } from "../frontend/Interface";
import { ChangeCause, ChangeType, Source } from "../frontend/Source";

import { _ } from 'svelte-i18n';

let locked = $state(false);
let textsize = $state(14);
let justify = $state(true);

let fuzzy = $state({
  enabled: false,
  maxSkip: 3,
  minScore: 0.5,
  channel: Source.subs.defaultStyle,
  snapToPunct: true,
  tokenizer: 'default',
  engine: null as fuzzyAlgorithm.Searcher | null,
  currentChannel: null as SubtitleChannel | null,
  currentEntry: null as SubtitleEntry | null
});

$effect(() => {
  if (fuzzy.enabled) {
    locked = true;
    fuzzyMatch();
  }
});

let textarea: HTMLTextAreaElement;

const me = {};
onDestroy(() => EventHost.unbind(me));

Source.onSubtitleObjectReload.bind(me, readFromSubs);
Editing.onSelectionChanged.bind(me, fuzzyMatch);

function updateToSubs() {
  if (Source.subs.metadata.special.untimedText == textarea.value) return;
  Source.subs.metadata.special.untimedText = textarea.value;
  fuzzy.engine = null;
  Source.markChanged(ChangeType.Metadata, ChangeCause.Action);
}

function readFromSubs() {
  textarea.value = Source.subs.metadata.special.untimedText;
  fuzzy.channel = Source.subs.defaultStyle;
}

function fuzzyMatch() {
  if (!fuzzy.enabled) return;

  let current = Editing.selection.focused?.texts.find(
    (x) => x.style.uniqueID == fuzzy.channel.uniqueID);
  if (!current || current.text == '' || textarea.value == '') {
    console.log('no current', Editing.selection)
    fuzzy.currentChannel = null;
    fuzzy.currentEntry = null;
    textarea.selectionEnd = textarea.selectionStart;
    return;
  }
  if (current.text == fuzzy.currentChannel?.text) return;
  fuzzy.currentChannel = current;
  fuzzy.currentEntry = Editing.selection.focused;

  // create engine if necessary
  if (fuzzy.engine === null) {
    let tokenizer: fuzzyAlgorithm.Tokenizer;
    switch (fuzzy.tokenizer) {
      case 'syllable':
        tokenizer = fuzzyAlgorithm.SyllableTokenizer; break;
      case 'regexb':
        tokenizer = new fuzzyAlgorithm.RegexTokenizer([/\b/]); break;
      case 'default':
      default:
        tokenizer = fuzzyAlgorithm.DefaultTokenizer; break;
    }
    fuzzy.engine = new fuzzyAlgorithm.Searcher(textarea.value, tokenizer);
  }

  // perform search
  const fail = () => {
    textarea.selectionEnd = textarea.selectionStart;
    Interface.status.set($_('untimed.fuzzy-search-failed-to-find-anything'));
  };
  let result = fuzzy.engine.search(current.text, fuzzy.maxSkip);
  if (!result) {
    fail();
    return;
  }
  let [i0, i1, n, m] = result;
  if (n / m < fuzzy.minScore) {
    fail();
    return;
  }
  // snap to punctuation
  if (fuzzy.snapToPunct && textarea.value.length > i1 
    && !/\p{P}/u.test(textarea.value[i1-1]) && /\p{P}/u.test(textarea.value[i1])) i1++;
  // trim whitespaces
  while (i1 > 0 && /\s/.test(textarea.value[i1-1])) i1--;
  while (i0 < textarea.value.length && /\s/.test(textarea.value[i0])) i0++;
  // display
  if (i0 >= i1) fail(); else {
    setSelectionAndScroll(i0, i1);
    Interface.status.set($_('untimed.fuzzy-match-found', {values: {x: n / m}}));
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
  assert(result !== undefined);
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
    textarea.setSelectionRange(selectionStart, selectionEnd);
}

async function paste() {
  let text = await clipboard.readText();
  if (text.length > 500000 && !await dialog.confirm(
    'The text in your clipboard is very long. Proceed to import?', 
    {kind: 'warning'})) return;
  textarea.value = text;
  updateToSubs();
}

function clear() {
  textarea.value = '';
  updateToSubs();
}
</script>

<svelte:document 
  onkeydown={(ev) => {
    if (fuzzy.enabled) {
      if (ev.getModifierState(Basic.ctrlKey()) || ev.altKey) return;
      if (Dialogs.modalOpenCounter > 0) return;
      if (document.activeElement !== textarea && Interface.getUIFocus() !== UIFocus.Table) return;

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
          console.warn('current entry is not fuzzy.currentEntry, but', focused);
          return;
        }

        ev.preventDefault();
        let str = textarea.value.substring(
          textarea.selectionStart, textarea.selectionEnd);

        assert(fuzzy.currentChannel !== null);
        if (fuzzy.currentChannel.text != str) {
          fuzzy.currentChannel.text = str;
          Source.markChanged(ChangeType.InPlace, ChangeCause.Action);
        }
        // the above causes the UI to refresh, so we delay a bit
        setTimeout(() => {
          Editing.selection.focused = fuzzy.currentEntry;
          Editing.focused.style = fuzzy.channel;
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
      <input type='checkbox' class="button" bind:checked={locked} id='lock'/>
      {$_('untimed.lock')}
    </label>
  </div>
  <textarea class="flexgrow" class:justify
    readonly={locked}
    style="min-height: 150px; font-size: {textsize}px"
    onblur={() => updateToSubs()}
    bind:this={textarea}></textarea>
  <div>
    <Collapsible header={$_('untimed.display')}>
      <table class="config">
        <tbody>
          <tr>
            <td>{$_('untimed.text-size')}</td>
            <td><input id='size' type='number' bind:value={textsize}/></td>
          </tr>
          <tr>
            <td>{$_('untimed.justify')}</td>
            <td><input id='just' type='checkbox' bind:checked={justify}/></td>
          </tr>
        </tbody>
      </table>
    </Collapsible>
  </div>
  <div>
    <Collapsible header='Fuzzy proofreading [EXPERIMENTAL]'
      showCheck={true} bind:checked={fuzzy.enabled}
      helpText="Matches currently selected subtitle text with phrases in the untimed text using a fuzzy algorithm. Usage: arrow keys to adjust selection; space to replace."
    >
      <fieldset disabled={!fuzzy.enabled}>
        <table class="config">
          <tbody>
            <tr>
              <td>{$_('untimed.channel')}</td>
              <td><StyleSelect bind:currentStyle={fuzzy.channel} /></td>
            </tr>
            <tr>
              <td>{$_('untimed.tokenizer')}</td>
              <td>
                <select name="tokenizer" onchange={(x) => {
                  if (x.currentTarget.value != fuzzy.tokenizer) {
                    fuzzy.tokenizer = x.currentTarget.value;
                    fuzzy.engine = null;
                    fuzzyMatch();
                  }
                }} >
                  <option value="default">{$_('untimed.word-cjk-character')}</option>
                  <option value="syllable">{$_('untimed.syllable-cjk-character')}</option>
                  <option value="regexb">{$_('untimed.regex-b')}</option>
                  <!-- <option value="custom">custom</option> -->
                </select>
              </td>
            </tr>
            <tr>
              <td>max skip</td>
              <td><input type='number' bind:value={fuzzy.maxSkip} min='0' step='1'/></td>
            </tr>
            <tr>
              <td>threshold</td>
              <td><input type='number' bind:value={fuzzy.minScore} min='0' max='1'/></td>
            </tr>
            <tr>
              <td>
                <input id='snap' type='checkbox' bind:checked={justify}/>
              </td>
              <td>
                <label for='snap'>{$_('untimed.snap-to-following-punctuation')}</label>
              </td>
            </tr>
          </tbody>
        </table>
      </fieldset>
      <!-- <i></i> -->
    </Collapsible>
  </div>
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