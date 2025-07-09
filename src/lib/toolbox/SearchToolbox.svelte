<!-- TODO: SearchToolbox.svelte
 1. only search for/replace one occurence at a time, and highlight it in the editing boxes
 2. note that clicking replace should replace the current occurence, and select the next
 2. make hotkeys for next/previous
-->
<script lang="ts" module>
export type SearchAction = 'select' | 'replace' | 'replaceStyles';
export type SearchOption = 'all' | 'next' | 'previous';

export type SearchHandler = {
  term: string,
  replaceTerm: string,
  useRegex: boolean,
  useEscapeSequenceInReplacement: boolean,
  caseSensitive: boolean,
  replaceStyle: SubtitleStyle,
  // todo: condition
  readonly execute: (action: SearchAction, dir: SearchOption) => void,
  readonly focus: () => void
};
</script>

<script lang="ts">
import { Basic } from '../Basic';
import { Labels, SubtitleEntry, type LabelType, type SubtitleStyle } from '../core/Subtitles.svelte';
import { Debug } from "../Debug";
import StyleSelect from '../StyleSelect.svelte';

import { Editing, SelectMode } from '../frontend/Editing';
import { Interface } from '../frontend/Interface';
import { ChangeCause, ChangeType, Source } from '../frontend/Source';

import { _ } from 'svelte-i18n';
import Collapsible from '../ui/Collapsible.svelte';
import FilterEdit from '../FilterEdit.svelte';
import { evaluateFilter, type MetricFilter } from '../core/Filter';
import { Toolboxes } from '../frontend/Toolboxes';
import Tooltip from '../ui/Tooltip.svelte';
    import { Frontend } from '../frontend/Frontend';
// import { Menu } from '@tauri-apps/api/menu';

const handler: SearchHandler = $state({
  term: '',
  replaceTerm: '',
  useRegex: false,
  useEscapeSequenceInReplacement: true,
  caseSensitive: true,
  replaceStyle: Source.subs.defaultStyle,
  execute,
  focus() {
    Frontend.toolboxFocus.set('search');
    setTimeout(() => termInput?.focus(), 0);
  }
});
Toolboxes.search = handler;

let termInput = $state<HTMLInputElement>();

// condition (simple)
let selectionOnly   = $state(false),
    useStyle        = $state(false), 
    useReplaceStyle = $state(false),
    useLabel        = $state(false);

let searchStyle  = $state(Source.subs.defaultStyle);
let label: LabelType = $state('none');

// condition (advanced)
let useFilter = $state(false);
let filter: MetricFilter | null = $state(null);

// states of ongoing search
let resumeFrom: {
  entry: SubtitleEntry,
  style: SubtitleStyle,
  fromIndex: number
} | null = null;

function test(entry: SubtitleEntry, style: SubtitleStyle): boolean {
  if (useFilter) {
    Debug.assert(filter !== null);
    return evaluateFilter(filter, entry, style).failed.length == 0;
  } else {
    // not using filter
    return (!useStyle || style.name === searchStyle.name)
        && (!selectionOnly || Editing.inSelection(entry))
        && (!useLabel || entry.label === label);
  }
}

function* iterate(
  startIndex: number, startStyleIndex: number, backwards = false
): Generator<[SubtitleEntry, SubtitleStyle, string, boolean], void, boolean> {
  const entries = Source.subs.entries;
  let first = true;
  for (let i = startIndex;
    i < entries.length && i >= 0;
    i += backwards ? -1 : 1) 
  {
    const entry = entries[i];
    for (let j = i == startIndex ? startStyleIndex : 0; 
      j < Source.subs.styles.length; j++)
    {
      const style = Source.subs.styles[j];
      const text = entry.texts.get(style);
      if (text === undefined || !test(entry, style)) continue;
      const skip = yield [entry, style, text, first];
      first = false;
      if (skip) break;
    }
  }
}

const replEscapedSequences = {
  't': '\t',
  'n': '\n',
  'v': '\v'
}

function processReplacement(original: string, match: RegExpExecArray, repl: string) {
  if (!handler.useEscapeSequenceInReplacement)
    return repl;
  let i = 0;
  let result = '';
  const digits = /\d{1,2}/y;
  while (i < repl.length) {
    const char = repl[i];
    if (char == '\\') {
      i++;
      if (i >= repl.length) {
        result += char;
        break;
      }
      const char2 = repl[i];
      result += (char2 in replEscapedSequences) 
        ? replEscapedSequences[char2 as keyof typeof replEscapedSequences] : char2;
    } else if (char == '$') {
      i++;
      if (i >= repl.length) {
        result += char;
        break;
      }
      const char2 = repl[i];
      if (char2 == '&') {
        result += match[0];
      } else if (char2 == '`') {
        result += original.slice(0, match.index);
      } else if (char2 == "'") {
        result += original.slice(match.index + match[0].length);
      } else if (char2 == '$') {
        result += '$';
      } else {
        digits.lastIndex = i;
        const match2 = digits.exec(repl);
        if (match2) {
          result += match[Number.parseInt(match2[0])] ?? '';
          i += match2[0].length - 1;
        } else {
          result += char + char2;
        }
      }
    } else {
      result += char;
    }
    i++;
  }
  return result;
}

