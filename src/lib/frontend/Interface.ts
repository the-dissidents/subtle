console.info('Interface loading');

import { get, readonly, writable } from "svelte/store";

import * as dialog from "@tauri-apps/plugin-dialog";
import * as fs from "@tauri-apps/plugin-fs";
import { Menu } from "@tauri-apps/api/menu";

import { Subtitles } from "../core/Subtitles.svelte";
import { Format } from "../core/Formats";

import { Dialogs } from "./Dialogs";
import { ChangeType, Source } from "./Source";
import { Editing } from "./Editing";
import { parseSubtitleSource, type UIFocus } from "./Frontend";
import { PrivateConfig } from "../config/PrivateConfig";
import { Playback } from "./Playback";
import { DebugConfig, MainConfig } from "../config/Groups";
import { Basic } from "../Basic";

import { unwrapFunctionStore, _ } from 'svelte-i18n';
import { SubtitleUtil } from "../core/SubtitleUtil.svelte";
import { Debug } from "../Debug";
import { MAPI } from "../API";
import { UICommand } from "./CommandBase";
import { CommandBinding, KeybindingManager } from "./Keybinding";

const $_ = unwrapFunctionStore(_);

const IMPORT_FILTERS = () => [
    { name: $_('filter.all-supported-formats'), extensions: ['json', 'srt', 'vtt', 'ssa', 'ass'] },
    { name: $_('filter.srt-subtitles'), extensions: ['srt'] },
    { name: $_('filter.vtt-subtitles'), extensions: ['vtt'] },
    { name: $_('filter.ssa-subtitles'), extensions: ['ssa', 'ass'] },
    { name: $_('filter.subtle-archive'), extensions: ['json'] }];

export async function guardAsync(x: () => Promise<void>, msg: string): Promise<void>;
export async function guardAsync<T>(x: () => Promise<T>, msg: string, fallback: T): Promise<T>;

export async function guardAsync<T>(x: () => Promise<T>, msg: string, fallback?: T) {
    if (DebugConfig.data.disableTry) {
        return await x();
    } else {
        try {
            return await x();
        } catch (x) {
            Interface.setStatus(`${msg}: ${x}`, 'error');
            Debug.info('guardAsync:', msg, x);
            return fallback;
        };
    }
}

type EnforceNotPromise<T extends () => any> = ReturnType<T> extends Promise<any> ? never : T;

export function guard<T extends () => void>(x: EnforceNotPromise<T>, msg: string): void;
export function guard<T extends () => any>(
    x: EnforceNotPromise<T>, msg: string, fallback: ReturnType<T>): ReturnType<T>;

export function guard<T>(x: () => T, msg: string, fallback?: T) {
    if (DebugConfig.data.disableTry) {
        return x();
    } else {
        try {
            return x();
        } catch (x) {
            Interface.setStatus(`${msg}: ${x}`, 'error');
            Debug.info('guard:', msg, x);
            return fallback;
        };
    }
}

export type StatusType = 'info' | 'error';
export type ToolboxPage = 'properties' | 'search' | 'untimed' | 'test' | undefined;

const status = writable({ msg: 'ok', type: 'info' as StatusType });

