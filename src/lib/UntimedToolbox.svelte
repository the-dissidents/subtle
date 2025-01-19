<script lang="ts">
  import { onDestroy } from "svelte";
  import { ChangeCause, ChangeType, UIFocus, type Frontend } from "./Frontend";
  import Collapsible from "./ui/Collapsible.svelte";
  import * as clipboard from "@tauri-apps/plugin-clipboard-manager"
  import * as dialog from "@tauri-apps/plugin-dialog"
  import StyleSelect from "./StyleSelect.svelte";
  import * as fuzzyAlgorithm from "./Fuzzy";
  import { assert, Basic } from "./Basic";
    import type { SubtitleChannel, SubtitleEntry } from "./Subtitles";

  export let frontend: Frontend;
  export let locked = false;

  let textsize = 14;
  let justify = true;
  let textarea: HTMLTextAreaElement;

  let fuzzy = {
    enabled: false,
    maxSkip: 3,
    minScore: 0.5,
    channel: frontend.subs.defaultStyle,
    snapToPunct: true,
    tokenizer: 'default',
    engine: null as fuzzyAlgorithm.Searcher | null,
    currentChannel: null as SubtitleChannel | null,
    currentEntry: null as SubtitleEntry | null
  }

  frontend.onSubtitleObjectReload.bind(readFromSubs);
  onDestroy(() => frontend.onSubtitleObjectReload.unbind(readFromSubs));

  frontend.onSelectionChanged.bind(fuzzyMatch);
  onDestroy(() => frontend.onSelectionChanged.unbind(fuzzyMatch));

  $: if (fuzzy.enabled) {
    locked = true;
    fuzzyMatch();
  }

  function updateToSubs() {
    if (frontend.subs.metadata.special.untimedText == textarea.value) return;
    frontend.subs.metadata.special.untimedText = textarea.value;
    fuzzy.engine = null;
    frontend.markChanged(ChangeType.Metadata, ChangeCause.Action);
  }

  function readFromSubs() {
    textarea.value = frontend.subs.metadata.special.untimedText;
    fuzzy.channel = frontend.subs.defaultStyle;
  }

  function fuzzyMatch() {
    if (!fuzzy.enabled) return;

    let current = frontend.selection.currentStart?.texts.find(
      (x) => x.style.uniqueID == fuzzy.channel.uniqueID);
    if (!current || current.text == '' || textarea.value == '') {
      console.log('no current', frontend.selection)
      fuzzy.currentChannel = null;
      fuzzy.currentEntry = null;
      textarea.selectionEnd = textarea.selectionStart;
      return;
    }
    if (current.text == fuzzy.currentChannel?.text) return;
    fuzzy.currentChannel = current;
    fuzzy.currentEntry = frontend.selection.currentStart;

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
      frontend.status = 'fuzzy search failed to find anything';
      frontend.onStatusChanged.dispatch();
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
      frontend.status = `fuzzy match found (${(n / m * 100).toFixed(0)}%)`;
      frontend.onStatusChanged.dispatch();
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
  on:keydown={(ev) => {
    if (fuzzy.enabled) {
      if (ev.getModifierState(Basic.ctrlKey()) || ev.altKey) return;
      if (frontend.states.modalOpenCounter > 0) return;
      if (document.activeElement !== textarea && frontend.states.uiFocus !== UIFocus.Table) return;

      if (ev.key == 'z') {
        textarea.selectionStart = offset(textarea.selectionStart, false);
      } else if (ev.key == 'v') {
        textarea.selectionEnd = offset(textarea.selectionEnd, true);
      } else if (ev.key == 'x') {
        textarea.selectionStart = offset(textarea.selectionStart, true);
      } else if (ev.key == 'c') {
        textarea.selectionEnd = offset(textarea.selectionEnd, false);
      } else if (ev.key == 'a') {
        if (fuzzy.currentEntry !== frontend.focused.entry) {
          console.warn('current entry is not fuzzy.currentEntry, but', 
            frontend.focused.entry);
          return;
        }

        ev.preventDefault();
        let str = textarea.value.substring(
          textarea.selectionStart, textarea.selectionEnd);

        assert(fuzzy.currentChannel !== null);
        if (fuzzy.currentChannel.text != str) {
          fuzzy.currentChannel.text = str;
          frontend.markChanged(ChangeType.TextOnly, ChangeCause.Action);
        }
        // the above causes the UI to refresh, so we delay a bit
        setTimeout(() => {
          frontend.focused.entry = fuzzy.currentEntry;
          frontend.focused.style = fuzzy.channel;
          frontend.startEditingFocusedEntry();
        }, 0);
      } 
    }
  }}/>

<div class='vlayout fill'>
  <div class="hlayout">
    <button class="flexgrow" on:click={() => clear()}>clear</button>
    <button class="flexgrow" on:click={() => paste()}>paste</button>
    <label class="flexgrow" for='lock'>
      <input type='checkbox' class="button" bind:checked={locked} id='lock'/>
      lock
    </label>
  </div>
  <textarea class="flexgrow" class:justify
    readonly={locked}
    style="min-height: 150px; font-size: {textsize}px"
    on:blur={() => updateToSubs()}
    bind:this={textarea}/>
  <div>
    <Collapsible header='Display'>
      <table class="config">
        <tr>
          <td>text size</td>
          <td><input id='size' type='number' bind:value={textsize}/></td>
        </tr>
        <tr>
          <td>justify</td>
          <td><input id='just' type='checkbox' bind:checked={justify}/></td>
        </tr>
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
          <tr>
            <td>channel</td>
            <td><StyleSelect subtitles={frontend.subs} 
              bind:currentStyle={fuzzy.channel} /></td>
          </tr>
          <tr>
            <td>tokenizer</td>
            <td>
              <select name="tokenizer" on:change={(x) => {
                if (x.currentTarget.value != fuzzy.tokenizer) {
                  fuzzy.tokenizer = x.currentTarget.value;
                  fuzzy.engine = null;
                  fuzzyMatch();
                }
              }} >
                <option value="default">word / CJK character</option>
                <option value="syllable">syllable / CJK character</option>
                <option value="regexb">regex \b</option>
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
              <label for='snap'>snap to following punctuation</label>
            </td>
          </tr>
        </table>
      </fieldset>
      <!-- <i></i> -->
      
    </Collapsible>
  </div>
</div>

<style>
  textarea {
    resize: none;
  }
  textarea[readonly] {
    background-color: #f9f9f9;
  }
  input[type='number'] {
    width: 100%;
  }
  .justify {
    text-align: justify;
  }
</style>