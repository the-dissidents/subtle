<script lang="ts">
import { onDestroy } from "svelte";
import { SvelteSet } from "svelte/reactivity";

import { SubtitleEntry, SubtitleUtil } from "./core/Subtitles.svelte";
import { LabelColor } from "./Theming";
import { assert, Basic } from "./Basic";

import { ChangeType, Source } from "./frontend/Source";
import { Editing, getSelectMode, SelectMode } from "./frontend/Editing";
import { Interface, UIFocus } from "./frontend/Interface";
import { Playback } from "./frontend/Playback";
import { Actions } from "./frontend/Actions";
import { EventHost } from "./frontend/Frontend";

let entries = $state(Source.subs.entries);
let selection = $state(new SvelteSet<SubtitleEntry>);

let entryRows = new WeakMap<SubtitleEntry, HTMLElement>;

let focus = Editing.focused.entry;
let editingVirtual = Editing.isEditingVirtualEntry;

let scale = $state(1);
let headerOffset = $state('0');
let outer = $state<HTMLDivElement>();
let table = $state<HTMLTableElement>();
let tableHeader = $state<HTMLElement>();

let centerX: number | undefined;
let centerY: number | undefined;

const me = {};
onDestroy(() => EventHost.unbind(me));

Source.onSubtitleObjectReload.bind(me, () => {
  entries = Source.subs.entries;
});

Source.onSubtitlesChanged.bind(me, (t) => {
  if (t == ChangeType.General || t == ChangeType.Times || t == ChangeType.Order)
    entries = Source.subs.entries;
});

Editing.onSelectionChanged.bind(me, () => {
  selection = new SvelteSet(Editing.getSelection());
});

Editing.onKeepEntryInView.bind(me, (ent) => {
  assert(outer !== undefined);
  assert(tableHeader !== undefined);

  if (ent instanceof SubtitleEntry) {
    const row = entryRows.get(ent);
    if (!row) {
        console.warn('?!row', ent);
        return;
    }
    const rowRect = row.getBoundingClientRect();
    const outerRect = outer.getBoundingClientRect();
    const headerHeight = tableHeader.getBoundingClientRect().height;
    const rowToTop = rowRect.top - outerRect.top;

    if (rowToTop < headerHeight)
      outer.scrollTop = outer.scrollTop + rowToTop - headerHeight;
    else if (rowToTop > outerRect.height - rowRect.height)
      outer.scrollTop = outer.scrollTop + rowToTop - (outerRect.height - rowRect.height);
  } else {
    if (Source.subs.entries.length == 0) return;
    outer.scroll({top: outer.scrollHeight});
  }
});

function setupEntryGUI(node: HTMLElement, entry: SubtitleEntry) {
  entryRows.set(entry, node);
}

function overlappingTime(e1: SubtitleEntry | null, e2: SubtitleEntry) {
  return e1 && e2 && e1.start < e2.end && e1.end > e2.start;
}

function getNpS(ent: SubtitleEntry, text: string) {
  let num = SubtitleUtil.getTextLength(text) / (ent.end - ent.start);
  return (isFinite(num) && !isNaN(num)) ? num.toFixed(1) : '--';
}

function onFocus() {
  Interface.uiFocus.set(UIFocus.Table);
}

function setHeaderOffset() {
  headerOffset = (outer!.scrollTop * (1 / scale - 1)) + 'px';
}

function processWheel(ev: WheelEvent) {
  const tr = Basic.translateWheelEvent(ev);
  let box = outer!.getBoundingClientRect();
  let offsetX = ev.clientX - box.left;
  let offsetY = ev.clientY - box.top;
  if (tr.isZoom) {
    // ev.preventDefault();
    if (ev.movementX || ev.movementY || !centerX || !centerY) {
      centerX = (offsetX + outer!.scrollLeft) / scale;
      centerY = (offsetY + outer!.scrollTop) / scale;
    }
    scale = Math.min(2, Math.max(1, scale / Math.pow(1.01, tr.amount)));
    outer!.scrollTo({
      left: centerX * scale - offsetX,
      top: centerY * scale - offsetY,
      behavior: 'instant'
    });
    table!.style.border = 'none';
    setHeaderOffset();
  }
}
</script>

<style>
table {
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
  /* overflow-wrap: break-word; */

  transform-origin: 0 0;
}

table thead {
  background-color: #f6f6f6;
  width: 100%;
  /* z-index: 5; */
  position: sticky;
  top: 0;
}

table tbody {
  border: none;
  background-color: #f6f6f6;
  width: 100%;
  box-sizing: border-box;
}

table th {
  padding: 5px;
}

table thead th:nth-child(6) {
  width: 100%;
  text-align: left;
  padding-left: 10px;
}

.right {
  text-align: right;
}

table tbody td {
  padding: 5px;
  border: 1px solid gray;
  white-space: pre-wrap;
  text-wrap: nowrap;
  min-height: 1lh;
  user-select: none; -webkit-user-select: none;
  -moz-user-select: none; -ms-user-select: none;
}
table tbody tr {
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

.outer {
  width: 100%;
  height: 100%;
  overflow: auto;
  position: relative;
}
</style>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="outer" bind:this={outer} 
  onwheel={(ev) => processWheel(ev)}
  onmousemove={() => centerX = undefined}
  onscroll={() => setHeaderOffset()}
>

<table class='subs' style="transform: scale({scale})" bind:this={table}>
<thead bind:this={tableHeader} style="top: {headerOffset}">
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
  {#each ent.texts as line, j (`${ent.uniqueID},${j}`)}
  <!-- svelte-ignore a11y_mouse_events_have_key_events -->
  <tr
    onmousedown={(ev) => {
      onFocus();
      if (ev.button == 0)
        Editing.toggleEntry(ent, getSelectMode(ev));
    }}
    oncontextmenu={(ev) => {
      onFocus();
      ev.preventDefault();
      Actions.contextMenu();
    }}
    ondblclick={() => {
      onFocus();
      Editing.startEditingFocusedEntry();
      Playback.setPosition(ent.start);
    }}
    onmouseover={(ev) => {
      if (ev.buttons == 1)
        Editing.selectEntry(ent, SelectMode.Sequence);
    }}
    class:focushlt={$focus === ent}
    class:sametime={$focus instanceof SubtitleEntry 
      && $focus !== ent && overlappingTime($focus, ent)}
    class:selected={selection.has(ent)}
  >
  {#if line === ent.texts[0]}
    <td rowspan={ent.texts.length}
        class="right"
        style={`background-color: ${LabelColor(ent.label)}`}
        use:setupEntryGUI={ent}>{i}</td>
    <td rowspan={ent.texts.length}>{SubtitleUtil.formatTimestamp(ent.start)}</td>
    <td rowspan={ent.texts.length}>{SubtitleUtil.formatTimestamp(ent.end)}</td>
  {/if}
  <td>{line.style.name}</td>
  <td>{getNpS(ent, line.text)}</td>
  <td class='subtext'>{line.text}</td>
  </tr>
  {/each}
  {/each}

  <!-- virtual entry at the end -->
  {#if !$editingVirtual}
  <tr ondblclick={() => Editing.startEditingNewVirtualEntry()}
    onmousedown={() => {
      Editing.clearSelection();
      Editing.selectVirtualEntry();
    }}
    class:focushlt={$focus === 'virtual'}>
  <td>﹡</td>
  <td colspan="5"></td>
  </tr>
  {/if}
</tbody>
</table>

</div>