async function execute(type: SearchAction, option: SearchOption) {
  const entries = Source.subs.entries;
  if (entries.length == 0) {
    Frontend.setStatus($_('msg.subtitle-is-empty'), 'error');
    return;
  }

  const focusedEntry = Editing.getFocusedEntry();
  let focus = focusedEntry instanceof SubtitleEntry ? focusedEntry : entries[0];
  if (selectionOnly) 
    focus = Source.subs.entries.find((x) => Editing.inSelection(x)) ?? focus;

  if (resumeFrom)
    if (resumeFrom.entry !== focus || option == "all")
      resumeFrom = null;

  if (useFilter && filter == null) {
    Frontend.setStatus($_('msg.filter-is-empty'), 'error');
    return;
  }

  let expr: RegExp;
  let usingEmptyTerm = false;
  if (handler.term !== '') {
    // construct regex from search term
    try {
      expr = new RegExp(
        handler.useRegex ? handler.term : Basic.escapeRegexp(handler.term), 
        `g${handler.caseSensitive ? '' : 'i'}`);
    } catch (e) {
      Debug.assert(e instanceof Error);
      Frontend.setStatus($_('msg.search-failed') + e.message, 'error');
      return;
    }
  } else if (useLabel || useStyle || useFilter) {
    // permit empty term if using conditions
    expr = /.*/;
    usingEmptyTerm = true;
  } else {
    Frontend.setStatus($_('msg.search-expression-is-empty'), 'error');
    return;
  }

  Debug.debug('executing search:', expr.source, type, option);

  if (type == "select" || !selectionOnly) {
    Editing.clearSelection(ChangeCause.Action);
  }

  const repl = type == "replace" ? handler.replaceTerm : '';
  const startIndex = option == "all" 
    ? 0 : Math.max(entries.indexOf(focus), 0);
  const styleIndex = resumeFrom ? Source.subs.styles.indexOf(resumeFrom.style) : 0;

  if (!resumeFrom && option !== 'all') {
    type = 'select';
    Debug.trace('no resumeFrom; falling back to select');
  }

  let nDone = 0, nEntries = 0;
  const gen = iterate(startIndex, styleIndex, option == 'previous');
  let res = gen.next(false);
  let newType = type;
  outer: while (!res.done) {
    const [entry, style, text, first] = res.value;
    // Debug.trace('search at', text);
    expr.lastIndex = (first && resumeFrom) ? resumeFrom.fromIndex : 0;

    if (!expr.test(text) || (first && resumeFrom && type == 'select')) {
      res = gen.next(false);
      continue;
    }

    // matched
    nEntries++;

    if (type == 'select' && option == 'all') {
      Editing.selection.submitted.add(entry);
      res = gen.next(true);
      Debug.trace('selected', text);
      continue; // selecting one channel suffices
    }

    let newStyle = style;
    if (newType == "replaceStyles"
      || (useReplaceStyle && newType == "replace"))
    {
      // FIXME: should warn when overwriting? or add an option
      entry.texts.delete(style);
      entry.texts.set(handler.replaceStyle, text);
      Debug.trace('replaced with style:', text);
      newStyle = handler.replaceStyle;
    }

    let match: RegExpExecArray | null;
    let newText = text;
    expr.lastIndex = (first && resumeFrom) ? resumeFrom.fromIndex : 0;
    while (match = expr.exec(newText)) {
      nDone++;
      if (newType == 'replace') {
        newText = newText.slice(0, match.index) 
          + processReplacement(text, match, repl) 
          + newText.slice(match.index + match[0].length);
        expr.lastIndex += repl.length - match[0].length;
      }
      if (option != "all") {
        if (newType == 'select') {
          // select this, and done
          Editing.selectEntry(entry, SelectMode.Single, ChangeCause.Action);
          Editing.focused.style.set(newStyle);
          setTimeout(() => {
            const editor = Editing.styleToEditor.get(newStyle);
            if (!editor) {
              Debug.warn('no editor', entry);
            } else {
              editor.focus();
              editor.scrollIntoView();
              editor.setSelectionRange(match!.index, match!.index + match![0].length);
            }
          }, 0);
          Debug.trace('done selecting', text);
          resumeFrom = { entry, style: newStyle, fromIndex: match.index };
          break outer;
        } else {
          // just replaced one, select next
          entry.texts.set(newStyle, newText);
          Debug.trace('replaced 1:', text, '->', newText);
          newType = 'select';
          Debug.trace('just replaced, start selecting');
        }
      }
    }

    if (type == 'replace') {
      entry.texts.set(newStyle, newText);
      Debug.trace('replacing:', text, '->', newText);
    }
    
    res = gen.next(false);
  }

  if (res.done) {
    // reached the end
    resumeFrom = null;
  }

  let status: string;
  if (nEntries > 0) {
    if (type == "select") {
      status = $_('search.selected-n-lines', {values: {n: nEntries}});
      // manually call this because we didn't use selectEntry etc.
      Editing.onSelectionChanged.dispatch(ChangeCause.Action);
    } else if (type == "replace" || type === "replaceStyles") {
      status = $_('search.replaced-n-lines', {values: {n: nDone, nEntries}});
      Source.markChanged(ChangeType.InPlace, $_('c.replace'));
    } else {
      status = $_('search.found-n-lines', {values: {n: nEntries}});
    }
  } else {
    status = $_('search.found-nothing');
    resumeFrom = null;
    if (option != "all") {
      Editing.clearFocus();
      Editing.onSelectionChanged.dispatch(ChangeCause.Action);
    }
  }
  Frontend.setStatus(status);
}
</script>

