<!-- TODO: SearchToolbox.svelte
 1. only search for/replace one occurence at a time, and highlight it in the editing boxes
 2. note that clicking replace should replace the current occurence, and select the next
 2. make hotkeys for next/previous
-->
<script lang="ts">
import { Basic } from '../Basic';
import { Labels, SubtitleEntry, type LabelTypes, type SubtitleStyle } from '../core/Subtitles.svelte';
import { Debug } from "../Debug";
import StyleSelect from '../StyleSelect.svelte';

import { Editing, SelectMode } from '../frontend/Editing';
import { Interface } from '../frontend/Interface';
import { ChangeCause, ChangeType, Source } from '../frontend/Source';

import { _ } from 'svelte-i18n';
import Collapsible from '../ui/Collapsible.svelte';
import FilterEdit from '../FilterEdit.svelte';
import { evaluateFilter, type MetricFilter } from '../core/Filter';

let searchTerm  = $state(''),
    replaceTerm = $state('');

let useRegex        = $state(false), 
    caseSensitive   = $state(true);
    
// condition (simple)
let selectionOnly   = $state(false),
    useStyle        = $state(false), 
    useReplaceStyle = $state(false),
    useLabel        = $state(false);

let searchStyle  = $state(Source.subs.defaultStyle),
    replaceStyle = $state(Source.subs.defaultStyle);
let label: LabelTypes = $state('none');

// condition (advanced)
let useFilter = $state(false);
let filter: MetricFilter | null = $state(null);

// states of ongoing search
let resumeFrom: {
  entry: SubtitleEntry,
  style: SubtitleStyle
} | null = null;

enum SearchAction {
  Find, Select,
  Replace, ReplaceStyleOnly
}

enum SearchOption {
  None, Global, Reverse
}

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

function findAndReplace(type: SearchAction, option: SearchOption) {
  const entries = Source.subs.entries;
  if (entries.length == 0) return;

  const focusedEntry = Editing.getFocusedEntry();
  let focus = focusedEntry instanceof SubtitleEntry ? focusedEntry : entries[0];
  if (selectionOnly) 
    focus = Source.subs.entries.find((x) => Editing.inSelection(x)) ?? focus;

  if (resumeFrom)
    if (resumeFrom.entry !== focus || option == SearchOption.Global)
      resumeFrom = null;

  if (useFilter && filter == null) {
    Interface.status.set($_('msg.filter-is-empty'));
    return;
  }

  let expr: RegExp;
  let usingEmptyTerm = false;
  if (searchTerm !== '') {
    // construct regex from search term
    try {
      expr = new RegExp(
        useRegex ? searchTerm : Basic.escapeRegexp(searchTerm), 
        `g${caseSensitive ? '' : 'i'}`);
    } catch (e) {
      Debug.assert(e instanceof Error);
      Interface.status.set($_('msg.search-failed') + e.message);
      return;
    }
  } else if (useLabel || useStyle || useFilter) {
    // permit empty term if using conditions
    expr = /.*/;
    usingEmptyTerm = true;
  } else {
    Interface.status.set($_('msg.search-expression-is-empty'));
    return;
  }

  if (type == SearchAction.Select || !selectionOnly) {
    Editing.clearSelection(ChangeCause.Action);
  }

  let nDone = 0;
  const repl = type == SearchAction.Replace ? replaceTerm : '';
  const startIndex = option == SearchOption.Global 
    ? 0 : Math.max(entries.indexOf(focus), 0);
  const resumeFromStyleIndex = resumeFrom ? Source.subs.styles.indexOf(resumeFrom.style) : -1;
  const startStyleIndex = resumeFromStyleIndex + 1;

  outerLoop: for (
    let i = startIndex;
    i < entries.length && i >= 0;
    i += option == SearchOption.Reverse ? -1 : 1) 
  {
    const entry = entries[i];
    // loop over styles
    for (
      let j = i == startIndex ? startStyleIndex : 0; 
      j < Source.subs.styles.length; j++) 
    {
      const style = Source.subs.styles[j];
      const text = entry.texts.get(style);
      if (text === undefined || !test(entry, style)) continue;

      const replaced = text.replace(expr, repl);
      if (replaced != text) {
        nDone++;
        resumeFrom = { entry, style };
        if (type == SearchAction.Select) {
          Editing.selection.submitted.add(entry);
          break; // selecting one channel suffices
        }
        let focusStyle = searchStyle;
        if (type == SearchAction.ReplaceStyleOnly
          || (useReplaceStyle && type == SearchAction.Replace))
        {
          // FIXME: should warn when overwriting? or add an option
          entry.texts.delete(style);
          entry.texts.set(replaceStyle, replaced);
          focusStyle = replaceStyle;
        } else if (type == SearchAction.Replace) {
          entry.texts.set(style, replaced);
        }
        if (option != SearchOption.Global) {
          Editing.selectEntry(entry, SelectMode.Single, ChangeCause.Action);
          Editing.focused.style = focusStyle;
          break outerLoop;
        }
      }
    }
  }
  let status: string;
  if (nDone > 0) {
    if (type == SearchAction.Select) {
      status = $_('search.selected-n-lines', {values: {n: nDone}});
      // manually call this because we didn't use selectEntry etc.
      Editing.onSelectionChanged.dispatch(ChangeCause.Action);
    } else if (type == SearchAction.Replace || type === SearchAction.ReplaceStyleOnly) {
      status = $_('search.replaced-n-lines', {values: {n: nDone}});
      Source.markChanged(ChangeType.InPlace);
    } else {
      status = $_('search.found-n-lines', {values: {n: nDone}});
    }
  } else {
    status = $_('search.found-nothing');
    resumeFrom = null;
    if (option != SearchOption.Global) {
      Editing.clearFocus();
      Editing.onSelectionChanged.dispatch(ChangeCause.Action);
    }
  }
  Interface.status.set(status);
}
</script>

