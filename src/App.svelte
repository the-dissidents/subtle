<script lang="ts">
import { InterfaceConfig, MainConfig } from "./lib/config/Groups";
import { PrivateConfig } from './lib/config/PrivateConfig';

import ImportOptionsDialog from './lib/dialog/ImportOptionsDialog.svelte';
import CombineDialog from "./lib/dialog/CombineDialog.svelte";
import TimeAdjustmentDialog from './lib/dialog/TimeTransformDialog.svelte';
import EncodingDialog from './lib/dialog/EncodingDialog.svelte';
import ExportDialog from './lib/dialog/ExportDialog.svelte';
import ConfigDialog from './lib/dialog/ConfigDialog.svelte';

import TabView from './lib/ui/TabView.svelte';
import TabPage from './lib/ui/TabPage.svelte';
import Resizer from './lib/ui/Resizer.svelte';
import StyleSelect from './lib/StyleSelect.svelte';
import TimestampInput from './lib/TimestampInput.svelte';
import SubtitleTable from './lib/SubtitleTable.svelte';

import PropertiesToolbox from './lib/toolbox/PropertiesToolbox.svelte';
import UntimedToolbox from './lib/toolbox/UntimedToolbox.svelte';
import SearchToolbox from './lib/toolbox/SearchToolbox.svelte';
import TestToolbox from './lib/toolbox/TestToolbox.svelte';

import { assert, Basic } from './lib/Basic';
import { Labels, SubtitleEntry, type LabelTypes, type SubtitleChannel } from './lib/core/Subtitles.svelte'
import { CanvasKeeper } from './lib/CanvasKeeper';
import { LabelColor } from './lib/Theming';

import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { Menu } from '@tauri-apps/api/menu';
import { LogicalPosition, LogicalSize } from '@tauri-apps/api/window';
import type { Action } from 'svelte/action';
import { derived, get } from 'svelte/store';
import { tick } from 'svelte';

import { ChangeCause, ChangeType, Source } from './lib/frontend/Source';
import { Editing } from './lib/frontend/Editing';
import { Interface, UIFocus } from './lib/frontend/Interface';
import { Playback } from './lib/frontend/Playback';
import { Dialogs } from './lib/frontend/Dialogs';
import { Actions } from './lib/frontend/Actions';
import { getVersion } from '@tauri-apps/api/app';
import { arch, platform, version } from '@tauri-apps/plugin-os';

const appWindow = getCurrentWebviewWindow()

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

let status = Interface.status;
let uiFocus = Interface.uiFocus;
let filenameDisplay = 
  derived([Source.currentFile, Source.fileChanged], 
    ([x, y]) => `${x ? Basic.getFilename(x) : '<untitled>'}${y ? '*' : ''}`);

const me = {};

Source.onUndoBufferChanged.bind(me, () => {
  undoRedoUpdateCounter++;
});

Source.onSubtitlesChanged.bind(me, (type: ChangeType, cause: ChangeCause) => {
  // for toolbar
  if (cause != ChangeCause.UIForm)
    editFormUpdateCounter++;
  console.log('changed', ChangeType[type], ChangeCause[cause]);
});

Editing.onSelectionChanged.bind(me, () => {
  editFormUpdateCounter++;
  let focused = Editing.getFocusedEntry();
  if (focused instanceof SubtitleEntry) {
    editingT0 = focused.start;
    editingT1 = focused.end;
    editingDt = editingT1 - editingT0;
    editingLabel = focused.label;
    let isEditingNow = Interface.getUIFocus() == UIFocus.EditingField;
    tick().then(() => {
      let col = document.getElementsByClassName('contentarea');
      for (const target of col) {
        contentSelfAdjust(target as HTMLTextAreaElement);
      }
      if (isEditingNow) Editing.startEditingFocusedEntry();
    });
  }
});

Playback.onRefreshPlaybackControl = () => {
  sliderDisabled = !Playback.isLoaded;
  playIcon = Playback.isPlaying ? '⏸' : '▶'
  playPosInput = Playback.position ?? 0;
  playPos = Playback.isLoaded 
    ? Playback.position / Playback.duration : 0;
};

function applyEditForm() {
  let focused = Editing.getFocusedEntry();
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
  keeper.bind(Playback.createVideo(keeper.cxt));
};

let setupTimelineView: Action = () => {
  assert(timelineCanvas !== undefined);
  let keeper = new CanvasKeeper(timelineCanvas, timelineCanvas);
  keeper.bind(Playback.createTimeline(keeper.cxt));
};

