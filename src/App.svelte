<script lang="ts">
  import { run } from 'svelte/legacy';

import ImportOptionsDialog from './lib/ImportOptionsDialog.svelte';
import CombineDialog from "./lib/CombineDialog.svelte";
import Resizer from './lib/ui/Resizer.svelte';
import StyleSelect from './lib/StyleSelect.svelte';
import TimestampInput from './lib/TimestampInput.svelte';

import { LabelColors, SubtitleEntry, SubtitleUtil, type LabelColorsType, type SubtitleChannel } from './lib/Subtitles'
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
    import type { Action } from 'svelte/action';

const appWindow = getCurrentWebviewWindow()
let frontend = $state(new Frontend(appWindow));
let selection = $state(new Set<SubtitleEntry>);

// let subsListFocused = false;
// $: subsListFocused = frontend.states.uiFocus == UIFocus.Table;

let leftPane: HTMLElement | undefined = $state();
let rightPane: HTMLElement | undefined = $state();
let editTable: HTMLElement | undefined = $state();
let videoCanvasContainer: HTMLElement | undefined = $state();
let toolboxContainer: HTMLElement | undefined = $state();
let videoCanvas: HTMLCanvasElement | undefined = $state();
let timelineCanvas: HTMLCanvasElement | undefined = $state();

let playIcon = $state('▶');
let sliderDisabled = $state(true);
let playPos = $state(0);
let playPosInput = $state(0);

let editFormUpdateCounter = $state(0);
let undoRedoUpdateCounter = $state(0);
let statusUpdateCounter = $state(0);
let focusedUpdateCounter = $state(0);

let editMode = $state(0);
let keepDuration = $state(false);
let editingT0 = $state(0);
let editingT1 = $state(0);
let editingDt = $state(0);
let editingLabel: LabelColorsType = $state('none');

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
});

