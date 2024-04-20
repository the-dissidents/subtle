<script lang="ts">
import ImportOptionsDialog from './lib/ImportOptionsDialog.svelte';
import StyleManagerDialog from './lib/PropertiesDialog.svelte';
import Resizer from './lib/Resizer.svelte';
import StyleSelect from './lib/StyleSelect.svelte';
import TimestampInput from './lib/TimestampInput.svelte';

import { SubtitleEntry, SubtitleUtil, type SubtitleChannel } from './lib/Subtitles'
import { Basic, assert } from './lib/Basic';
import { ChangeCause, ChangeType, Frontend } from './lib/frontend';
import TimeAdjustmentDialog from './lib/TimeTransformDialog.svelte';
import SearchDialog from './lib/SearchDialog.svelte';
import { UIHelper } from './lib/UICommands';
import { CanvasKeeper } from './lib/CanvasKeeper';

let frontend = new Frontend();
let styleDialog: StyleManagerDialog;
let selection = new Set<SubtitleEntry>;

let videoCanvasContainer: HTMLElement;
let videoCanvas: HTMLCanvasElement;
let timelineCanvas: HTMLCanvasElement;

let playIcon = '▶';
let sliderDisabled = true;
let playPos = 0;
let playPosInput = 0;

let subListUpdateCounter = 0;
let editFormUpdateCounter = 0;
let undoRedoUpdateCounter = 0;
let statusUpdateCounter = 0;

let editMode = 0;
let keepDuration = false;
let editingT0 = 0;
let editingT1 = 0;
let editingDt = 0;

frontend.onUndoBufferChanged.bind(() => {
  undoRedoUpdateCounter++;
});
frontend.onStatusChanged.bind(() => {
  statusUpdateCounter++;
});
frontend.onSubtitlesChanged.bind((type: ChangeType, cause: ChangeCause) => {
  // for toolbar
  frontend.fileChanged = frontend.fileChanged;
  //subListUpdateCounter++;
  if (cause != ChangeCause.UIForm)
    editFormUpdateCounter++;
  console.log('changed', ChangeType[type], ChangeCause[cause]);
});
frontend.onSelectionChanged.bind(() => {
  //subListUpdateCounter++;
  //editFormUpdateCounter++;
  selection = new Set(frontend.getSelection());
  frontend.current.entry = frontend.current.entry;
  setupEditForm();
  // console.log('selection changed');
});

frontend.playback.onRefreshPlaybackControl = () => {
  let playback = frontend.playback;
  sliderDisabled = !playback.isLoaded ?? false;
  playIcon = playback.isPlaying ? '⏸' : '▶'
  playPosInput = playback.position ?? 0;
  playPos = playback.isLoaded 
    ? playback.position / playback.duration : 0;
};

function setupEditForm() {
  if (!frontend.current.entry) return;
  let focused = frontend.current.entry;
  editingT0 = focused.start;
  editingT1 = focused.end;
  editingDt = editingT1 - editingT0;

  let isEditingNow = frontend.states.isEditing;
  setTimeout(() => {
    let col = document.getElementsByClassName('contentarea');
    for (let i = 0; i < col.length; i++) {
      let target = col.item(i) as HTMLTextAreaElement;
      contentSelfAdjust(target);
    }
    if (isEditingNow) frontend.focusOnCurrentEntry();
  }, 0);
};

function applyEditForm() {
  if (!frontend.current.entry) return;
  let focused = frontend.current.entry;
  focused.start = editingT0;
  focused.end = editingT1;
  editingDt = editingT1 - editingT0;
  //frontend.markChanged(true);
}

function contentSelfAdjust(elem: HTMLTextAreaElement) {
  elem.style.height = "calc(2.5lh)";
  elem.style.height = `${elem.scrollHeight + 3}px`;
}

