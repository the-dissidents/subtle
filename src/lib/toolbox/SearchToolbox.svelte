<script lang="ts">
	import { Labels, SubtitleEntry, type LabelTypes } from '../core/Subtitles.svelte'
	import StyleSelect from '../StyleSelect.svelte';
	import { assert, Basic } from '../Basic';
	
    import { ChangeCause, ChangeType, Source } from '../frontend/Source';
    import { Editing, SelectMode } from '../frontend/Editing';
    import { Interface } from '../frontend/Interface';

	import { _ } from 'svelte-i18n';
	
	let searchTerm = '';
	let replaceTerm = '';
	let useRegex = false, caseSensitive = true, selectionOnly = false;
	let useStyle = false, replaceStyle = false;
	let style1 = Source.subs.defaultStyle;
	let style2 = Source.subs.defaultStyle;

	let useLabel = false;
	let label: LabelTypes = 'none';

	let currentEntry: SubtitleEntry | null = null;
	let currentTextIndex = 0;

	enum SearchAction {
		Find, Select,
		Replace, ReplaceStyleOnly
	}

	enum SearchOption {
		None, Global, Reverse
	}

	function findAndReplace(type: SearchAction, option: SearchOption) {
		const entries = Source.subs.entries;
		if (entries.length == 0) return;
		const selection = Editing.getSelection();
		const selectionSet = new Set(selection);

		const focusedEntry = Editing.getFocusedEntry();
		let focus = focusedEntry instanceof SubtitleEntry ? focusedEntry : entries[0];
		if (selectionOnly) focus = selection.at(0) ?? focus;

		if (focus !== currentEntry || option == SearchOption.Global) {
			currentEntry = null;
			currentTextIndex = 0;
		}

		let expr: RegExp;
		let usingEmptyTerm = false;
		if (searchTerm !== '') {
			try {
				expr = new RegExp(
					useRegex ? searchTerm : Basic.escapeRegexp(searchTerm), 
					`g${caseSensitive ? '' : 'i'}`);
			} catch (e) {
				assert(e instanceof Error);
				Interface.status.set(`search failed: ` + e.message);
				return;
			}
		} else if (useLabel || useStyle) {
			expr = /.*/;
			usingEmptyTerm = true;
		} else {
			Interface.status.set(`search expression is empty`);
			return;
		}

		if (type == SearchAction.Select || !selectionOnly) {
			Editing.clearSelection(ChangeCause.Action);
		}

		let nDone = 0;
		const repl = type == SearchAction.Replace ? replaceTerm : '';
		let i = option == SearchOption.Global ? 0 : Math.max(entries.indexOf(focus), 0);

		outerLoop: while (i < entries.length && i >= 0) 
		{
			let ent = entries[i];
			if (!(selectionOnly && !selectionSet.has(ent)) 
			 && !(useLabel && ent.label != label)
			 && !(usingEmptyTerm && ent === currentEntry))
			{
				for (let j = (ent === currentEntry ? currentTextIndex + 1 : 0); 
					j < ent.texts.length; j++) 
				{
					let channel = ent.texts[j];
					if (useStyle && channel.style.name != style1.name) continue;

					let replaced = channel.text.replace(expr, repl);
					if (replaced != channel.text) {
						console.log(j, currentTextIndex, ent, currentEntry);
						nDone++;
						if (type == SearchAction.Select) {
							Editing.selection.submitted.add(ent);
							break; // selecting one channel suffices
						} else if (type == SearchAction.Replace) {
							channel.text = replaced;
							if (replaceStyle) channel.style = style2;
						} else if (type == SearchAction.ReplaceStyleOnly) {
							channel.style = style2;
						}
						if (option != SearchOption.Global) {
							currentEntry = ent;
							currentTextIndex = j;
							Editing.selectEntry(ent, SelectMode.Single, ChangeCause.Action);
							Editing.focused.style = channel.style;
							break outerLoop;
						}
					}
				}
			}
			if (option == SearchOption.Reverse) i--; else i++;
		}
		let status: string;
		if (nDone > 0) {
			if (type == SearchAction.Select) {
				status = $_('search.selected-n-lines', {values: {n: nDone}});
				// manually call this because we didn't use selectEntry etc.
				Editing.onSelectionChanged.dispatch(ChangeCause.Action);
			} else if (type == SearchAction.Replace || type === SearchAction.ReplaceStyleOnly) {
				status = $_('search.replaced-n-lines', {values: {n: nDone}});
				Source.markChanged(ChangeType.InPlace, ChangeCause.Action);
			} else {
				status = $_('search.found-n-lines', {values: {n: nDone}});
			}
		} else {
			status = $_('search.found-nothing');
			currentEntry = null;
			currentTextIndex = 0;
			if (option != SearchOption.Global) {
				Editing.clearFocus();
				Editing.onSelectionChanged.dispatch(ChangeCause.Action);
			}
		}
		Interface.status.set(status);
	}