frontend.onFocusedEntryChanged.bind(() => {
  // TODO
  focusedUpdateCounter++;
  if (frontend.focused.entry !== null)
    setupEditForm();
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
  editingLabel = focused.label;

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
  focused.label = editingLabel;
  focused.update.dispatch();
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

let setupVideoView: Action = () => {
  assert(videoCanvasContainer !== undefined && videoCanvas !== undefined);
  let keeper = new CanvasKeeper(videoCanvas, videoCanvasContainer);
  keeper.bind(frontend.playback.createVideo(keeper.cxt, frontend.subs));
};

let setupTimelineView: Action = () => {
  assert(timelineCanvas !== undefined);
  let keeper = new CanvasKeeper(timelineCanvas, timelineCanvas);
  keeper.bind(frontend.playback.createTimeline(keeper.cxt, frontend));
};

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

// $: console.log('UIFOCUS', UIFocus[frontend.states.uiFocus]);

Config.init();
</script>

<svelte:document 
  onkeydown={(ev) => frontend.uiHelper.processGlobalKeydown(ev)}/>
<svelte:window
  onload={() => {
    let time = performance.now();
    console.log('load time:', time);
    // setTimeout(() => invoke('init_complete', {task: 'frontend'}), 
    //   Math.max(0, 200 - time));
  }}
  onbeforeunload={(ev) => {
    if (frontend.fileChanged) ev.preventDefault();
  }}
  onfocusin={(ev) => {
    // TODO: this works but looks like nonsense
    if (frontend.states.uiFocus != UIFocus.EditingField)
      frontend.states.uiFocus = UIFocus.Other;
  }}/>

<!-- dialogs -->
<TimeAdjustmentDialog {frontend} bind:this={frontend.modalDialogs.timeTrans}/>
<ImportOptionsDialog  {frontend} bind:this={frontend.modalDialogs.importOpt}/>
<CombineDialog        {frontend} bind:this={frontend.modalDialogs.combine}/>

<main class="vlayout container fixminheight">
  <!-- toolbar -->
  <div>
    <ul class='menu'>
      <li><button onclick={async () => {
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
      <li><button onclick={() => frontend.askSaveFile(true)}>save as</button></li>
      <li><button onclick={() => frontend.askImportFile()}>import</button></li>
      <li><button onclick={() => frontend.askExportFile()}>export</button></li>
      <li class='separator'></li>
      {#key undoRedoUpdateCounter}
      <li><button
        onclick={() => frontend.undo()} 
        disabled={frontend.undoStack.length <= 1}>undo</button></li>
      <li><button
        onclick={() => frontend.redo()}
        disabled={frontend.redoStack.length == 0}>redo</button></li>
      {/key}
      <li class='separator'></li>
      <li><button onclick={() => frontend.askOpenVideo()}>open video</button></li>
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
        <div class='player-container' bind:this={videoCanvasContainer} use:setupVideoView>
          <canvas width="0" height="0" bind:this={videoCanvas}></canvas>
        </div>
        <!-- video playback controls -->
        <div class='hlayout'>
          <button 
            style="width: 30px; height: 20px"
            onclick={() => frontend.playback.toggle()
              .catch((e) => frontend.status = `Error playing video: ${e}`)}
          >{playIcon}</button>
          <input type='range' class='play-pointer flexgrow'
            step="any" max="1" min="0" disabled={sliderDisabled}
            bind:value={playPos}
            oninput={() => {
              if (!frontend.playback.isLoaded) {
                playPos = 0;
                return;
              }
              frontend.playback.setPosition(playPos * frontend.playback.duration);
            }}/>
          <TimestampInput bind:timestamp={playPosInput}
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
            {#snippet children()}
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
            {/snippet}
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
        <div bind:this={editTable} class='hlayout' style="height: 125px;">
          <!-- timestamp fields -->
          {#key `${editFormUpdateCounter},${focusedUpdateCounter}`}
          <div>
            <span>
              <select
                oninput={(ev) => editMode = ev.currentTarget.selectedIndex}>
                <option>anchor start</option>
                <option>anchor end</option>
              </select>
              <input type='checkbox' id='keepd' bind:checked={keepDuration}/>
              <label for='keepd'>keep duration</label>
            </span>
            <br>
            <TimestampInput bind:timestamp={editingT0}
              stretch={true}
              on:input={() => {
                if (editMode == 0 && keepDuration)
                  editingT1 = editingT0 + editingDt;
                applyEditForm(); 
                frontend.states.editChanged = true;}} 
              on:change={() => 
                frontend.markChanged(ChangeType.Times, ChangeCause.UIForm)}/>
            <br>
            <TimestampInput bind:timestamp={editingT1}
              stretch={true}
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
              stretch={true}
              on:input={() => {
                if (editMode == 0)
                  editingT1 = editingT0 + editingDt; 
                else if (editMode == 1)
                  editingT0 = editingT1 - editingDt; 
                applyEditForm();
                frontend.states.editChanged = true;}}
              on:change={() => 
                frontend.markChanged(ChangeType.Times, ChangeCause.UIForm)}/>
            <hr>
            <div class="hlayout">
              <div style="height: auto; width: 25px; border: solid 1px; margin: 2px"
                class={`label-${editingLabel}`}></div>
              <select
                bind:value={editingLabel}
                class="flexgrow"
                onchange={() => {
                  applyEditForm();
                  frontend.markChanged(ChangeType.TextOnly, ChangeCause.UIForm);}}>
                {#each LabelColors as color}
                  <option value={color}>{color}</option>
                {/each}
              </select>
            </div>
          </div>
          <!-- channels view -->
          <div class="flexgrow scroll">
            {#if frontend.focused.entry !== null}
            <table class='fields'>
              <tbody>
                {#each frontend.focused.entry.texts as line, i}
                <tr>
                  <td>
                    <StyleSelect subtitles={frontend.subs} currentStyle={line.style}
                      on:submit={() => {
                        frontend.markChanged(ChangeType.TextOnly, ChangeCause.UIForm)}} />
                    <button tabindex='-1'
                      onclick={() => frontend.insertChannelAt(i)}>+</button>
                    <button tabindex='-1'
                      onclick={() => frontend.deleteChannelAt(i)}
                      disabled={frontend.focused.entry.texts.length == 1}>-</button>
                  </td>
                  <td style='width:100%'>
                    <textarea class='contentarea' tabindex=0
                      use:setupTextEditGUI={line}
                      onkeydown={(ev) => {
                        if (ev.key == "Escape") {
                          ev.currentTarget.blur();
                          frontend.states.uiFocus = UIFocus.Table;
                        }
                      }}
                      onfocus={() => {
                        frontend.states.uiFocus = UIFocus.EditingField;
                        frontend.focused.channel = line;
                        frontend.focused.style = line.style;
                      }}
                      onblur={(x) => {
                        // TODO: this works but looks like nonsense
                        if (frontend.states.uiFocus == UIFocus.EditingField)
                          frontend.states.uiFocus = UIFocus.Other;
                        frontend.submitFocusedEntry();
                        frontend.focused.channel = null;
                      }}
                      oninput={(x) => {
                        frontend.states.uiFocus = UIFocus.EditingField;
                        contentSelfAdjust(x.currentTarget); 
                        frontend.states.editChanged = true;
                      }}></textarea>
                  </td>
                </tr>
                {/each}
              </tbody>
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
          <Resizer control={editTable} minValue={125}/>
        </div>
        <!-- table view -->
        <div class='scrollable fixminheight subscontainer flexgrow' 
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
    <Resizer control={timelineCanvas!} reverse={true}/>
  </div>
  <!-- timeline -->
  <div>
    <canvas class="timeline" bind:this={timelineCanvas}
      use:setupTimelineView
      onclick={() => frontend.states.uiFocus = UIFocus.Timeline}
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

.player-container {
  height: 200px;
  padding: 3px;
}

.player-container canvas {
  width: 100%;
  height: 100%;
  display: block; /* to get rid of extra spacing at the bottom */
  box-sizing: border-box;
  background-color: lightgray;
}

.scroll {
  overflow: auto;
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