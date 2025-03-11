<script lang="ts">
import ImportOptionsDialog from './lib/ImportOptionsDialog.svelte';
import CombineDialog from "./lib/CombineDialog.svelte";
import Resizer from './lib/ui/Resizer.svelte';
import StyleSelect from './lib/StyleSelect.svelte';
import TimestampInput from './lib/TimestampInput.svelte';

import { Labels, SubtitleEntry, type LabelTypes, type SubtitleChannel } from './lib/core/Subtitles.svelte'
import { assert, Basic } from './lib/Basic';
import { ChangeCause, ChangeType, Frontend, UIFocus } from './lib/Frontend';
import TimeAdjustmentDialog from './lib/TimeTransformDialog.svelte';
import { CanvasKeeper } from './lib/CanvasKeeper';
import { Config } from './lib/Config';
import { LabelColor } from './lib/Theming';

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
import { derived } from 'svelte/store';
import { tick } from 'svelte';
import EncodingDialog from './lib/EncodingDialog.svelte';

const appWindow = getCurrentWebviewWindow()
let frontend = $state(new Frontend(appWindow));

let leftPane: HTMLElement | undefined = $state();
let editTable: HTMLElement | undefined = $state();
let videoCanvasContainer: HTMLElement | undefined = $state();
let videoCanvas: HTMLCanvasElement | undefined = $state();
let timelineCanvas: HTMLCanvasElement | undefined = $state();

let playIcon = $state('▶');
let sliderDisabled = $state(true);
let playPos = $state(0);
let playPosInput = $state(0);

let editFormUpdateCounter = $state(0);
let undoRedoUpdateCounter = $state(0);

let editMode = $state(0);
let keepDuration = $state(false);
let editingT0 = $state(0);
let editingT1 = $state(0);
let editingDt = $state(0);
let editingLabel: LabelTypes = $state('none');

let status = frontend.status;
let uiFocus = frontend.uiFocus;
let filenameDisplay = 
  derived([frontend.currentFile, frontend.fileChanged], 
    ([x, y]) => `${x ? Basic.getFilename(x) : '<untitled>'}${y ? '*' : ''}`);

frontend.onUndoBufferChanged.bind(() => {
  undoRedoUpdateCounter++;
});

frontend.onSubtitlesChanged.bind((type: ChangeType, cause: ChangeCause) => {
  // for toolbar
  if (cause != ChangeCause.UIForm)
    editFormUpdateCounter++;
  console.log('changed', ChangeType[type], ChangeCause[cause]);
});

frontend.onSelectionChanged.bind(() => {
  editFormUpdateCounter++;
  let focused = frontend.getFocusedEntry();
  if (focused instanceof SubtitleEntry) {
    editingT0 = focused.start;
    editingT1 = focused.end;
    editingDt = editingT1 - editingT0;
    editingLabel = focused.label;
    let isEditingNow = frontend.getUIFocus() == UIFocus.EditingField;
    tick().then(() => {
      let col = document.getElementsByClassName('contentarea');
      for (const target of col) {
        contentSelfAdjust(target as HTMLTextAreaElement);
      }
      if (isEditingNow) frontend.startEditingFocusedEntry();
    });
  }
});

frontend.playback.onRefreshPlaybackControl = () => {
  let playback = frontend.playback;
  sliderDisabled = !playback.isLoaded;
  playIcon = playback.isPlaying ? '⏸' : '▶'
  playPosInput = playback.position ?? 0;
  playPos = playback.isLoaded 
    ? playback.position / playback.duration : 0;
};

function applyEditForm() {
  let focused = frontend.getFocusedEntry();
  assert(focused instanceof SubtitleEntry);
  focused.start = editingT0;
  focused.end = editingT1;
  editingDt = editingT1 - editingT0;
  focused.label = editingLabel;
}