function setupEntryGUI(node: HTMLElement, entry: SubtitleEntry) {
  entry.gui = node;
  return {
    update: (entry: SubtitleEntry) => entry.gui = node,
    destory: () => entry.gui = undefined};
}

function setupTextEditGUI(node: HTMLElement, channel: SubtitleChannel) {
  channel.gui = node;
  return {
    update: (channel: SubtitleChannel) => {
      channel.gui = node;
      if (frontend.states.editChanged)
        frontend.markChanged(ChangeType.NonTime, ChangeCause.UIForm);
    },
    destory: () => channel.gui = undefined};
}

function overlappingTime(e1: SubtitleEntry | null, e2: SubtitleEntry) {
  return e1 && e2 && e1.start < e2.end && e1.end > e2.start;
}

let setupVideoView = () => {
  if (videoCanvasContainer === undefined || videoCanvas === undefined) return;
  setupVideoView = () => {};
  let keeper = new CanvasKeeper(videoCanvas, videoCanvasContainer);
  keeper.bind(frontend.playback.createVideo(keeper.cxt, frontend.subs));
}

let setupTimelineView = () => {
  if (timelineCanvas === undefined) return;
  setupTimelineView = () => {};
  let keeper = new CanvasKeeper(timelineCanvas, timelineCanvas);
  keeper.bind(frontend.playback.createTimeline(keeper.cxt, frontend));
}

$: videoCanvas, setupVideoView();
$: timelineCanvas, setupTimelineView();
</script>

<svelte:document 
  on:keydown={(ev) => frontend.uiHelper.processGlobalKeydown(ev)}/>
<svelte:window
  on:beforeunload={(ev) => {
    if (frontend.fileChanged) ev.preventDefault();
  }}/>

<!-- dialogs -->
<TimeAdjustmentDialog {frontend} bind:this={frontend.modalDialogs.timeTrans}/>
<StyleManagerDialog   {frontend} bind:this={styleDialog}/>
<ImportOptionsDialog  {frontend} bind:this={frontend.modalDialogs.importOpt}/>
<SearchDialog         {frontend} bind:this={frontend.dialogs.search}/>

