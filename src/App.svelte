<script lang="ts">
console.info('App loading');

import { derived, get } from 'svelte/store';
import { _, locale, isLoading } from 'svelte-i18n';
import * as i18n from 'svelte-i18n';

i18n.register('en', () => import('./locales/en.json'));
i18n.register('zh-cn', () => import('./locales/zh-cn.json'));
i18n.register('zh-tw', () => import('./locales/zh-tw.json'));
i18n.init({ fallbackLocale: 'zh-cn', initialLocale: 'en' });

import { DebugConfig, InterfaceConfig, MainConfig } from "./lib/config/Groups";
import { TableConfig } from "./lib/component/subtitleTable/Config";
import { MediaConfig } from "./lib/component/preview/Config";
import { TimelineConfig } from './lib/component/timeline/Config';
import { Memorized } from './lib/config/MemorizedValue.svelte';

MainConfig.addGroup('timeline', TimelineConfig);
MainConfig.addGroup('media', MediaConfig);
MainConfig.addGroup('table', TableConfig);

import EntryEdit from './lib/EntryEdit.svelte';
import SubtitleTable from './lib/component/subtitleTable/SubtitleTable.svelte';
import Timeline from './lib/component/timeline/Timeline.svelte';
import Preview from './lib/component/preview/Preview.svelte';

import Resizer from './lib/ui/Resizer.svelte';
import TabPage from './lib/ui/TabPage.svelte';
import TabView from './lib/ui/TabView.svelte';
import Tooltip from './lib/ui/Tooltip.svelte';
import Banner from './lib/ui/Banner.svelte';

import PropertiesToolbox from './lib/toolbox/PropertiesToolbox.svelte';
import SearchToolbox from './lib/toolbox/SearchToolbox.svelte';
import TestToolbox from './lib/toolbox/TestToolbox.svelte';
import UntimedToolbox from './lib/toolbox/UntimedToolbox.svelte';
import ReferencesToolbox from './lib/toolbox/ReferencesToolbox.svelte';

import { Basic } from './lib/Basic';

import { onMount } from 'svelte';
import { getVersion } from '@tauri-apps/api/app';
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { arch, platform, version } from '@tauri-apps/plugin-os';
import { restoreStateCurrent, saveWindowState, StateFlags } from '@tauri-apps/plugin-window-state';

import { DialogCommands } from './lib/frontend/Dialogs';
import { Interface, InterfaceCommands, MEDIA_EXTENSIONS } from './lib/frontend/Interface';
import { Playback, PlaybackCommands } from './lib/frontend/Playback';
import { Source, SourceCommands } from './lib/frontend/Source';
import { KeybindingManager } from './lib/frontend/Keybinding';
import { Frontend } from './lib/frontend/Frontend';

import { BugIcon, CommandIcon, FilmIcon, SettingsIcon, TriangleAlertIcon } from '@lucide/svelte';
import { Debug, GetLevelFilter } from './lib/Debug';
import { MAPI } from './lib/API';
import { Fonts } from './lib/Fonts';
import { Dialog } from './lib/dialog';
import DialogOutlet, { openDialog } from './lib/DialogOutlet.svelte';

import * as z from "zod/v4-mini";
    
Debug.init();

const appWindow = getCurrentWebviewWindow();

let leftPane: HTMLElement | undefined = $state();
let editTable: HTMLElement | undefined = $state();
let videoCanvasContainer: HTMLElement | undefined = $state();
let timelineCanvasContainer: HTMLDivElement | undefined = $state();

let statusTwinkling = $state(false);

let status = Frontend.status;
let uiFocus = Frontend.uiFocus;
let toolboxFocus = Frontend.toolboxFocus;
let loadState = Playback.loadState;
let filenameDisplay = 
  derived([Source.currentFile, Source.fileChanged, _], 
    ([x, y]) => `${x ? Basic.getFilename(x) : $_('untitled')}${y ? '*' : ''}`);

const me = {};

let undoRedoUpdateCounter = $state(0);
Source.onUndoBufferChanged.bind(me, () => {
  undoRedoUpdateCounter++;
});