function contentSelfAdjust(elem: HTMLTextAreaElement) {
  elem.style.height = "auto";
  elem.style.height = `${elem.scrollHeight + 3}px`; // grows to fit content
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

Config.init();
</script>

<svelte:document 
  onkeydown={(ev) => frontend.uiHelper.processGlobalKeydown(ev)}/>
<svelte:window
  onload={() => {
    let time = performance.now();
    console.log('load time:', time);
  }}
  onbeforeunload={(ev) => {
    if (frontend.fileChanged) ev.preventDefault();
  }}
  onfocusin={(ev) => {
    // TODO: this works but looks like nonsense
    if ($uiFocus != UIFocus.EditingField)
      $uiFocus = UIFocus.Other;
  }}/>

<!-- dialogs -->
<TimeAdjustmentDialog {frontend} handler={frontend.modalDialogs.timeTransform}/>
<ImportOptionsDialog  {frontend} handler={frontend.modalDialogs.importOptions}/>
<CombineDialog        {frontend} handler={frontend.modalDialogs.combine}/>
<EncodingDialog       {frontend} handler={frontend.modalDialogs.encoding}/>

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
      <li><div class='label'>{$filenameDisplay}</div></li>
    </ul>
  </div>

  <!-- body -->
  <div class='hlayout flexgrow fixminheight'>
    <div bind:this={leftPane} style="width: 300px;" class="fixminheight vlayout isolated">
      <!-- video player -->
      <div class='player-container' bind:this={videoCanvasContainer} use:setupVideoView>
        <canvas width="0" height="0" bind:this={videoCanvas}></canvas>
      </div>
      <!-- video playback controls -->
      <div class='hlayout'>
        <button 
          style="width: 30px; height: 20px"
          onclick={() => frontend.playback.toggle()
            .catch((e) => $status = `Error playing video: ${e}`)}
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
    <div style="width: 10px;">
      <Resizer vertical={true} minValue={200} control={leftPane}/>
    </div>
    <div class="flexgrow fixminheight vlayout isolated">
      <!-- edit box -->
      <div bind:this={editTable} class='hlayout editbox' style="height: 125px;">
        <!-- timestamp fields -->
        {#key `${editFormUpdateCounter}`}
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
            <div style={`height: auto; width: 25px; border: solid 1px;
              margin: 2px; background-color: ${LabelColor(editingLabel)}`}></div>
            <select
              bind:value={editingLabel}
              class="flexgrow"
              onchange={() => {
                applyEditForm();
                frontend.markChanged(ChangeType.InPlace, ChangeCause.UIForm);}}>
              {#each Labels as color}
                <option value={color}>{color}</option>
              {/each}
            </select>
          </div>
        </div>
        <!-- channels view -->
        <div class="channels flexgrow isolated">
          {#if frontend.getFocusedEntry() instanceof SubtitleEntry}
          {@const focused = frontend.getFocusedEntry() as SubtitleEntry}
          <table class='fields'>
            <tbody>
              {#each focused.texts as line, i}
              <tr>
                <td class="vlayout">
                  <StyleSelect {frontend} bind:currentStyle={line.style}
                    on:submit={() => {
                      frontend.markChanged(ChangeType.InPlace, ChangeCause.UIForm)}} />
                  <div class="hlayout">
                    <button tabindex='-1' class="flexgrow"
                      onclick={() => frontend.insertChannelAt(i)}>+</button>
                    <button tabindex='-1' class="flexgrow"
                      onclick={() => frontend.deleteChannelAt(i)}
                      disabled={focused.texts.length == 1}>-</button>
                  </div>
                </td>
                <td style='width:100%'>
                  <textarea class='contentarea' tabindex=0
                    use:setupTextEditGUI={line}
                    onkeydown={(ev) => {
                      if (ev.key == "Escape") {
                        ev.currentTarget.blur();
                        $uiFocus = UIFocus.Table;
                      }
                    }}
                    onfocus={() => {
                      $uiFocus = UIFocus.EditingField;
                      frontend.focused.channel = line;
                      frontend.focused.style = line.style;
                    }}
                    onblur={(x) => {
                      // TODO: this works but looks like nonsense
                      if ($uiFocus === UIFocus.EditingField)
                        $uiFocus = UIFocus.Other;
                      frontend.submitFocusedEntry();
                      frontend.focused.channel = null;
                    }}
                    oninput={(x) => {
                      $uiFocus = UIFocus.EditingField;
                      contentSelfAdjust(x.currentTarget); 
                      frontend.states.editChanged = true;
                    }}></textarea>
                </td>
              </tr>
              {/each}
            </tbody>
          </table>
          {:else}
          <div class="fill hlayout" style="justify-content: center; align-items: center;">
            <i>{frontend.getFocusedEntry() == 'virtual'
              ? 'double-click or press enter to append new entry'
              : 'select a line to start editing'}</i>
          </div>
          {/if}
        </div>
        {/key}
      </div>
      <!-- resizer -->
      <div>
        <Resizer control={editTable} minValue={125}/>
      </div>
      <!-- table view -->
      <div class='scrollable fixminheight subscontainer flexgrow isolated' 
        class:subsfocused={$uiFocus === UIFocus.Table}>
        <SubtitleTable {frontend} />
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
      onclick={() => $uiFocus = UIFocus.Timeline}
      class:timelinefocused={$uiFocus === UIFocus.Timeline}
      style="height: 150px;"></canvas>
  </div>

  <!-- status bar -->
  <div class='status'>{$status}</div>
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

.editbox {
  padding: 3px 0;
}

.channels {
  overflow: auto;
  box-shadow: gray 0px 0px 3px inset;
  border-radius: 3px;
  padding: 0 3px;
  margin-left: 3px;
}

.contentarea {
  width: 100%;
  resize: none;
  overflow: visible;
  border-radius: 2px;
  border: 1px solid gray;
  padding: 5px;
  box-sizing: border-box;
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