PrivateConfig.init();
PrivateConfig.onInitialized(() => {
  appWindow.setPosition(new LogicalPosition(
    PrivateConfig.get('windowX'), 
    PrivateConfig.get('windowY')));
  appWindow.setSize(new LogicalSize(
    PrivateConfig.get('windowW'), 
    PrivateConfig.get('windowH')));
  videoCanvasContainer!.style.height = `${PrivateConfig.get('videoH')}px`;
  timelineCanvas!.style.height = `${PrivateConfig.get('timelineH')}px`;
  editTable!.style.height = `${PrivateConfig.get('editorH')}px`;
  leftPane!.style.width = `${PrivateConfig.get('leftPaneW')}px`;
});

MainConfig.init();
MainConfig.onInitialized(() => {
  document.documentElement.style.setProperty('--fontSize', `${InterfaceConfig.data.fontSize}px`);
  document.documentElement.style.setProperty('--fontFamily', InterfaceConfig.data.fontFamily);
});

$effect(() => {
  document.documentElement.style.setProperty('--fontSize', `${InterfaceConfig.data.fontSize}px`);
  document.documentElement.style.setProperty('--fontFamily', InterfaceConfig.data.fontFamily);
});

getVersion().then((x) => 
  appWindow.setTitle(`subtle beta ${x}a0 (${platform()}-${version()}/${arch()})`));

appWindow.onCloseRequested(async (ev) => {
  if (!await Interface.warnIfNotSaved()) {
    ev.preventDefault();
    return;
  }

  const factor = await appWindow.scaleFactor();
  const size = (await appWindow.innerSize()).toLogical(factor);
  const pos = (await appWindow.position()).toLogical(factor);
  await PrivateConfig.set('windowW', size.width);
  await PrivateConfig.set('windowH', size.height);
  await PrivateConfig.set('windowX', pos.x);
  await PrivateConfig.set('windowY', pos.y);
  await PrivateConfig.set('videoH', videoCanvasContainer!.clientHeight);
  await PrivateConfig.set('timelineH', timelineCanvas!.clientHeight);
  await PrivateConfig.set('editorH', editTable!.clientHeight);
  await PrivateConfig.set('leftPaneW', leftPane!.clientWidth);
  await MainConfig.save();
});

appWindow.onDragDropEvent(async (ev) => {
  if (ev.payload.type == 'drop') {
    const path = ev.payload.paths.at(0);
    if (!path) return;
    if (!await Interface.warnIfNotSaved()) return;
    await Interface.openFile(path);
  }
});
</script>

<svelte:document 
  onkeydown={(ev) => Actions.processGlobalKeydown(ev)}/>
<svelte:window
  onload={() => {
    let time = performance.now();
    console.log('load time:', time);
  }}
  onbeforeunload={(ev) => {
    if (get(Source.fileChanged)) ev.preventDefault();
  }}
  onfocusin={(ev) => {
    // TODO: this works but looks like nonsense
    if ($uiFocus != UIFocus.EditingField)
      $uiFocus = UIFocus.Other;
  }}/>

<!-- dialogs -->
<TimeAdjustmentDialog handler={Dialogs.timeTransform}/>
<ImportOptionsDialog  handler={Dialogs.importOptions}/>
<CombineDialog        handler={Dialogs.combine}/>
<EncodingDialog       handler={Dialogs.encoding}/>
<ExportDialog         handler={Dialogs.export}/>
<ConfigDialog         handler={Dialogs.configuration}/>

