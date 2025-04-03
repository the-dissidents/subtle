<script lang="ts">
console.info('App loading');

import { _, locale } from 'svelte-i18n';

import { InterfaceConfig, MainConfig } from "./lib/config/Groups";
import { PrivateConfig } from './lib/config/PrivateConfig';

import { TableConfig } from "./lib/SubtitleTable.svelte";
import { TimelineConfig } from "./lib/Timeline.svelte";
import { MediaConfig } from "./lib/VideoPlayer";

MainConfig.addGroup('timeline', TimelineConfig);
MainConfig.addGroup('media', MediaConfig);
MainConfig.addGroup('table', TableConfig);

import CombineDialog from "./lib/dialog/CombineDialog.svelte";
import ConfigDialog from './lib/dialog/ConfigDialog.svelte';
import EncodingDialog from './lib/dialog/EncodingDialog.svelte';
import ExportDialog from './lib/dialog/ExportDialog.svelte';
import ImportOptionsDialog from './lib/dialog/ImportOptionsDialog.svelte';
import TimeAdjustmentDialog from './lib/dialog/TimeTransformDialog.svelte';

import EntryEdit from './lib/EntryEdit.svelte';
import SubtitleTable from './lib/SubtitleTable.svelte';
import TimestampInput from './lib/TimestampInput.svelte';

import Resizer from './lib/ui/Resizer.svelte';
import TabPage from './lib/ui/TabPage.svelte';
import TabView from './lib/ui/TabView.svelte';

import PropertiesToolbox from './lib/toolbox/PropertiesToolbox.svelte';
import SearchToolbox from './lib/toolbox/SearchToolbox.svelte';
import TestToolbox from './lib/toolbox/TestToolbox.svelte';
import UntimedToolbox from './lib/toolbox/UntimedToolbox.svelte';

import { assert, Basic } from './lib/Basic';

import { getVersion } from '@tauri-apps/api/app';
import { arch, platform, version } from '@tauri-apps/plugin-os';
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { LogicalPosition, LogicalSize } from '@tauri-apps/api/window';
import { invoke } from '@tauri-apps/api/core';
import type { Action } from 'svelte/action';
import { derived, get } from 'svelte/store';

import { Actions } from './lib/frontend/Actions';
import { Dialogs } from './lib/frontend/Dialogs';
import { Interface, UIFocus } from './lib/frontend/Interface';
import { Playback } from './lib/frontend/Playback';
import { Source } from './lib/frontend/Source';
    import { theme } from './lib/Theming.svelte';

const appWindow = getCurrentWebviewWindow()

let leftPane: HTMLElement | undefined = $state();
let editTable: HTMLElement | undefined = $state();
let videoCanvasContainer: HTMLElement | undefined = $state();
let videoCanvas: HTMLCanvasElement | undefined = $state();
let timelineCanvas: HTMLCanvasElement | undefined = $state();

let isPlaying = $state(false);
let sliderDisabled = $state(true);
let playPos = $state(0);
let playPosInput = $state(0);

let undoRedoUpdateCounter = $state(0);

let status = Interface.status;
let uiFocus = Interface.uiFocus;
let isMediaLoaded = Playback.isLoaded;
let filenameDisplay = 
  derived([Source.currentFile, Source.fileChanged, _], 
    ([x, y]) => `${x ? Basic.getFilename(x) : $_('untitled')}${y ? '*' : ''}`);

const me = {};

Source.onUndoBufferChanged.bind(me, () => {
  undoRedoUpdateCounter++;
});

Playback.onRefreshPlaybackControl = () => {
  sliderDisabled = !$isMediaLoaded;
  playPos = $isMediaLoaded ? Playback.position / Playback.duration : 0;
  isPlaying = Playback.isPlaying;
  playPosInput = Playback.position ?? 0;
};

let setupVideoView: Action = () => {
  assert(videoCanvasContainer !== undefined && videoCanvas !== undefined);
  Playback.createVideo(videoCanvas);
};

let setupTimelineView: Action = () => {
  assert(timelineCanvas !== undefined);
  Playback.createTimeline(timelineCanvas);
};

