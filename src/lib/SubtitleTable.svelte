<script lang="ts">
import { SvelteMap, SvelteSet } from "svelte/reactivity";
import { ChangeType, getSelectMode, SelectMode, UIFocus, type Frontend } from "./Frontend";
import { SubtitleEntry, SubtitleUtil, type SubtitleChannel } from "./Subtitles";

interface Props {
  frontend: Frontend;
}

let {
  frontend = $bindable()
}: Props = $props();

let entries = $state(frontend.subs.entries);
let entryKeys = new SvelteMap<number, number>;
let selection = $state(new SvelteSet<SubtitleEntry>);
let focus = frontend.focused.entry;
let editingVirtual = frontend.states.isEditingVirtualEntry;

frontend.onSubtitlesChanged.bind((t) => {
  if (t == ChangeType.General || t == ChangeType.Times || t == ChangeType.Order)
    entries = frontend.subs.entries;
});

frontend.onSelectionChanged.bind(() => {
  selection = new SvelteSet(frontend.getSelection());
});

function setupEntryGUI(node: HTMLElement, entry: SubtitleEntry) {
  let update = () => {
    // console.log('update:', entry.texts[0].text);
    frontend.entryRows.set(entry, node);
    if (!entryKeys.has(entry.uniqueID))
      entryKeys.set(entry.uniqueID, 0);
    else
      entryKeys.set(entry.uniqueID, entryKeys.get(entry.uniqueID)! + 1);
  };
  frontend.entryRows.set(entry, node);
  // console.log('create:', entry.texts[0].text);
  $effect(() => {
    entry.update.bind(update);
    return () => {
      // console.log('unbind:', entry.texts[0].text);
      entryKeys.delete(entry.uniqueID);
      entry.update.unbind(update);
    };
  });
}

function overlappingTime(e1: SubtitleEntry | null, e2: SubtitleEntry) {
  return e1 && e2 && e1.start < e2.end && e1.end > e2.start;
}

function getNpS(ent: SubtitleEntry, text: string) {
  let num = SubtitleUtil.getTextLength(text) / (ent.end - ent.start);
  return (isFinite(num) && !isNaN(num)) ? num.toFixed(1) : '--';
}

function onFocus() {
  frontend.uiFocus.set(UIFocus.Table);
}
</script>

<style>
table.subs {
  border-collapse: collapse;
  border-style: hidden;
  line-height: 1;
  padding: 5px;
  width: 100%;
  box-sizing: border-box;
  position: relative;
  cursor: default;
  user-select: none; -webkit-user-select: none;
  -moz-user-select: none; -ms-user-select: none;
  overflow-wrap: break-word;
}

table.subs thead {
  background-color: #f6f6f6;
  width: 100%;
  position: sticky;
  top: 0;
}

table.subs tbody {
  border: none;
  background-color: #f6f6f6;
  width: 100%;
  box-sizing: border-box;
}

table.subs th {
  padding: 5px;
}

table.subs thead th:nth-child(6) {
  width: 100%;
  text-align: left;
  padding-left: 10px;
}

.right {
  text-align: right;
}

table.subs tbody td {
  padding: 5px;
  border: 1px solid gray;
  white-space: pre-wrap;
  text-wrap: nowrap;
  min-height: 1lh;
  user-select: none; -webkit-user-select: none;
  -moz-user-select: none; -ms-user-select: none;
}
table.subs tbody tr {
  background-color: white;
}
tr.selected {
  background-color: rgb(234, 234, 234) ! important;
}
tr.focushlt {
  background-color: lightblue ! important;
}
tr.sametime {
  color: crimson;
}
td.subtext {
  text-align: left;
}
</style>

<table class='subs'>
<thead bind:this={frontend.ui.tableHeader}>
  <tr>
  <th scope="col">#</th>
  <th scope="col">start</th>
  <th scope="col">end</th>
  <th scope="col">style</th>
  <th scope="col">n/s</th>
  <th scope="col">text</th>
  </tr>
</thead>
<tbody>
  <!-- list all entries -->
  {#each entries as ent, i (`${ent.uniqueID}`)}
  {#key entryKeys.get(ent.uniqueID)}
    {#each ent.texts as line, j (`${ent.uniqueID},${j}`)}
    <tr
      onmousedown={(ev) => {
        onFocus();
        if (ev.button == 0)
          frontend.toggleEntry(ent, getSelectMode(ev));
      }}
      oncontextmenu={(ev) => {
        onFocus();
        frontend.uiHelper.contextMenu();
        ev.preventDefault();
      }}
      ondblclick={() => {
        onFocus();
        frontend.startEditingFocusedEntry();
        frontend.playback.setPosition(ent.start);
      }}
      onmousemove={(ev) => {
        if (ev.buttons == 1)
          frontend.selectEntry(ent, SelectMode.Sequence);
      }}
      class:focushlt={$focus === ent}
      class:sametime={$focus instanceof SubtitleEntry 
        && $focus !== ent && overlappingTime($focus, ent)}
      class:selected={selection.has(ent)}
    >
    {#if line === ent.texts[0]}
      <td rowspan={ent.texts.length}
          class={`right label-${ent.label}`}
          use:setupEntryGUI={ent}>{i}</td>
      <td rowspan={ent.texts.length}>{SubtitleUtil.formatTimestamp(ent.start)}</td>
      <td rowspan={ent.texts.length}>{SubtitleUtil.formatTimestamp(ent.end)}</td>
    {/if}
    <td>{line.style.name}</td>
    <td>{getNpS(ent, line.text)}</td>
    <td class='subtext'>{line.text}</td>
    </tr>
    {/each}
  {/key}
  {/each}

  <!-- virtual entry at the end -->
  {#if !$editingVirtual}
  <tr ondblclick={() => {frontend.startEditingNewVirtualEntry();}}
    onmousedown={() => {
      frontend.clearSelection();
      frontend.selectVirtualEntry();
    }}
    class:focushlt={$focus === 'virtual'}>
  <td>﹡</td>
  <td colspan="5"></td>
  </tr>
  {/if}
</tbody>
</table>