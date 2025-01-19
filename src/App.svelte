<script lang="ts">
import ImportOptionsDialog from './lib/ImportOptionsDialog.svelte';
import SplitLanguagesDialog from './lib/SplitLanguagesDialog.svelte';
import CombineDialog from "./lib/CombineDialog.svelte";
import Resizer from './lib/ui/Resizer.svelte';
import StyleSelect from './lib/StyleSelect.svelte';
import TimestampInput from './lib/TimestampInput.svelte';

import { SubtitleEntry, SubtitleUtil, type SubtitleChannel } from './lib/Subtitles'
import { assert, Basic } from './lib/Basic';
import { ChangeCause, ChangeType, Frontend, UIFocus } from './lib/Frontend';
import TimeAdjustmentDialog from './lib/TimeTransformDialog.svelte';
import { CanvasKeeper } from './lib/CanvasKeeper';
import { Config } from './lib/Config';

import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { Menu } from '@tauri-apps/api/menu';
import TabView from './lib/ui/TabView.svelte';
import TabPage from './lib/ui/TabPage.svelte';
import SubtitleTable from './lib/SubtitleTable.svelte';

import PropertiesToolbox from './lib/PropertiesToolbox.svelte';
import UntimedToolbox from './lib/UntimedToolbox.svelte';
import SearchToolbox from './lib/SearchToolbox.svelte';
import TestToolbox from './lib/TestToolbox.svelte';

const appWindow = getCurrentWebviewWindow()

let frontend = new Frontend();
let selection = new Set<SubtitleEntry>;

// let subsListFocused = false;
// $: subsListFocused = frontend.states.uiFocus == UIFocus.Table;

let leftPane: HTMLElement;
let rightPane: HTMLElement;
let editTable: HTMLElement;
let videoCanvasContainer: HTMLElement;
let toolboxContainer: HTMLElement;
let videoCanvas: HTMLCanvasElement;
let timelineCanvas: HTMLCanvasElement;

let playIcon = '▶';
let sliderDisabled = true;
let playPos = 0;
let playPosInput = 0;

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
  if (cause != ChangeCause.UIForm)
    editFormUpdateCounter++;
  console.log('changed', ChangeType[type], ChangeCause[cause]);
});

frontend.onSelectionChanged.bind(() => {
  selection = new Set(frontend.getSelection());
  // this refreshes the reactive UI
  frontend.focused.entry = frontend.focused.entry;
  if (frontend.focused.entry !== null)
    setupEditForm();
  // console.log('selection changed');
});

frontend.playback.onRefreshPlaybackControl = () => {
  let playback = frontend.playback;
  sliderDisabled = !playback.isLoaded;
  playIcon = playback.isPlaying ? '⏸' : '▶'
  playPosInput = playback.position ?? 0;
  playPos = playback.isLoaded 
    ? playback.position / playback.duration : 0;
};

function setupEditForm() {
  assert(frontend.focused.entry !== null);
  let focused = frontend.focused.entry;
  editingT0 = focused.start;
  editingT1 = focused.end;
  editingDt = editingT1 - editingT0;

  let isEditingNow = frontend.states.uiFocus == UIFocus.EditingField;
  setTimeout(() => {
    let col = document.getElementsByClassName('contentarea');
    for (const target of col) {
      contentSelfAdjust(target as HTMLTextAreaElement);
    }
    if (isEditingNow) frontend.startEditingFocusedEntry();
  }, 0);
};

function applyEditForm() {
  if (!frontend.focused.entry) return;
  let focused = frontend.focused.entry;
  focused.start = editingT0;
  focused.end = editingT1;
  editingDt = editingT1 - editingT0;
  //frontend.markChanged(true);
}

function contentSelfAdjust(elem: HTMLTextAreaElement) {
  elem.style.height = "calc(2.5lh)";
  elem.style.height = `${elem.scrollHeight + 3}px`;
}