PrivateConfig.init();
PrivateConfig.onInitialized(() => {
  appWindow.setPosition(new LogicalPosition(
    PrivateConfig.get('windowX'), 
    PrivateConfig.get('windowY')));
  appWindow.setSize(new LogicalSize(
    Math.max(PrivateConfig.get('windowW'), 500),
    Math.max(PrivateConfig.get('windowH'), 500)));
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

$effect(() => {
  InterfaceConfig.data.autosaveInterval;
  Source.startAutoSave();
});

let settingTheme = false;
async function updateTheme() {
  if (settingTheme) return;
  settingTheme = true;
  await invoke("plugin:theme|set_theme", {
    theme: InterfaceConfig.data.theme,
  });
  settingTheme = false;
}

$effect(() => {
  updateTheme();
});

$effect(() => {
  if (theme.isDark !== undefined)
    Playback.timeline?.requestRender();
});

getVersion().then((x) => 
  appWindow.setTitle(`subtle beta ${x} (${platform()}-${version()}/${arch()})`));

appWindow.onCloseRequested(async (ev) => {
  if (!await Interface.warnIfNotSaved()) {
    ev.preventDefault();
    return;
  }

  const factor = await appWindow.scaleFactor();
  const size = (await appWindow.innerSize()).toLogical(factor);
  const pos = (await appWindow.position()).toLogical(factor);
  if (size.width > 500 && size.height > 500) {
    await PrivateConfig.set('windowW', size.width);
    await PrivateConfig.set('windowH', size.height);
  }
  await PrivateConfig.set('windowX', pos.x);
  await PrivateConfig.set('windowY', pos.y);
  await PrivateConfig.set('videoH', videoCanvasContainer!.clientHeight);
  await PrivateConfig.set('timelineH', timelineCanvas!.clientHeight);
  await PrivateConfig.set('editorH', editTable!.clientHeight);
  await PrivateConfig.set('leftPaneW', leftPane!.clientWidth);
  await Interface.savePublicConfig();
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
        <svg class="feather">
          <use href="/feather-sprite.svg#film" />
        </svg>
        &nbsp;{$_('menu.open-video')}
      </button></li>
      <li><button disabled={!$isMediaLoaded} onclick={() => Playback.close()}>
        {$_('menu.close-video')}
      </button></li>
      <li class='separator'></li>
      <li class="label">{$filenameDisplay}</li>
      <li><button title={$_('menu.configuration')} aria-label={$_('menu.configuration')}
                  onclick={() => Dialogs.configuration.showModal!()}>
        <svg class="feather">
          <use href="/feather-sprite.svg#settings" />
        </svg>
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
        <button aria-label="play/pause"
          onclick={() => Playback.toggle()
            .catch((e) => $status = `Error playing video: ${e}`)}>
          <svg class="feather">
            <use href={isPlaying 
              ? "/feather-sprite.svg#pause" 
              : "/feather-sprite.svg#play"} />
          </svg>
        </button>
        <input type='range' class='play-pointer flexgrow'
          step="any" max="1" min="0" disabled={sliderDisabled}
          bind:value={playPos}
          oninput={() => {
            if (!$isMediaLoaded) {
              playPos = 0;
              return;
            }
            Playback.setPosition(playPos * Playback.duration);
          }}/>
        <TimestampInput bind:timestamp={playPosInput}
          onchange={() => Playback.setPosition(playPosInput)}/>
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
@media (prefers-color-scheme: light) {
  .status {
    background-color: var(--uchu-yin-2);
  }
  ul.menu {
    background-color: var(--uchu-yin-4);
  }
  .timelinefocused {
    box-shadow: 0 5px 10px gray;
  }
  ul.menu button {
    background-color: transparent;
    color: white;
  }
  ul.menu button:not([disabled]):hover {
    background-color: var(--uchu-yin-2) !important;
  }
  ul.menu button[disabled] {
    color: gainsboro;
  }
  ul.menu .label {
    color: rgb(226, 223, 223);
    background-color: transparent;
  }
  ul.menu .separator {
    background-color: rgb(193, 193, 193);
  }
  .player-container canvas {
    background-color: lightgray;
  }
  canvas.timeline {
    background-color: var(--uchu-gray-1);
  }
}

@media (prefers-color-scheme: dark) {
  .status, ul.menu {
    background-color: var(--uchu-yin-7);
  }
  .timelinefocused {
    box-shadow: 0 5px 10px gray;
  }
  ul.menu button {
    color: white;
    background-color: transparent;
  }
  ul.menu button:not([disabled]):hover {
    background-color: var(--uchu-yin-6) !important;
  }
  ul.menu button[disabled] {
    color: var(--uchu-yin-4);
  }
  ul.menu .label {
    color: rgb(226, 223, 223);
    background-color: transparent;
  }
  ul.menu .separator {
    background-color: rgb(193, 193, 193);
  }
  .player-container canvas {
    background-color: black;
  }
  canvas.timeline {
    background-color: black;
  }
}

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
  display: flex;
  min-width: max-content;
  border: none;
  margin: 0;
  border-radius: 0;
  text-align: center;
  padding: 10px 15px 10px;
  text-decoration: none;
  box-shadow: none;
}

ul.menu .label {
  display: block;
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
  white-space: nowrap;
  overflow-x: auto;
}
</style>