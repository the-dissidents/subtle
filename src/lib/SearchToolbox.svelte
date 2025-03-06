<script lang="ts">
	import { Labels, SubtitleEntry, type LabelTypes } from './Subtitles.svelte'
	import { ChangeCause, ChangeType, Frontend, SelectMode } from './Frontend';
	import StyleSelect from './StyleSelect.svelte';
	import { assert, Basic } from './Basic';
	
	export let frontend: Frontend;
	let searchTerm = '';
	let replaceTerm = '';
	let useRegex = false, caseSensitive = true, selectionOnly = false;
	let useStyle = false, replaceStyle = false;
	let style1 = frontend.subs.defaultStyle;
	let style2 = frontend.subs.defaultStyle;

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
		const entries = frontend.subs.entries;
		if (entries.length == 0) return;
		const selection = frontend.getSelection();
		const selectionSet = new Set(selection);

		const focusedEntry = frontend.getFocusedEntry();
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
				frontend.status.set(`search failed: ${e.message}`);
				return;
			}
		} else if (useLabel || useStyle) {
			expr = /.*/;
			usingEmptyTerm = true;
		} else {
			frontend.status.set(`search expression is empty`);
			return;
		}

		if (type == SearchAction.Select || !selectionOnly) {
			frontend.clearSelection(ChangeCause.Action);
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
							frontend.selection.submitted.add(ent);
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
							frontend.selectEntry(ent, SelectMode.Single, ChangeCause.Action);
							frontend.focused.style = channel.style;
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
				status = `selected ${nDone} line${nDone > 1 ? 's' : ''}`;
				// manually call this because we didn't use selectEntry etc.
				frontend.onSelectionChanged.dispatch(ChangeCause.Action);
			} else if (type == SearchAction.Replace || type === SearchAction.ReplaceStyleOnly) {
				status = `replaced ${nDone} lines${nDone > 1 ? 's' : ''}`;
				frontend.markChanged(ChangeType.InPlace, ChangeCause.Action);
			} else {
				status = `found ${nDone} line${nDone > 1 ? 's' : ''}`;
			}
		} else {
			status = `found nothing`;
			currentEntry = null;
			currentTextIndex = 0;
			if (option != SearchOption.Global) {
				frontend.clearFocus();
				frontend.onSelectionChanged.dispatch(ChangeCause.Action);
			}
		}
		frontend.status.set(status);
	}
</script>

<input class='wfill' bind:value={searchTerm} id='expr' placeholder="expression"/>
<input class='wfill' bind:value={replaceTerm} id='repl' placeholder="replace term"/>

<div class='form'>
	<h5>options</h5>
	<label><input type='checkbox' bind:checked={useRegex}/>
		use regular expressions
	</label><br/>
	<label><input type='checkbox' bind:checked={caseSensitive}/>
		case sensitive
	</label><br/>
	<label><input type='checkbox' bind:checked={replaceStyle}/>
		replace by style
		<StyleSelect {frontend}
			on:submit={() => replaceStyle = true}
			bind:currentStyle={style2}/>
	</label><br/>

	<h5>range</h5>
	<label><input type='checkbox' bind:checked={selectionOnly}/>
		search only in selected entries
	</label><br/>
	<label><input type='checkbox' bind:checked={useLabel}/>
		search only in label
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
		search only in style
		<StyleSelect {frontend}
			on:submit={() => useStyle = true}
			bind:currentStyle={style1}/>
	</label>
	<br>
	<table class="wfill">
		<tbody>
			<tr>
				<td>
					<button class="left wfill" disabled>find</button>
				</td>
				<td class="hlayout">
					<button class="middle"
						on:click={() => findAndReplace(SearchAction.Find, SearchOption.None)}
					>next</button>
					<button class="middle"
						on:click={() => findAndReplace(SearchAction.Find, SearchOption.Reverse)}
					>previous</button>
					<button class="right flexgrow"
						on:click={() => findAndReplace(SearchAction.Select, SearchOption.Global)}
					>all</button>
				</td>
			</tr>
			<tr>
				<td>
					<button class="left wfill" disabled>replace</button>
				</td>
				<td class="hlayout">
					<button class="middle"
						on:click={() => findAndReplace(SearchAction.Replace, SearchOption.None)}
					>next</button>
					<button class="middle"
						on:click={() => findAndReplace(SearchAction.Replace, SearchOption.Reverse)}
					>previous</button>
					<button class="middle"
						on:click={() => findAndReplace(SearchAction.Replace, SearchOption.Global)}
					>all</button>
					<button class="right flexgrow"
						on:click={() => findAndReplace(SearchAction.ReplaceStyleOnly, SearchOption.Global)}
					>only styles</button>
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