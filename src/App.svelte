<script lang="ts">
console.info('App loading');

import { _, locale, isLoading } from 'svelte-i18n';
import * as i18n from 'svelte-i18n';

i18n.register('en', () => import('./locales/en.json'));
i18n.register('zh-cn', () => import('./locales/zh-cn.json'));
i18n.register('zh-tw', () => import('./locales/zh-tw.json'));
i18n.init({ fallbackLocale: 'zh-cn', initialLocale: 'en' });

import { DebugConfig, InterfaceConfig, MainConfig } from "./lib/config/Groups";
import { PrivateConfig } from './lib/config/PrivateConfig';

import { TableConfig } from "./lib/component/subtitleTable/Config";
import { MediaConfig } from "./lib/component/preview/Config";
import { TimelineConfig } from './lib/component/timeline/Config';

MainConfig.addGroup('timeline', TimelineConfig);
MainConfig.addGroup('media', MediaConfig);
MainConfig.addGroup('table', TableConfig);

import CombineDialog from "./lib/dialog/CombineDialog.svelte";
import ConfigDialog from './lib/dialog/ConfigDialog.svelte';
import EncodingDialog from './lib/dialog/EncodingDialog.svelte';
import ExportDialog from './lib/dialog/ExportDialog.svelte';
import ImportOptionsDialog from './lib/dialog/ImportOptionsDialog.svelte';
import SplitByLineDialog from './lib/dialog/SplitByLineDialog.svelte';
import TimeAdjustmentDialog from './lib/dialog/TimeTransformDialog.svelte';
import KeybindingDialog from './lib/dialog/KeybindingDialog.svelte';
import KeybindingInputDialog from './lib/dialog/KeybindingInputDialog.svelte';

import EntryEdit from './lib/EntryEdit.svelte';
import SubtitleTable from './lib/component/subtitleTable/SubtitleTable.svelte';
import Timeline from './lib/component/timeline/Timeline.svelte';
import Preview from './lib/component/preview/Preview.svelte';

import Resizer from './lib/ui/Resizer.svelte';
import TabPage from './lib/ui/TabPage.svelte';
import TabView from './lib/ui/TabView.svelte';
import Tooltip from './lib/ui/Tooltip.svelte';

import PropertiesToolbox from './lib/toolbox/PropertiesToolbox.svelte';
import SearchToolbox from './lib/toolbox/SearchToolbox.svelte';
import TestToolbox from './lib/toolbox/TestToolbox.svelte';
import UntimedToolbox from './lib/toolbox/UntimedToolbox.svelte';

import { Basic } from './lib/Basic';

import { getVersion } from '@tauri-apps/api/app';
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { LogicalPosition, LogicalSize } from '@tauri-apps/api/window';
import { arch, platform, version } from '@tauri-apps/plugin-os';
import { derived, get } from 'svelte/store';

import { DialogCommands, Dialogs } from './lib/frontend/Dialogs';
import { Interface, InterfaceCommands } from './lib/frontend/Interface';
import { Playback, PlaybackCommands } from './lib/frontend/Playback';
import { Source, SourceCommands } from './lib/frontend/Source';
import { KeybindingManager } from './lib/frontend/Keybinding';

import { CommandIcon, FilmIcon, SettingsIcon } from '@lucide/svelte';

import { Debug, GetLevelFilter } from './lib/Debug';
Debug.init();

const appWindow = getCurrentWebviewWindow();

let leftPane: HTMLElement | undefined = $state();
let editTable: HTMLElement | undefined = $state();
let videoCanvasContainer: HTMLElement | undefined = $state();
let timelineCanvasContainer: HTMLDivElement | undefined = $state();
let statusBar: HTMLDivElement | undefined = $state();

let isPlaying = $state(false);
let playPos = $state(0);
let playPosInput = $state(0);
let statusTwinkling = $state(false);

let status = Interface.status;
let uiFocus = Interface.uiFocus;
let toolboxFocus = Interface.toolboxFocus;
let isMediaLoaded = Playback.isLoaded;
let filenameDisplay = 
  derived([Source.currentFile, Source.fileChanged, _], 
    ([x, y]) => `${x ? Basic.getFilename(x) : $_('untitled')}${y ? '*' : ''}`);

const me = {};

let undoRedoUpdateCounter = $state(0);
Source.onUndoBufferChanged.bind(me, () => {
  undoRedoUpdateCounter++;
});

Interface.status.subscribe(() => { 
  // twinkle status bar
  if (InterfaceConfig.data.statusBarTwinkle)
    statusTwinkling = true;
});

Playback.onRefreshPlaybackControl.bind(me, () => {
  playPos = $isMediaLoaded ? Playback.position / Playback.duration : 0;
  isPlaying = Playback.isPlaying;
  playPosInput = Playback.position;
});