</script>

<input class='wfill' bind:value={searchTerm}
	id='expr' placeholder={$_('search.expression')}/>
<input class='wfill' bind:value={replaceTerm}
	id='repl' placeholder={$_('search.replace-term')}/>

<div class='form'>
	<h5>options</h5>
	<label><input type='checkbox' bind:checked={useRegex}/>
		{$_('search.use-regular-expressions')}
	</label><br/>
	<label><input type='checkbox' bind:checked={caseSensitive}/>
		{$_('search.case-sensitive')}
	</label><br/>
	<label><input type='checkbox' bind:checked={replaceStyle}/>
		{$_('search.replace-by-style')}
		<StyleSelect
			on:submit={() => replaceStyle = true}
			bind:currentStyle={style2}/>
	</label><br/>

	<h5>range</h5>
	<label><input type='checkbox' bind:checked={selectionOnly}/>
		{$_('search.search-only-in-selected-entries')}
	</label><br/>
	<label><input type='checkbox' bind:checked={useLabel}/>
		{$_('search.search-only-in-label')}
		<select
			bind:value={label}
			on:input={() => useLabel = true}
		>
			{#each Labels as color}
			<option value={color}>{color}</option>
			{/each}
		</select>
	</label><br/>
	<label><input type='checkbox' bind:checked={useStyle}/>
		{$_('search.search-only-in-style')}
		<StyleSelect
			on:submit={() => useStyle = true}
			bind:currentStyle={style1}/>
	</label>
	<br>
	<table class="wfill">
		<tbody>
			<tr>
				<td>
					<button class="left wfill" disabled>{$_('search.find')}</button>
				</td>
				<td class="hlayout">
					<button class="middle"
						on:click={() => findAndReplace(SearchAction.Find, SearchOption.None)}
					>{$_('search.next')}</button>
					<button class="middle"
						on:click={() => findAndReplace(SearchAction.Find, SearchOption.Reverse)}
					>{$_('search.previous')}</button>
					<button class="right flexgrow"
						on:click={() => findAndReplace(SearchAction.Select, SearchOption.Global)}
					>{$_('search.all')}</button>
				</td>
			</tr>
			<tr>
				<td>
					<button class="left wfill" disabled>replace</button>
				</td>
				<td class="hlayout">
					<button class="middle"
						on:click={() => findAndReplace(SearchAction.Replace, SearchOption.None)}
					>{$_('search.next')}</button>
					<button class="middle"
						on:click={() => findAndReplace(SearchAction.Replace, SearchOption.Reverse)}
					>{$_('search.previous')}</button>
					<button class="middle"
						on:click={() => findAndReplace(SearchAction.Replace, SearchOption.Global)}
					>{$_('search.all')}</button>
					<button class="right flexgrow"
						on:click={() => findAndReplace(SearchAction.ReplaceStyleOnly, SearchOption.Global)}
					>{$_('search.only-styles')}</button>
				</td>
			</tr>
		</tbody>
	</table>
</div>

<style>
	.form > * {
		margin: 2px 0;
	}

	.wfill {
		width: 100%;
	}

	table td {
		padding: 0;
	}

	button[disabled] {
		background-color: var(--uchu-gray-1);
		color: black;
	}
</style>