status.subscribe(() => { 
  // twinkle status bar
  if (InterfaceConfig.data.statusBarTwinkle)
    statusTwinkling = true;
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
  Debug.debug('language =', lang);
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
Fonts.init();

getVersion().then((x) => 
  appWindow.setTitle(`subtle beta ${x} (${platform()}-${version()}/${arch()})`));

appWindow.onCloseRequested(async (ev) => {
  if (!await Interface.warnIfNotSaved()) {
    ev.preventDefault();
    return;
  }

  $videoH = videoCanvasContainer!.clientHeight;
  $timelineH = timelineCanvasContainer!.clientHeight;
  $editorH = editTable!.clientHeight;
  $leftPaneW = leftPane!.clientWidth;
  await Memorized.save();
  await Interface.savePublicConfig();
  await saveWindowState(StateFlags.ALL);
});

appWindow.onDragDropEvent(async (ev) => {
  if (ev.payload.type == 'drop') {
    const path = ev.payload.paths.at(0);
    if (!path) return Debug.early();

    if (MEDIA_EXTENSIONS.includes(path.split('.').at(-1)!)) {
      await Interface.openVideo(path);
    } else {
      if (!await Interface.warnIfNotSaved()) return;
      await Interface.openFile(path);
    }
  }
});

let editorH = Memorized.$('editorH', z.number(), 125);
let timelineH = Memorized.$('timelineH', z.number(), 150);
let leftPaneW = Memorized.$('leftPaneW', z.number(), 300);
let videoH = Memorized.$('videoH', z.number(), 200);

Memorized.init();
Memorized.onInitialize(async () => {
  await restoreStateCurrent(StateFlags.ALL);
  videoCanvasContainer!.style.height = `${$videoH}px`;
  timelineCanvasContainer!.style.height = `${$timelineH}px`;
  editTable!.style.height = `${$editorH}px`;
  leftPane!.style.width = `${$leftPaneW}px`;
});

let errorBanner = $state({open: false});
Debug.onError.bind({}, (origin, _msg) => {
  if (origin == 'ffmpeg') return;
  errorBanner.open = true;
});

let versionBanner = $state({open: false});
onMount(() => {
  const popoverSupported = Object.prototype.hasOwnProperty.call(HTMLElement.prototype, 'popover');
  if (!popoverSupported) {
    versionBanner.open = true;
  }
});

const observer = new PerformanceObserver((list) => {
  for (const entry of list.getEntries()) {
    if (entry.name === 'first-contentful-paint') {
      Debug.info(`------ FCP at ${entry.startTime}ms`);
    }
  }
});
observer.observe({ type: 'paint', buffered: true });
</script>

<svelte:window
  onload={() => {
    const time = performance.now();
    getVersion().then((x) => Debug.info(`------ SUBTLE ${x} on ${Basic.architecture} ${Basic.platform} ${Basic.osVersion} | load time: ${time}`));
    Source.init();
  }}
  onbeforeunload={(ev) => {
    if (get(Source.fileChanged)) ev.preventDefault();
  }}
  onfocusin={() => {
    // TODO: this works but looks like nonsense
    if ($uiFocus != 'EditingField')
      $uiFocus = 'Other';
  }}/>

{#if $isLoading}
<!-- loading locales -->
{:else}

<!-- dialogs -->
<DialogOutlet />

<Banner style='error' bind:open={errorBanner.open}
  text={$_('msg.errorbanner')}
  buttons={[
    { name: 'open', localizedName: () => $_('msg.errorbanner-open') },
    { name: 'more', localizedName: () => $_('msg.errorbanner-more') },
    { name: 'close', localizedName: () => $_('dismiss') }
  ]}
  onSubmit={async (x) => {
    if (x == 'open') await MAPI.openDevtools();
    if (x == 'more') openDialog(Dialog.bugs);
  }}/>

<Banner style='error' bind:open={versionBanner.open}
  text={$_('msg.versionbanner')}/>

<main class="vlayout container fixminheight">
  <!-- toolbar -->
  <header>
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
        disabled={!Source.canUndo()}>{$_('menu.undo')}</button></li>
      <li><button
        onclick={() => SourceCommands.redo.call()}
        disabled={!Source.canRedo()}>{$_('menu.redo')}</button></li>
      {/key}
      <li class='separator'></li>
      <li><button onclick={() => InterfaceCommands.openVideo.call()}>
        <FilmIcon />&nbsp;{$_('menu.open-video')}
      </button></li>
      <li><button disabled={$loadState !== 'loaded'} 
          onclick={() => PlaybackCommands.selectAudioStream.call()}>
        {$_('menu.select-audio-stream')}
      </button></li>
      <li><button disabled={$loadState !== 'loaded'}
          onclick={() => InterfaceCommands.closeVideo.call()}>
        {$_('menu.close-video')}
      </button></li>
      <li class='separator'></li>
      <li class="label">{$filenameDisplay}</li>
      <li>
        <Tooltip text={$_('menu.bug')} position="bottom">
          <button aria-label={$_('menu.bug')}
                  onclick={() => openDialog(Dialog.bugs)}>
            <BugIcon />
          </button>
        </Tooltip>
      </li>
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
  </header>

  <!-- body -->
  <div class='hlayout flexgrow fixminheight'>
    <div bind:this={leftPane} style="width: 300px;" class="fixminheight vlayout isolated">
      <!-- video -->
      <div bind:this={videoCanvasContainer}>
        <Preview />
      </div>
      <!-- resizer -->
      <div>
        <Resizer control={videoCanvasContainer} minValue={100} />
      </div>
      <!-- toolbox -->
      <div class="flexgrow fixminheight">
        <TabView bind:value={$toolboxFocus}>
          <TabPage id='properties'>
            {#snippet header()}{$_('tab.properties')}{/snippet}
            <PropertiesToolbox/>
          </TabPage>
          <TabPage id='untimed'>
            {#snippet header()}{$_('tab.untimed-text')}{/snippet}
            <UntimedToolbox/>
          </TabPage>
          <TabPage id='search'>
            {#snippet header()}{$_('tab.search-replace')}{/snippet}
            <SearchToolbox/>
          </TabPage>
          <TabPage id='references'>
            {#snippet header()}
              <Tooltip position='top' text={$_('msg.experimental')}>
                {$_('tab.references')}<span><TriangleAlertIcon/></span>
              </Tooltip>
            {/snippet}
            <ReferencesToolbox/>
          </TabPage>
          <TabPage id='test'>
            {#snippet header()}Test{/snippet}
            <TestToolbox/>
          </TabPage>
        </TabView>
      </div>
    </div>
    <div style="width: 10px;">
      <Resizer vertical={true} minValue={200} control={leftPane} />
    </div>
    <div class="flexgrow fixminheight vlayout isolated">
      <!-- edit box -->
      <div bind:this={editTable} style="height: 125px; padding-top: 3px">
        <EntryEdit />
      </div>
      <!-- resizer -->
      <div><Resizer control={editTable} minValue={125} /></div>
      <!-- table view -->
      <div class='flexgrow isolated' style="padding-bottom: 6px">
        <SubtitleTable />
      </div>
    </div>
  </div>
  <!-- resizer -->
  <div>
    <Resizer control={timelineCanvasContainer!} reverse={true} />
  </div>
  <!-- timeline -->
  <div bind:this={timelineCanvasContainer}>
    <Timeline />
  </div>

  <!-- status bar -->
  <footer
    class={[{twinkling: statusTwinkling}, $status.type]}
    onanimationend={() => statusTwinkling = false}
  >{$status.msg}</footer>
</main>

{/if}

<style>
@media (prefers-color-scheme: light) {
  footer {
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
  footer, ul.menu {
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
  border-radius: 4px;
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

header {
  margin: 0 0 5px 0;
}

footer {
  text-align: left;
  padding: 5px 7px;
  margin: 5px 0 0 0;
  line-height: normal;
  white-space: nowrap;
  overflow-x: auto;
  border-radius: 4px;
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
</style>