<main class="vlayout container fixminheight">
  <!-- toolbar -->
  <div>
    <ul class='menu'>
      <li><button onclick={async () => {
        const paths = PrivateConfig.get('paths');
        let openMenu = await Menu.new({ items: [
            {
              text: 'other file...',
              async action(_) {
                if (await Interface.warnIfNotSaved())
                Interface.askOpenFile();
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
                  if (await Interface.warnIfNotSaved())
                  Interface.openFile(x.name);
                }
              }))
            ),
        ]});
        openMenu.popup();
      }}>open</button></li>
      <li><button onclick={() => Interface.askSaveFile(true)}>save as</button></li>
      <li><button onclick={() => Interface.askImportFile()}>import</button></li>
      <li><button onclick={() => Interface.askExportFile()}>export</button></li>
      <li class='separator'></li>
      {#key undoRedoUpdateCounter}
      <li><button
        onclick={() => Source.undo()} 
        disabled={Source.undoStack.length <= 1}>undo</button></li>
      <li><button
        onclick={() => Source.redo()}
        disabled={Source.redoStack.length == 0}>redo</button></li>
      {/key}
      <li class='separator'></li>
      <li><button onclick={() => Interface.askOpenVideo()}>open video</button></li>
      <li class='separator'></li>
      <li class="label">{$filenameDisplay}</li>
      <li><button onclick={() => Dialogs.configuration.showModal!()}>configuration</button></li>
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
          onclick={() => Playback.toggle()
            .catch((e) => $status = `Error playing video: ${e}`)}
        >{playIcon}</button>
        <input type='range' class='play-pointer flexgrow'
          step="any" max="1" min="0" disabled={sliderDisabled}
          bind:value={playPos}
          oninput={() => {
            if (!Playback.isLoaded) {
              playPos = 0;
              return;
            }
            Playback.setPosition(playPos * Playback.duration);
          }}/>
        <TimestampInput bind:timestamp={playPosInput}
          on:change={() => Playback.setPosition(playPosInput)}/>
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
            <PropertiesToolbox/>
          </TabPage>
          <TabPage name="Untimed text" active={true}>
            <UntimedToolbox/>
          </TabPage>
          <TabPage name="Search/Replace">
            <SearchToolbox/>
          </TabPage>
          <TabPage name="Test">
            <TestToolbox/>
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
              Editing.editChanged = true;}} 
            on:change={() => 
              Source.markChanged(ChangeType.Times, ChangeCause.UIForm)}/>
          <br>
          <TimestampInput bind:timestamp={editingT1}
            stretch={true}
            on:input={() => {
              if (editMode == 1 && keepDuration)
                editingT0 = editingT1 - editingDt;
              applyEditForm(); 
              Editing.editChanged = true;}} 
            on:change={() => {
              if (editingT1 < editingT0) editingT1 = editingT0;
              applyEditForm();
              Source.markChanged(ChangeType.Times, ChangeCause.UIForm);}}/>
          <br>
          <TimestampInput bind:timestamp={editingDt}
            stretch={true}
            on:input={() => {
              if (editMode == 0)
                editingT1 = editingT0 + editingDt; 
              else if (editMode == 1)
                editingT0 = editingT1 - editingDt; 
              applyEditForm();
              Editing.editChanged = true;}}
            on:change={() => 
              Source.markChanged(ChangeType.Times, ChangeCause.UIForm)}/>
          <hr>
          <div class="hlayout">
            <div style={`height: auto; width: 25px; border: solid 1px;
              margin: 2px; background-color: ${LabelColor(editingLabel)}`}></div>
            <select
              bind:value={editingLabel}
              class="flexgrow"
              onchange={() => {
                applyEditForm();
                Source.markChanged(ChangeType.InPlace, ChangeCause.UIForm);}}>
              {#each Labels as color}
                <option value={color}>{color}</option>
              {/each}
            </select>
          </div>
        </div>
        <!-- channels view -->
        <div class="channels flexgrow isolated">
          {#if Editing.getFocusedEntry() instanceof SubtitleEntry}
          {@const focused = Editing.getFocusedEntry() as SubtitleEntry}
          <table class='fields'>
            <tbody>
              {#each focused.texts as line, i}
              <tr>
                <td class="vlayout">
                  <StyleSelect bind:currentStyle={line.style}
                    on:submit={() => {
                      Source.markChanged(ChangeType.InPlace, ChangeCause.UIForm)}} />
                  <div class="hlayout">
                    <button tabindex='-1' class="flexgrow"
                      onclick={() => Editing.insertChannelAt(i)}>+</button>
                    <button tabindex='-1' class="flexgrow"
                      onclick={() => Editing.deleteChannelAt(i)}
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
                      Editing.focused.channel = line;
                      Editing.focused.style = line.style;
                    }}
                    onblur={(x) => {
                      // TODO: this works but looks like nonsense
                      if ($uiFocus === UIFocus.EditingField)
                        $uiFocus = UIFocus.Other;
                      Editing.submitFocusedEntry();
                      Editing.focused.channel = null;
                    }}
                    oninput={(x) => {
                      $uiFocus = UIFocus.EditingField;
                      contentSelfAdjust(x.currentTarget); 
                      Editing.editChanged = true;
                    }}></textarea>
                </td>
              </tr>
              {/each}
            </tbody>
          </table>
          {:else}
          <div class="fill hlayout" style="justify-content: center; align-items: center;">
            <i>{Editing.getFocusedEntry() == 'virtual'
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
      <div class='fixminheight subscontainer flexgrow isolated' 
        class:subsfocused={$uiFocus === UIFocus.Table}>
        <SubtitleTable/>
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