<input class='wfill' type="text" bind:value={searchTerm}
  id='expr' placeholder={$_('search.expression')}/>
<input class='wfill' type="text" bind:value={replaceTerm}
  id='repl' placeholder={$_('search.replace-term')}/>

  <table class="wfill">
    <tbody>
      <tr>
        <td>
          <button class="left wfill" disabled>{$_('search.find')}</button>
        </td>
        <td class="hlayout">
          <button class="middle"
            onclick={() => findAndReplace(SearchAction.Find, SearchOption.None)}
          >{$_('search.next')}</button>
          <button class="middle"
            onclick={() => findAndReplace(SearchAction.Find, SearchOption.Reverse)}
          >{$_('search.previous')}</button>
          <button class="right flexgrow"
            onclick={() => findAndReplace(SearchAction.Select, SearchOption.Global)}
          >{$_('search.all')}</button>
        </td>
      </tr>
      <tr>
        <td>
          <button class="left wfill" disabled>{$_('search.replace')}</button>
        </td>
        <td class="hlayout">
          <button class="middle"
            onclick={() => findAndReplace(SearchAction.Replace, SearchOption.None)}
          >{$_('search.next')}</button>
          <button class="middle"
            onclick={() => findAndReplace(SearchAction.Replace, SearchOption.Reverse)}
          >{$_('search.previous')}</button>
          <button class="middle"
            onclick={() => findAndReplace(SearchAction.Replace, SearchOption.Global)}
          >{$_('search.all')}</button>
          <button class="right flexgrow"
            onclick={() => findAndReplace(SearchAction.ReplaceStyleOnly, SearchOption.Global)}
          >{$_('search.only-styles')}</button>
        </td>
      </tr>
    </tbody>
  </table>

<div class='form vlayout'>
  <h5>{$_('search.options')}</h5>
  <label><input type='checkbox' bind:checked={useRegex}/>
    {$_('search.use-regular-expressions')}
  </label>
  <label><input type='checkbox' bind:checked={caseSensitive}/>
    {$_('search.case-sensitive')}
  </label>
  <label><input type='checkbox' bind:checked={useReplaceStyle}/>
    {$_('search.replace-by-style')}
    <StyleSelect
      onsubmit={() => useReplaceStyle = true}
      bind:currentStyle={replaceStyle}/>
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
    <FilterEdit bind:filter />
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