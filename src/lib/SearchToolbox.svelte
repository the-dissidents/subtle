<script lang="ts">
	import { SubtitleEntry, SubtitleStyle } from './Subtitles'
	import DialogBase from './DialogBase.svelte';
	import StyleEdit from './StyleEdit.svelte';
	import { ChangeCause, ChangeType, Frontend } from './Frontend';
	import StyleSelect from './StyleSelect.svelte';
	import { Basic } from './Basic';
	
	export let frontend: Frontend;
	let searchTerm = '';
	let replaceTerm = '';
	let useRegex = false, caseSensitive = true, selectionOnly = false;
	let useStyle = false, replaceStyle = false;
	let style1 = frontend.subs.defaultStyle;
	let style2 = frontend.subs.defaultStyle;

	let currentEntry: SubtitleEntry | null = null;
	let currentTextIndex = 0;

	enum SearchAction {
		Find, Select,
		Replace, ReplaceStyleOnly
	}

	function findAndReplace(type: SearchAction, once: boolean) {
		let entries = frontend.subs.entries;
		if (entries.length == 0) return;
		let selection = frontend.getSelection();
		let selectionSet = new Set(selection);
		let focus = currentEntry ?? entries[0];
		if (selectionOnly) focus = selection.at(0) ?? focus;
		if (focus !== currentEntry) {
			// currentEntry = focus;
			currentTextIndex = 0;
		}
		let expr = new RegExp(
			useRegex ? searchTerm : Basic.escapeRegexp(searchTerm), 
			`g${caseSensitive ? '' : 'i'}`);

		if (type == SearchAction.Select || !selectionOnly) {
			frontend.clearSelection(ChangeCause.Action);
		}

		let nDone = 0;
		let repl = type == SearchAction.Replace ? replaceTerm : '';
		console.log(style1);
		outerLoop: for (
			let i = Math.max(entries.indexOf(focus), 0); i < entries.length; i++) 
		{
			let ent = entries[i];
			if (selectionOnly && !selectionSet.has(ent)) continue;

			for (let j = (ent == currentEntry ? currentTextIndex + 1 : 0); 
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
					} else if (type == SearchAction.Replace) {
						channel.text = replaced;
						if (replaceStyle) channel.style = style2;
					} else if (type == SearchAction.ReplaceStyleOnly) {
						channel.style = style2;
					}
					if (once) {
						currentEntry = ent;
						currentTextIndex = j;

						frontend.selectEntry(ent, false, true, ChangeCause.Action);
						frontend.focused.style = channel.style;
						break outerLoop;
					}
				}
			}
		}
		if (nDone > 0) {
			if (type == SearchAction.Select) {
				frontend.status = `selected ${nDone} line${nDone > 1 ? 's' : ''}`;
				frontend.onSelectionChanged.dispatch(ChangeCause.Action);
			} else if (type == SearchAction.Replace) {
				frontend.status = `replaced ${nDone} lines${nDone > 1 ? 's' : ''}`;
			} else {
				frontend.status = `found ${nDone} line${nDone > 1 ? 's' : ''}; ${currentEntry?.start}, ${currentTextIndex}`;
			}
			frontend.markChanged(ChangeType.TextOnly, ChangeCause.Action);
		} else {
			frontend.status = `found nothing`;
			currentEntry = null;
			currentTextIndex = 0;
			if (once) {
				frontend.focused.entry = null;
				frontend.onSelectionChanged.dispatch(ChangeCause.Action);
			}
		}
	}
</script>

<input class='expr' bind:value={searchTerm} id='expr' placeholder="expression"/>
<input class='expr' bind:value={replaceTerm} id='repl' placeholder="replace term"/>
<div>
	<input type='checkbox' bind:checked={useRegex} id='reg'/>
	<label for='reg'>use regular expressions</label><br/>
	<input type='checkbox' bind:checked={caseSensitive} id='case'/>
	<label for='case'>case sensitive</label><br/>
	<input type='checkbox' bind:checked={selectionOnly} id='sel'/>
	<label for='sel'>selected entries only</label><br/>
	<input type='checkbox' bind:checked={useStyle} id='style1'/>
	<label for='style1'>search in style</label>
	<StyleSelect
		bind:subtitles={frontend.subs}
		bind:currentStyle={style1}/><br/>
	<input type='checkbox' bind:checked={replaceStyle} id='style2'/>
	<label for='style2'>replace by style</label>
	<StyleSelect
		bind:subtitles={frontend.subs}
		bind:currentStyle={style2}/><br/>
	<button on:click={() => findAndReplace(SearchAction.Find, true)}>
		find next</button>
	<button on:click={() => findAndReplace(SearchAction.Select, false)}>
		select all</button>
	<br/>
	<div class="hlayout">
		<button class="left"
			on:click={() => findAndReplace(SearchAction.Replace, true)}
		>replace next</button>
		<button class="middle"
			on:click={() => findAndReplace(SearchAction.Replace, false)}
		>all</button>
		<button class="right"
			on:click={() => findAndReplace(SearchAction.ReplaceStyleOnly, false)}
		>styles only</button>
	</div>
</div>

<style>
	.expr {
		width: 100%;
	}
</style>