PrivateConfig.init();
PrivateConfig.onInitialized(() => {
  appWindow.setPosition(new LogicalPosition(
    PrivateConfig.get('windowX'), 
    PrivateConfig.get('windowY')));
  appWindow.setSize(new LogicalSize(
    Math.max(PrivateConfig.get('windowW'), 500),
    Math.max(PrivateConfig.get('windowH'), 500)));
  videoCanvasContainer!.style.height = `${PrivateConfig.get('videoH')}px`;
  timelineCanvasContainer!.style.height = `${PrivateConfig.get('timelineH')}px`;
  editTable!.style.height = `${PrivateConfig.get('editorH')}px`;
  leftPane!.style.width = `${PrivateConfig.get('leftPaneW')}px`;
});

MainConfig.hook(() => InterfaceConfig.data.fontSize, 
  (v) => document.documentElement.style.setProperty('--fontSize', `${v}px`));

MainConfig.hook(() => InterfaceConfig.data.fontFamily, 
  (v) => document.documentElement.style.setProperty('--fontFamily', v));

MainConfig.hook(() => InterfaceConfig.data.editorFontSize, 
  (v) => document.documentElement.style.setProperty('--editorFontSize', `${v}px`));

MainConfig.hook(() => InterfaceConfig.data.editorFontFamily, 
  (v) => document.documentElement.style.setProperty('--editorFontFamily', v));

MainConfig.hook(() => InterfaceConfig.data.monospaceFontFamily, 
  (v) => document.documentElement.style.setProperty('--monospaceFontFamily', v));

MainConfig.hook(() => InterfaceConfig.data.language, (lang) => {
  locale.set(lang);
  console.log('language =', lang);
});

MainConfig.hook(() => InterfaceConfig.data.autosaveInterval, (v) => {
  Source.startAutoSave();
  Debug.debug('autosave interval =', v);
});

MainConfig.hook(() => DebugConfig.data.redirectLogs, (v) => {
  Debug.redirectNative = v;
  Debug.debug('redirectLogs =', v);
});

MainConfig.hook(() => DebugConfig.data.logLevel, (v) => {
  Debug.filterLevel = GetLevelFilter[v as keyof typeof GetLevelFilter];
  Debug.debug('webview filter level =', v);
});

MainConfig.hook(() => DebugConfig.data.persistentLogLevel, (v) => 
  Debug.setPersistentFilterLevel(GetLevelFilter[v as keyof typeof GetLevelFilter]));

let settingTheme = false;
MainConfig.hook(() => InterfaceConfig.data.theme, 
  async (theme) => {
    if (settingTheme) return;
    settingTheme = true;
    await appWindow.setTheme(theme == 'light' ? 'light'
                           : theme == 'dark' ? 'dark'
                           : undefined);
    settingTheme = false;
    Debug.debug('changed theme', InterfaceConfig.data.theme);
  });

MainConfig.init();

KeybindingManager.init();

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
  await PrivateConfig.set('timelineH', timelineCanvasContainer!.clientHeight);
  await PrivateConfig.set('editorH', editTable!.clientHeight);
  await PrivateConfig.set('leftPaneW', leftPane!.clientWidth);
  await Interface.savePublicConfig();
});

appWindow.onDragDropEvent(async (ev) => {
  if (ev.payload.type == 'drop') {
    const path = ev.payload.paths.at(0);
    if (!path) return Debug.early('no path in dropped payload');
    if (!await Interface.warnIfNotSaved()) return;
    await Interface.openFile(path);
  }
});
</script>

<svelte:window
  onload={() => {
    let time = performance.now();
    Debug.info(`load time: ${time}`);
    Source.init();
  }}
  onbeforeunload={(ev) => {
    if (get(Source.fileChanged)) ev.preventDefault();
  }}
  onfocusin={(ev) => {
    // TODO: this works but looks like nonsense
    if ($uiFocus != 'EditingField')
      $uiFocus = 'Other';
  }}/>