function setupTextEditGUI(node: HTMLTextAreaElement, channel: SubtitleChannel) {
  channel.gui = node;
  node.value = channel.text;
  return {
    update: (newChannel: SubtitleChannel) => {
      // note that svelte calls this every time the channel object changes in any way, but it's only relevant if it's really changing into ANOTHER one
      if (newChannel != channel) {
        channel.gui = undefined;
        newChannel.gui = node;
        node.value = newChannel.text;
        channel = newChannel;
      }
    }
  };
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

appWindow.onCloseRequested(async (ev) => {
  if (!await frontend.warnIfNotSaved()) {
    ev.preventDefault();
    return;
  }
});

appWindow.onDragDropEvent(async (ev) => {
  if (ev.payload.type == 'drop') {
    const path = ev.payload.paths.at(0);
    if (!path) return;
    if (!await frontend.warnIfNotSaved()) return;
    await frontend.openDocument(path);
  }
});

Config.init();
</script>

<svelte:document 
  on:keydown={(ev) => frontend.uiHelper.processGlobalKeydown(ev)}/>
<svelte:window
  on:load={() => {
    let time = performance.now();
    console.log('load time:', time);
    // setTimeout(() => invoke('init_complete', {task: 'frontend'}), 
    //   Math.max(0, 200 - time));
  }}
  on:beforeunload={(ev) => {
    if (frontend.fileChanged) ev.preventDefault();
  }}
  on:focusin={(ev) => {
    frontend.states.uiFocus = UIFocus.Other;
  }}/>

<!-- dialogs -->
<TimeAdjustmentDialog {frontend} bind:this={frontend.modalDialogs.timeTrans}/>
<ImportOptionsDialog  {frontend} bind:this={frontend.modalDialogs.importOpt}/>
<CombineDialog        {frontend} bind:this={frontend.modalDialogs.combine}/>
<SplitLanguagesDialog {frontend} bind:this={frontend.modalDialogs.splitLanguages}/>

<main class="vlayout container fixminheight">
  <!-- toolbar -->
  <div>
    <ul class='menu'>
      <li><button on:click={async () => {
        const paths = Config.get('paths');
        let openMenu = await Menu.new({ items: [
            {
              text: 'other file...',
              async action(_) {
                if (await frontend.warnIfNotSaved())
                  frontend.askOpenFile();
              },
            },
            { item: 'Separator' },
            ...(paths.length == 0 ? [
                {
                  text: 'no recent files',
                  enabled: false
                }
              ] : paths.map((x) => ({
                text: '[...]/' + x.name.split(Basic.pathSeparator)
                  .slice(-2).join(Basic.pathSeparator),
                action: async () => {
                  if (await frontend.warnIfNotSaved())
                    frontend.openDocument(x.name);
                }
              }))
            ),
        ]});
        openMenu.popup();
      }}>open</button></li>
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
      <li><div class='label'>
        {frontend.currentFile ? Basic.getFilename(frontend.currentFile) : '<untitled>'}
        {frontend.fileChanged ? '*' : ''}
      </div></li>
    </ul>
  </div>

  <!-- body -->
  <div class='hlayout flexgrow fixminheight'>
    <div bind:this={leftPane} style="width: 300px;" class="fixminheight">
      <div class='vlayout fill'>
        <!-- video player -->
        <div class='player-container' bind:this={videoCanvasContainer}>
          <canvas width="0" height="0" bind:this={videoCanvas}/>
        </div>
        <!-- video playback controls -->
        <div class='controls-container'>
          <button on:click={() => frontend.playback.toggle()
            .catch((e) => frontend.status = `Error playing video: ${e}`)}
          >{playIcon}</button>
          <input type='range' class='play-pointer flexgrow'
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
            stretchX={false}
            on:change={() => frontend.playback.setPosition(playPosInput)}/>
        </div>
        <!-- resizer -->
        <div>
          <Resizer control={videoCanvasContainer} minValue={100}/>
        </div>
        <!-- toolbox -->
        <div class="flexgrow fixminheight">
          <div class='scrollable fixminheight' bind:this={toolboxContainer}>
            <TabView>
              <TabPage name="Properties">
                <PropertiesToolbox {frontend}/>
              </TabPage>
              <TabPage name="Untimed text" active={true}>
                <UntimedToolbox {frontend}/>
              </TabPage>
              <TabPage name="Search/Replace">
                <SearchToolbox {frontend}/>
              </TabPage>
              <TabPage name="Test">
                <TestToolbox {frontend}/>
              </TabPage>
            </TabView>
          </div>
        </div>
      </div>
    </div>
    <div style="width: 10px;">
      <Resizer vertical={true} minValue={300}
        control={leftPane}/>
    </div>
    <div bind:this={rightPane} class="flexgrow fixminheight">
      <div class='vlayout fill'>
        <!-- edit box -->
        <div bind:this={editTable} class='hlayout' style="height: 100px;">
          <!-- timestamp fields -->
          {#key editFormUpdateCounter}
          <div style="">
            <select
              on:input={(ev) => editMode = ev.currentTarget.selectedIndex}>
              <option>anchor start</option>
              <option>anchor end</option>
            </select>
            <span>
              <input type='checkbox' id='keepd' bind:checked={keepDuration}/>
              <label for='keepd'>keep duration</label>
            </span>
            <br>
            <TimestampInput
              bind:timestamp={editingT0} 
              stretchX={false}
              on:input={() => {
                if (editMode == 0 && keepDuration)
                  editingT1 = editingT0 + editingDt;
                applyEditForm(); 
                frontend.states.editChanged = true;}} 
              on:change={() => 
                frontend.markChanged(ChangeType.Times, ChangeCause.UIForm)}/>
            <br>
            <TimestampInput bind:timestamp={editingT1} 
              stretchX={false}
              on:input={() => {
                if (editMode == 1 && keepDuration)
                  editingT0 = editingT1 - editingDt;
                applyEditForm(); 
                frontend.states.editChanged = true;}} 
              on:change={() => {
                if (editingT1 < editingT0) editingT1 = editingT0;
                applyEditForm();
                frontend.markChanged(ChangeType.Times, ChangeCause.UIForm);}}/>
            <br>
            <TimestampInput bind:timestamp={editingDt} 
              stretchX={false}
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
          <!-- channels view -->
          <div class="flexgrow scroll">
            {#if frontend.focused.entry !== null}
            <table class='fields'>
              {#each frontend.focused.entry.texts as line, i}
              <tr>
                <td>
                  <StyleSelect subtitles={frontend.subs} bind:currentStyle={line.style}
                    on:submit={() => {
                      frontend.markChanged(ChangeType.TextOnly, ChangeCause.UIForm)}} />
                  <button tabindex='-1'
                    on:click={() => frontend.insertChannelAt(i)}>+</button>
                  <button tabindex='-1'
                    on:click={() => frontend.deleteChannelAt(i)}
                    disabled={frontend.focused.entry.texts.length == 1}>-</button>
                </td>
                <td style='width:100%'>
                  <textarea class='contentarea' tabindex=0
                    use:setupTextEditGUI={line}
                    on:keydown={(ev) => {
                      if (ev.key == "Escape") {
                        ev.currentTarget.blur();
                        frontend.states.uiFocus = UIFocus.Table;
                      }
                    }}
                    on:focus={() => {
                      frontend.states.uiFocus = UIFocus.EditingField;
                      frontend.focused.channel = line;
                      frontend.focused.style = line.style;
                    }}
                    on:blur={(x) => {
                      frontend.submitFocusedEntry();
                      frontend.focused.channel = null;
                    }}
                    on:input={(x) => {
                      contentSelfAdjust(x.currentTarget); 
                      frontend.states.editChanged = true;
                    }} />
                </td>
              </tr>
              {/each}
            </table>
            {:else}<i>{frontend.states.virtualEntryHighlighted
              ? 'double-click or press enter to append new entry'
              : 'select a line to start editing'}</i>
            {/if}
          </div>
          {/key}
        </div>
        <!-- resizer -->
        <div>
          <Resizer control={editTable} minValue={100}/>
        </div>
        <!-- table view -->
        <div class='scrollable fixminheight subscontainer' 
          class:subsfocused={frontend.states.uiFocus == UIFocus.Table} 
          bind:this={frontend.ui.subscontainer}
        >
          <SubtitleTable {frontend} bind:selection 
            onFocus={() => frontend.states.uiFocus = UIFocus.Table}/>
        </div>
      </div>
    </div>
  </div>
  <!-- resizer -->
  <div>
    <Resizer control={timelineCanvas} reverse={true}/>
  </div>
  <!-- timeline -->
  <div>
    <canvas class="timeline" bind:this={timelineCanvas} 
      on:click={() => frontend.states.uiFocus = UIFocus.Timeline}
      class:timelinefocused={frontend.states.uiFocus == UIFocus.Timeline}
      style="height: 150px;"></canvas>
  </div>

  <!-- status bar -->
  {#key statusUpdateCounter}
  <div class='status'>{frontend.status}</div>
  {/key}
</main>

<style>
.subscontainer {
  padding: 0 3px;
  margin-bottom: 6px;
  border-radius: 4px;
}

.subsfocused {
  /* border: 2px solid skyblue; */
  box-shadow: 0 5px 10px gray;
}

.timelinefocused {
  /* border: 2px solid skyblue; */
  box-shadow: 0 5px 10px gray;
}

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

.scroll {
  overflow: scroll;
  box-shadow: gray 0px 0px 3px inset;
  margin-left: 3px;
  border-top: solid transparent 3px;
  /* padding: 3px; */
}

.timeline {
  width: 100%;
  height: 100%;
  border-radius: 4px;
  display: block;
  background-color: gray;
  user-select: none; -webkit-user-select: none;
  -moz-user-select: none; -ms-user-select: none;
}

.status {
  text-align: left;
  padding: 5px;
  margin: 5px 0 0 0;
  line-height: normal;
  background-color: lightgray;
  white-space: nowrap;
  overflow-x: auto;
}
</style>