<input class='wfill' type="text"
  spellcheck="false" autocomplete="off"
  bind:value={handler.term}
  bind:this={termInput}
  id='expr' placeholder={$_('search.expression')}/>
<div class="hlayout">
  <input class='wfill' type="text"
    spellcheck="false" autocomplete="off"
    bind:value={handler.replaceTerm}
    id='repl' placeholder={$_('search.replace-term')}/>
  <!-- TODO: make a menu for inserting common escape sequences,
    but problem is that text inputs lose cursor once unfocused
    -->
  <!-- <button onclick={() => {
    Menu.new({items: [
      {
        text: $_('search.pattern.newline'),
        action() {
            
        },
      }
    ]}).then((x) => x.popup());
  }}>...</button> -->
</div>
<table class="wfill">
  <tbody>
    <tr>
      <td>
        <button class="left wfill" disabled>{$_('search.find')}</button>
      </td>
      <td class="hlayout">
        <button class="middle"
          onclick={() => execute("select", "next")}
        >{$_('search.next')}</button>
        <button class="middle"
          onclick={() => execute("select", "previous")}
        >{$_('search.previous')}</button>
        <button class="right flexgrow"
          onclick={() => execute("select", "all")}
        >{$_('search.all')}</button>
      </td>
    </tr>
    <tr>
      <td>
        <button class="left wfill" disabled>{$_('search.replace')}</button>
      </td>
      <td class="hlayout">
        <button class="middle"
          onclick={() => execute("replace", "next")}
        >{$_('search.next')}</button>
        <button class="middle"
          onclick={() => execute("replace", "previous")}
        >{$_('search.previous')}</button>
        <button class="middle"
          onclick={() => execute("replace", "all")}
        >{$_('search.all')}</button>
        <button class="right flexgrow"
          onclick={() => execute("replaceStyles", "all")}
        >{$_('search.only-styles')}</button>
      </td>
    </tr>
  </tbody>
</table>

<div class='form vlayout'>
  <h5>{$_('search.options')}</h5>
  <label>
    <input type='checkbox' bind:checked={handler.useRegex}/>
    {$_('search.use-regular-expressions')}
    <Tooltip text={$_('search.regex-help')} />
  </label>
  <label>
    <input type='checkbox' bind:checked={handler.useEscapeSequenceInReplacement}/>
    {$_('search.use-escape-sequences-in-replacement')}
    <Tooltip text={$_('search.escape-sequence-help')} />
  </label>
  <label><input type='checkbox' bind:checked={handler.caseSensitive}/>
    {$_('search.case-sensitive')}
  </label>
  <label><input type='checkbox' bind:checked={useReplaceStyle}/>
    {$_('search.replace-by-style')}
    <StyleSelect
      onsubmit={() => useReplaceStyle = true}
      bind:currentStyle={handler.replaceStyle}/>
  </label>

  <h5>{$_('search.range')}</h5>
  <Collapsible header={$_('search.simple')}
    active={!useFilter} checked={!useFilter}
    onActiveChanged={(a) => useFilter = !a}
  >
    <div class="form vlayout">
      <label><input type='checkbox' bind:checked={selectionOnly}/>
        {$_('search.search-only-in-selected-entries')}
      </label>
      <label><input type='checkbox' bind:checked={useLabel}/>
        {$_('search.search-only-in-label')}
        <select
          bind:value={label}
          oninput={() => useLabel = true}
        >
          {#each Labels as color}
          <option value={color}>{color}</option>
          {/each}
        </select>
      </label>
      <label><input type='checkbox' bind:checked={useStyle}/>
        {$_('search.search-only-in-style')}
        <StyleSelect
          onsubmit={() => useStyle = true}
          bind:currentStyle={searchStyle}/>
      </label>
    </div>
  </Collapsible>
  <Collapsible header={$_('search.advanced')}
    active={useFilter} checked={useFilter}
    onActiveChanged={(a) => useFilter = a}
  >
    <FilterEdit bind:filter
      availableContexts={['editing', 'entry', 'style', 'channel']} />
  </Collapsible>
</div>

<style>
  .form > * {
    margin-top: 2px;
  }

  .wfill {
    width: 100%;
  }

  table td {
    padding: 0;
  }
</style>