{#if $isLoading}
<!-- loading locales -->
{:else}

<!-- dialogs -->
<TimeAdjustmentDialog handler={Dialogs.timeTransform}/>
<ImportOptionsDialog  handler={Dialogs.importOptions}/>
<CombineDialog        handler={Dialogs.combine}/>
<SplitByLineDialog    handler={Dialogs.splitByLine}/>
<EncodingDialog       handler={Dialogs.encoding}/>
<ExportDialog         handler={Dialogs.export}/>
<ConfigDialog         handler={Dialogs.configuration}/>
<KeybindingDialog     handler={Dialogs.keybinding}/>
<KeybindingInputDialog handler={Dialogs.keybindingInput}/>

<main class="vlayout container fixminheight">
  <!-- toolbar -->
  <div>
    <ul class='menu'>
      <li><button onclick={() => InterfaceCommands.newFile.menu()}>{$_('menu.new-file')}</button></li>
      <li><button onclick={() => InterfaceCommands.openMenu.menu()}>{$_('menu.open')}</button></li>
      <li><button onclick={() => InterfaceCommands.saveAs.menu()}>{$_('menu.save-as')}</button></li>
      <li><button onclick={() => InterfaceCommands.import.menu()}>{$_('menu.import')}</button></li>
      <li><button onclick={() => InterfaceCommands.exportMenu.menu()}>{$_('menu.export')}</button></li>
      <li class='separator'></li>
      {#key undoRedoUpdateCounter}
      <li><button
        onclick={() => SourceCommands.undo.call()} 
        disabled={Source.undoStack.length <= 1}>{$_('menu.undo')}</button></li>
      <li><button
        onclick={() => SourceCommands.redo.call()}
        disabled={Source.redoStack.length == 0}>{$_('menu.redo')}</button></li>
      {/key}
      <li class='separator'></li>
      <li><button onclick={() => InterfaceCommands.openVideo.call()}>
        <FilmIcon />
        &nbsp;{$_('menu.open-video')}
      </button></li>
      <li><button disabled={!$isMediaLoaded} 
          onclick={() => PlaybackCommands.selectAudioStream.call()}>
        {$_('menu.select-audio-stream')}
      </button></li>
      <li><button disabled={!$isMediaLoaded}
          onclick={() => InterfaceCommands.closeVideo.call()}>
        {$_('menu.close-video')}
      </button></li>
      <li class='separator'></li>
      <li class="label">{$filenameDisplay}</li>
      <li>
        <Tooltip text={$_('menu.keybinding')} position="bottom">
          <button aria-label={$_('menu.keybinding')}
                  onclick={() => DialogCommands.openKeybinding.call()}>
            <CommandIcon />
          </button>
        </Tooltip>
      </li>
      <li>
        <Tooltip text={$_('menu.configuration')} position="bottom">
          <button aria-label={$_('menu.configuration')}
                  onclick={() => DialogCommands.openConfiguration.call()}>
            <SettingsIcon />
          </button>
        </Tooltip>
      </li>
    </ul>
  </div>

  <!-- body -->
  <div class='hlayout flexgrow fixminheight'>
    <div bind:this={leftPane} style="width: 300px;" class="fixminheight vlayout isolated">
      <!-- video -->
      <div bind:this={videoCanvasContainer} class="vlayout">
        <Preview />
      </div>
      <!-- resizer -->
      <div>
        <Resizer control={videoCanvasContainer} minValue={100}/>
      </div>
      <!-- toolbox -->
      <div class="flexgrow fixminheight">
        <TabView bind:value={$toolboxFocus}>
          <TabPage name={$_('tab.properties')} id='properties'>
            <PropertiesToolbox/>
          </TabPage>
          <TabPage name={$_('tab.untimed-text')} id='untimed'>
            <UntimedToolbox/>
          </TabPage>
          <TabPage name={$_('tab.search-replace')} id='search'>
            <SearchToolbox/>
          </TabPage>
          <TabPage name="Test" id='test'>
            <TestToolbox/>
          </TabPage>
        </TabView>
      </div>
    </div>
    <div style="width: 10px;">
      <Resizer vertical={true} minValue={200} control={leftPane}/>
    </div>
    <div class="flexgrow fixminheight vlayout isolated">
      <!-- edit box -->
      <div bind:this={editTable} style="height: 125px; padding-top: 3px">
        <EntryEdit />
      </div>
      <!-- resizer -->
      <div><Resizer control={editTable} minValue={125}/></div>
      <!-- table view -->
      <div class='flexgrow isolated' style="padding-bottom: 6px">
        <SubtitleTable />
      </div>
    </div>
  </div>
  <!-- resizer -->
  <div>
    <Resizer control={timelineCanvasContainer!} reverse={true}/>
  </div>
  <!-- timeline -->
  <div bind:this={timelineCanvasContainer}>
    <Timeline />
  </div>

  <!-- status bar -->
  <div bind:this={statusBar}
    class={[{status: true, twinkling: statusTwinkling}, $status.type]}
    onanimationend={() => statusTwinkling = false}
  >{$status.msg}</div>
</main>

{/if}

<style>
@media (prefers-color-scheme: light) {
  .status {
    background-color: var(--uchu-yin-2);
  }
  ul.menu {
    background-color: var(--uchu-yin-4);
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
  .twinkling.error {
    --twinkle-color: var(--uchu-red-3);
  }
  .twinkling.info {
    --twinkle-color: var(--uchu-blue-3);
  }
}

@media (prefers-color-scheme: dark) {
  .status, ul.menu {
    background-color: var(--uchu-yin-7);
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
  .twinkling.error {
    --twinkle-color: var(--uchu-red-3);
  }
  .twinkling.info {
    --twinkle-color: var(--uchu-blue-3);
  }
}

@keyframes twinkle-effect {
  0% {
    box-shadow: 0 0 0px 0px rgba(0, 0, 0, 0.0);
  }
  50% {
    box-shadow: 0 0 2px 2px var(--twinkle-color);
  }
  100% {
    box-shadow: 0 0 0px 0px rgba(0, 0, 0, 0.0);
  }
}

.twinkling {
  animation: twinkle-effect 0.3s ease-in-out 1;
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

.status {
  text-align: left;
  padding: 5px;
  margin: 5px 0 0 0;
  line-height: normal;
  white-space: nowrap;
  overflow-x: auto;
}
</style>