export const Interface = {
    uiFocus: writable<UIFocus>('Other'),
    // FIXME: this immediately gets overwritten by App.svelte
    toolboxFocus: writable<ToolboxPage>(),

    get status() {
        return readonly(status);
    },

    setStatus(msg: string, type: StatusType = 'info') {
        Debug.debug('status ->', msg, type);
        status.set({ msg, type });
    },

    getUIFocus(): UIFocus {
        return get(this.uiFocus);
    },

    async readTextFile(path: string) {
        try {
            const stats = await fs.stat(path);
            if (!stats.isFile) {
                Interface.setStatus($_('msg.not-a-file', {values: {path}}), 'error');
                return;
            }
            if (stats.size > 1024*1024*5 && !await dialog.ask(
                $_('msg.very-large-file-warning'), {kind: 'warning'})) return null;
        } catch {
            Interface.setStatus($_('msg.does-not-exist', {values: {path}}), 'error');
            return;
        }
        return guardAsync(async () => {
            const file = await fs.readFile(path);
            const decode = await MAPI.detectOrDecodeFile(path);
            if (decode !== null)
                return await MAPI.decodeFile(path, null);
            else {
                const result = (await import('chardet')).analyse(file);
                const out = await Dialogs.encoding.showModal!({path, source: file, result});
                if (!out) return null;
                return out.decoded;
            }
        }, $_('msg.unable-to-read-file-path', {values: {path}}), null);
    },

    async newFile() {
        await Source.openDocument(new Subtitles());
        if (get(Playback.isLoaded)) await Playback.close();
        Interface.setStatus($_('msg.created-new-file'));
    },

    async openFile(path: string) {
        await Debug.debug('parsing file', path);
        const text = await this.readTextFile(path);
        if (!text) return;
        let newSubs = parseSubtitleSource(text);
        if (!newSubs) {
            Interface.setStatus(
                $_('msg.failed-to-parse-as-subtitles-path', {values: {path}}), 'error');
            return;
        }
        await Debug.debug('opening document');
        await Source.openDocument(newSubs, path);
        if (newSubs.migrated == 'olderVersion') 
            await dialog.message(
                $_('msg.note-file-is-migrated-path', {values: {path}}));
        if (newSubs.migrated == 'newerVersion') 
            await dialog.message(
                $_('msg.note-file-is-from-newer-version-path', {values: {path}}));
        const data = PrivateConfig.getFileData(path);
        if (data?.video) {
            await this.openVideo(data.video, data.audioStream);
        } else if (get(Playback.isLoaded))
            await Playback.close();
        Interface.setStatus($_('msg.opened-path', {values: {path}}));
    },

    async openVideo(path: string, audio?: number) {
        if (get(Playback.isLoaded))
            await Playback.close();
        await guardAsync(() => Playback.load(path, audio ?? -1), 
            $_('msg.error-opening-video-path', {values: {path}}));
        if (!get(Playback.isLoaded)) return;
        
        let source = get(Source.currentFile);
        if (source != '')
            await this.saveFileData();
    },

    async warnIfNotSaved() {
        return !get(Source.fileChanged) || await dialog.confirm($_('msg.proceed-without-saving'));
    },

    async openFileMenu() {
        const paths = PrivateConfig.get('paths');
        let openMenu = await Menu.new({ items: [
            {
                text: $_('cxtmenu.other-file'),
                async action(_) {
                        if (await Interface.warnIfNotSaved())
                        Interface.askOpenFile();
                },
            },
            { item: 'Separator' },
            ...(paths.length == 0 ? [
                    {
                        text: $_('cxtmenu.no-recent-files'),
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
    },

    async askImportFile() {
        const selected = await dialog.open({multiple: false, filters: IMPORT_FILTERS()});
        if (typeof selected != 'string') return;
        const text = await this.readTextFile(selected);
        if (!text) return;
        let newSubs = parseSubtitleSource(text);
        if (!newSubs) {
            Interface.setStatus(
                $_('msg.failed-to-parse-as-subtitles-path', {values: {path: selected}}), 'error');
            return;
        }
        const options = await Dialogs.importOptions.showModal!(newSubs.migrated != 'text');
        if (!options) return;

        let entries = SubtitleUtil.merge(Source.subs, newSubs, options);
        if (entries.length > 0) {
            Editing.setSelection(entries);
        }
        Source.markChanged(ChangeType.General);
        Source.markChanged(ChangeType.StyleDefinitions);
        Interface.setStatus($_('msg.imported'));
    },

    async askExportFile(ext: string, func: (s: Subtitles) => string) {
        const selected = await dialog.save({
            filters: [{name: $_('filter.subtitle-file'), extensions: [ext]}]});
        if (typeof selected != 'string') return;
        await Source.exportTo(selected, func(Source.subs));
    },
  
    async askOpenFile() {
        const path = await dialog.open({multiple: false, filters: IMPORT_FILTERS()});
        if (typeof path != 'string') return;
        await this.openFile(path);
        Source.startAutoSave();
    },

    async askOpenVideo() {
        const selected = await dialog.open({multiple: false, 
            filters: [{name: $_('filter.video-file'), extensions: ['avi', 'mp4', 'webm', 'mkv']}]});
        if (typeof selected != 'string') return;
        await this.openVideo(selected);
    },
  
    async askSaveFile(saveAs = false) {
        let file = get(Source.currentFile);
        if (file == '' || saveAs || Source.subs.migrated != 'none') {
            const selected = await dialog.save({
                filters: [{name: $_('filter.subtle-archive'), extensions: ['json']}],
                defaultPath: file ?? undefined
            });
            if (typeof selected != 'string') return;
            file = selected;
        }
        const text = Format.JSON.write(Source.subs);
        if (await Source.saveTo(file, text)) {
            await this.saveFileData();
            Source.subs.migrated = 'none';
        }
        Source.startAutoSave();
    },

    async savePublicConfig() {
        await guardAsync(() => MainConfig.save(), $_('msg.error-saving-public-config'));
    },

    async closeVideo() {
        let file = get(Source.currentFile);
        await Playback.close();
        await PrivateConfig.setFileData(file, undefined);
    },

    async saveFileData() {
        const file = get(Source.currentFile);
        Debug.assert(file !== '');
        await PrivateConfig.setFileData(file, {
            video: Playback.player?.source,
            audioStream: Playback.player?.currentAudioStream
        });
    }
}

export const InterfaceCommands = {
    newFile: new UICommand(() => $_('category.document'),
        [ CommandBinding.from(['CmdOrCtrl+N']) ],
    {
        name: () => $_('menu.new-file'),
        call: async () => { 
            if (await Interface.warnIfNotSaved())
                Interface.newFile();
        }
    }),
    openMenu: new UICommand(() => $_('category.document'),
        [ CommandBinding.from(['CmdOrCtrl+O']), ],
    {
        name: () => $_('menu.open'),
        items: () => {
            const paths = PrivateConfig.get('paths');
            return [
                {
                    name: () => $_('cxtmenu.other-file'),
                    isDialog: true,
                    async call() {
                        if (await Interface.warnIfNotSaved())
                            Interface.askOpenFile();
                    },
                },
                ...(paths.length == 0 ? [
                    {
                        name: $_('cxtmenu.no-recent-files'),
                        isApplicable: () => false,
                        call() {}
                    }
                    ] : paths.map((x) => ({
                        name: '[...]/' + x.name.split(Basic.pathSeparator)
                            .slice(-2).join(Basic.pathSeparator),
                        async call() {
                            if (await Interface.warnIfNotSaved())
                                Interface.openFile(x.name);
                        }
                    }))
                ),
            ]
        }
    }),
    openVideo: new UICommand(() => $_('category.document'),
        [ CommandBinding.from(['CmdOrCtrl+Shift+O']), ],
    {
        name: () => $_('menu.open-video'),
        isDialog: true,
        call: () => Interface.askOpenVideo()
    }),
    closeVideo: new UICommand(() => $_('category.document'),
        [ ],
    {
        name: () => $_('menu.close-video'),
        isApplicable: () => get(Playback.isLoaded),
        call: () => Playback.close()
    }),
    import: new UICommand(() => $_('category.document'),
        [ CommandBinding.from(['CmdOrCtrl+I']), ],
    {
        name: () => $_('menu.import'),
        isDialog: true,
        call: () => Interface.askImportFile()
    }),
    exportASS: new UICommand(() => $_('category.document'),
        [ ],
    {
        name: () => $_('menu.export-ass'),
        isDialog: true,
        call: () => Interface.askExportFile('ass', (x) => Format.ASS.write(x))
    }),
    exportSRTPlaintext: new UICommand(() => $_('category.document'),
        [ ],
    {
        name: () => $_('menu.export-srt-plaintext'),
        isDialog: true,
        call: async () => {
            const result = await Dialogs.export.showModal!();
            if (!result) return;
            Interface.askExportFile(result.ext, () => result.content);
        }
    }),
    exportMenu: new UICommand(() => $_('category.document'),
        [ ],
    {
        name: () => $_('menu.export'),
        items: [
            {
                name: () => 'ASS',
                call: () => { InterfaceCommands.exportASS.call(); }
            },
            {
                name: () => $_('cxtmenu.srt-plaintext'),
                call: () => { InterfaceCommands.exportSRTPlaintext.call() }
            }
        ]
    }),
    save: new UICommand(() => $_('category.document'),
        [ CommandBinding.from(['CmdOrCtrl+S']), ],
    {
        name: () => $_('action.save'),
        call: () => Interface.askSaveFile()
    }),
    saveAs: new UICommand(() => $_('category.document'),
        [ CommandBinding.from(['CmdOrCtrl+Shift+S']), ],
    {
        name: () => $_('menu.save-as'),
        isDialog: true,
        call: () => Interface.askSaveFile(true)
    }),
}
KeybindingManager.register(InterfaceCommands);