<main class="container">
  <!-- toolbar -->
  <ul class='menu'>
    <li><button on:click={() => frontend.askOpenFile()}>open</button></li>
    <li><button on:click={() => frontend.askSaveFile(true)}>save as</button></li>
    <li><button on:click={() => frontend.askImportFile()}>import</button></li>
    <li><button on:click={() => frontend.askExportFile()}>export</button></li>
    <li class='separator'></li>
    {#key undoRedoUpdateCounter}
    <li><button
      on:click={() => frontend.undo()}
      disabled={frontend.undoStack.length <= 1}>undo</button></li>
    <li><button
      on:click={() => frontend.redo()}
      disabled={frontend.redoStack.length == 0}>redo</button></li>
    {/key}
    <li class='separator'></li>
    <li><button on:click={() => frontend.askOpenVideo()}>open video</button></li>
    <li><button 
      on:click={() => styleDialog.$set({show: true})}>manage styles</button></li>
    <li><div class='label'>
      {frontend.currentFile ? Basic.getFilename(frontend.currentFile) : '<untitled>'}
      {frontend.fileChanged ? '*' : ''}
    </div></li>
  </ul>

  <!-- edit form -->
  <table class='edit' bind:this={frontend.ui.editTable}>
    <tr>
      <!-- video player -->
      <td class='player-container' bind:this={videoCanvasContainer}>
        <canvas width="0" height="0" bind:this={videoCanvas}/>
      </td>
      <td style="width: 2px;">
        <Resizer vertical={true} minValue={100}
          control={videoCanvasContainer}/>
      </td>
      <!-- timestamp fields -->
      {#key editFormUpdateCounter}
      <td class='times'>
        <div>
          <select class="anchor-select"
            on:input={(ev) => editMode = ev.currentTarget.selectedIndex}>
            <option>anchor start</option>
            <option>anchor end</option>
          </select>
          <span>
            <input type='checkbox' id='keepd' bind:checked={keepDuration}/>
            <label for='keepd'>keep duration</label>
          </span>
          <div><TimestampInput
            bind:timestamp={editingT0} 
            stretchX={true}
            on:input={() => {
              if (editMode == 0 && keepDuration)
                editingT1 = editingT0 + editingDt;
              applyEditForm(); 
              frontend.states.editChanged = true;}} 
            on:change={() => 
              frontend.markChanged(ChangeType.Times, ChangeCause.UIForm)}/>
          </div>
          <div><TimestampInput bind:timestamp={editingT1} 
            stretchX={true}
            on:input={() => {
              if (editMode == 1 && keepDuration)
                editingT0 = editingT1 - editingDt;
              applyEditForm(); 
              frontend.states.editChanged = true;}} 
            on:change={() => {
              if (editingT1 < editingT0) editingT1 = editingT0;
              applyEditForm();
              frontend.markChanged(ChangeType.Times, ChangeCause.UIForm);}}/>
          </div>
          <div><TimestampInput bind:timestamp={editingDt} 
            stretchX={true}
            on:input={() => {
              if (editMode == 0)
                editingT1 = editingT0 + editingDt; 
              else if (editMode == 1)
                editingT0 = editingT1 - editingDt; 
              applyEditForm();
              frontend.states.editChanged = true;}}
            on:change={() => 
              frontend.markChanged(ChangeType.Times, ChangeCause.UIForm)}/>
          </div>  
        </div>
      </td>
      <!-- channels view -->
      <td class='scroll'>
        {#if frontend.current.entry !== null}
        <table class='fields'>
          {#each frontend.current.entry.texts as line, i}
          <tr>
            <td>
              <StyleSelect subtitles={frontend.subs} bind:currentStyle={line.style}
                on:submit={() => {
                  frontend.markChanged(ChangeType.NonTime, ChangeCause.UIForm)}} />
              <button tabindex='-1'
                on:click={() => frontend.insertChannelAt(i)}>+</button>
              <button tabindex='-1'
                on:click={() => frontend.deleteChannelAt(i)}
                disabled={frontend.current.entry.texts.length == 1}>-</button>
            </td>
            <td style='width:100%'>
              <textarea class='contentarea' tabindex=0
                bind:value={line.text}
                use:setupTextEditGUI={line}
                on:focus={() => {
                  frontend.states.isEditing = true;
                  frontend.current.style = line.style;
                  frontend.status = 'set focusedStyle to ' + line.style.name;
                }}
                on:blur={() => frontend.states.isEditing = false}
                on:input={(x) => {
                  contentSelfAdjust(x.currentTarget); 
                  frontend.states.editChanged = true;
                }}
                on:change={() => {
                }} />
            </td>
          </tr>
          {/each}
        </table>
        {:else}<i>{frontend.states.virtualEntryHighlighted
          ? 'double-click or press enter to append new entry'
          : 'select a line to start editing'}</i>{/if}
      </td>
      {/key}
    </tr>
    <!-- resizer -->
    <tfoot><td colspan=4>
      <Resizer control={frontend.ui.editTable}
        control2={videoCanvasContainer} minValue={100}/>
    </td></tfoot>
  </table>

  <!-- video playback controls -->
  <div class='controls-container'>
    <button on:click={() => frontend.playback.toggle()
      .catch(() => frontend.status = "can't play now!")}
    >{playIcon}</button>
    <input type='range' class='play-pointer' style="width: 100%;" 
      step="any" max="1" min="0" disabled={sliderDisabled}
      bind:value={playPos}
      on:input={() => {
        if (!frontend.playback.isLoaded) {
          playPos = 0;
          return;
        }
        frontend.playback.setPosition(playPos * frontend.playback.duration);
      }}/>
    <TimestampInput bind:timestamp={playPosInput}
      on:change={() => frontend.playback.setPosition(playPosInput)}/>
  </div>

  <!-- table view -->
  <div class='subscontainer' bind:this={frontend.ui.subscontainer}>
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
      {#key subListUpdateCounter}
      {#each frontend.subs.entries as ent, i (ent.uniqueID)}
      {#each ent.texts as line, j (`${i},${j}`)}
      <tr on:mousedown={(ev) => {
            if (ev.button == 0)frontend.toggleEntry(ent, 
              ev.shiftKey, ev.getModifierState(Basic.ctrlKey()));
          }}
          on:contextmenu={(ev) => {
            frontend.uiHelper.contextMenu();
            ev.preventDefault();
          }}
          on:dblclick={() => {
            frontend.focusOnCurrentEntry();
            frontend.playback.setPosition(ent.start);
          }}
          on:mousemove={(ev) => {
            if (ev.buttons == 1)
              frontend.selectEntry(ent, true, ev.getModifierState(Basic.ctrlKey()));
          }}
          class:focushlt={frontend.current.entry == ent}
          class:sametime={frontend.current.entry != ent 
            && overlappingTime(frontend.current.entry, ent)}
          class:selected={selection.has(ent)}
        >
        {#if line === ent.texts[0]}
          <td rowspan={ent.texts.length} use:setupEntryGUI={ent}>{i}</td>
          <td rowspan={ent.texts.length}>{SubtitleUtil.formatTimestamp(ent.start)}</td>
          <td rowspan={ent.texts.length}>{SubtitleUtil.formatTimestamp(ent.end)}</td>
        {/if}
        <td>{line.style.name}</td>
        <td>{(() => {
          let num = SubtitleUtil.getTextLength(line.text) / (ent.end - ent.start);
          return (isFinite(num) && !isNaN(num)) ? num.toFixed(1) : '--';
        })()}</td>
        <td class='subtext'>{line.text}</td>
      </tr>
      {/each}
      {/each}

      <!-- virtual entry at the end -->
      {#if !frontend.states.isEditingVirtualEntry}
      <tr on:dblclick={() => {frontend.startEditingNewVirtualEntry();}}
          on:mousedown={() => {
            frontend.states.virtualEntryHighlighted = true;
            frontend.clearSelection();
          }}
          class={frontend.states.virtualEntryHighlighted ? 'focushlt' : ''}>
        <td>﹡</td>
        <td colspan="5"/>
      </tr>
      {/if}
      {/key}
    </tbody>
  </table>
  </div>

  <!-- timeline -->
  <table>
    <tr><Resizer control={timelineCanvas} reverse={true}/></tr>
    <tr><canvas class="timeline" bind:this={timelineCanvas}></canvas></tr>
  </table>

  <!-- status bar -->
  {#key statusUpdateCounter}
  <p class='status'>{frontend.status}</p>
  {/key}
</main>

<style>
.controls-container {
  width: 100%;
  display: flex;
  flex-direction: row;
  padding: 5px;
}
.controls-container button {
  width: 30px;
}

.player-container {
  width: 300px;
  height: 200px;
  padding: 3px;
  overflow: scroll;
}

.player-container canvas {
  width: 100%;
  height: 100%;
  display: block; /* to get rid of extra spacing at the bottom */
  box-sizing: border-box;
  background-color: lightgray;
}

.times {
  width: 200px;
  max-width: 200px;
}

.times div {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
}

.times div div {
  width: 100%;
  height: 100%;
  padding-top: 5px;
}

.scroll {
  overflow: scroll;
  box-shadow: gray 0px 0px 3px inset;
  margin: 3px;
  padding: 3px;
}

.timeline {
  width: 100%;
  height: 100%;
  display: block;
  background-color: gray;
  user-select: none; -webkit-user-select: none;
  -moz-user-select: none; -ms-user-select: none;
}
</style>