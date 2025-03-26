<script lang="ts">
  import EntryEdit from './EntryEdit.svelte';

import * as _i18n from './lib/i18n';

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
import TimestampInput from './lib/TimestampInput.svelte';
import SubtitleTable from './lib/SubtitleTable.svelte';

import PropertiesToolbox from './lib/toolbox/PropertiesToolbox.svelte';
import UntimedToolbox from './lib/toolbox/UntimedToolbox.svelte';
import SearchToolbox from './lib/toolbox/SearchToolbox.svelte';
import TestToolbox from './lib/toolbox/TestToolbox.svelte';

import { assert, Basic } from './lib/Basic';
import { CanvasKeeper } from './lib/CanvasKeeper';

import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { LogicalPosition, LogicalSize } from '@tauri-apps/api/window';
import type { Action } from 'svelte/action';
import { derived, get } from 'svelte/store';

import { Source } from './lib/frontend/Source';
import { Interface, UIFocus } from './lib/frontend/Interface';
import { Playback } from './lib/frontend/Playback';
import { Dialogs } from './lib/frontend/Dialogs';
import { Actions } from './lib/frontend/Actions';
import { getVersion } from '@tauri-apps/api/app';
import { arch, platform, version } from '@tauri-apps/plugin-os';

import { _, locale } from 'svelte-i18n';

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

let undoRedoUpdateCounter = $state(0);

let status = Interface.status;
let uiFocus = Interface.uiFocus;
let filenameDisplay = 
  derived([Source.currentFile, Source.fileChanged, _], 
    ([x, y]) => `${x ? Basic.getFilename(x) : $_('untitled')}${y ? '*' : ''}`);

const me = {};

Source.onUndoBufferChanged.bind(me, () => {
  undoRedoUpdateCounter++;
});

Playback.onRefreshPlaybackControl = () => {
  sliderDisabled = !Playback.isLoaded;
  playIcon = Playback.isPlaying ? '⏸' : '▶'
  playPosInput = Playback.position ?? 0;
  playPos = Playback.isLoaded 
    ? Playback.position / Playback.duration : 0;
};

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

$effect(() => {
    locale.set(InterfaceConfig.data.language);
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
      <li><button onclick={() => Interface.openFileMenu()}>{$_('menu.open')}</button></li>
      <li><button onclick={() => Interface.askSaveFile(true)}>{$_('menu.save-as')}</button></li>
      <li><button onclick={() => Interface.askImportFile()}>{$_('menu.import')}</button></li>
      <li><button onclick={() => Interface.exportFileMenu()}>{$_('menu.export')}</button></li>
      <li class='separator'></li>
      {#key undoRedoUpdateCounter}
      <li><button
        onclick={() => Source.undo()} 
        disabled={Source.undoStack.length <= 1}>{$_('menu.undo')}</button></li>
      <li><button
        onclick={() => Source.redo()}
        disabled={Source.redoStack.length == 0}>{$_('menu.redo')}</button></li>
      {/key}
      <li class='separator'></li>
      <li><button onclick={() => Interface.askOpenVideo()}>
        {$_('menu.open-video')}
      </button></li>
      <li class='separator'></li>
      <li class="label">{$filenameDisplay}</li>
      <li><button onclick={() => Dialogs.configuration.showModal!()}>
        {$_('menu.configuration')}
      </button></li>
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
          <TabPage name={$_('tab.properties')}>
            <PropertiesToolbox/>
          </TabPage>
          <TabPage name={$_('tab.untimed-text')} active={true}>
            <UntimedToolbox/>
          </TabPage>
          <TabPage name={$_('tab.search-replace')}>
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
      <div bind:this={editTable} style="height: 125px; padding-top: 3px">
        <EntryEdit/>
      </div>
      <!-- resizer -->
      <div><Resizer control={editTable} minValue={125}/></div>
      <!-- table view -->
      <div class='flexgrow isolated' style="padding-bottom: 6px">
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
    <canvas class="timeline fill" bind:this={timelineCanvas}
      use:setupTimelineView
      onclick={() => $uiFocus = UIFocus.Timeline}
      class:timelinefocused={$uiFocus === UIFocus.Timeline}
      style="height: 150px;"></canvas>
  </div>

  <!-- status bar -->
  <div class='status'>{$status}</div>
</main>

<style>
.container {
  margin: 0;
  padding: 10px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  height: 100vh;
  max-height: 100vh;
  box-sizing: border-box;
}

.fixminheight {
  min-height: 0;
  min-width: 0;
}

ul.menu {
  flex: none;
  list-style-type: none;
  margin: 0;
  padding: 0;
  overflow: hidden;
  background-color: gray;
  display: flex;
  align-items: center;
  cursor: default;
  user-select: none; -webkit-user-select: none;
  -moz-user-select: none; -ms-user-select: none;
}

ul.menu li {
  float: left;
  flex: none;
}

ul.menu button {
  font-size: 1rem;
  display: block;
  color: white;
  min-width: max-content;
  background-color: transparent;
  border: none;
  border-radius: 0;
  text-align: center;
  padding: 10px 15px 10px;
  text-decoration: none;
}

ul.menu button:hover {
  background-color: darkgray !important;
}

ul.menu button[disabled] {
  background-color: transparent;
  color: gainsboro;
}

ul.menu .label {
  display: block;
  color: rgb(226, 223, 223);
  background-color: transparent;
  border: none;
  text-align: start;
  flex-grow: 1;
  height: 100%;
  text-decoration: none;
  padding: 0 10px 0 10px;
}

ul.menu .separator {
  width: 1px;
  min-height: 30px;
  display: block;
  margin: 0 10px;
  background-color: rgb(193, 193, 193);
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

.timeline {
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