console.info('Source loading');

import { Debug } from "../Debug";
import { Subtitles } from "../core/Subtitles.svelte";
import { Format } from "../core/SimpleFormats";
import { InterfaceConfig } from "../config/Groups";
import { Memorized } from "../config/MemorizedValue.svelte";
import { EventHost } from "../details/EventHost";

import { Editing } from "./Editing";
import { Frontend, guardAsync } from "./Frontend";
import { UICommand } from "./CommandBase";
import { CommandBinding, KeybindingManager } from "./Keybinding";

import * as fs from "@tauri-apps/plugin-fs";
import { basename, join } from '@tauri-apps/api/path';
import { get, readonly, writable } from "svelte/store";
import * as z from "zod/v4-mini";

import { unwrapFunctionStore, _ } from 'svelte-i18n';
const $_ = unwrapFunctionStore(_);

export type Snapshot = {
    archive: string,
    change: ChangeType,
    saved: boolean
}

export enum ChangeCause {
    UIForm,
    UIList,
    Action,
    Timeline
}

export enum ChangeType {
    InPlace,
    Times,     // i.e. renderer needs to re-sort
    Order,
    Filter,
    View,
    StyleDefinitions,
    General,   // TODO: this is unclear
    Metadata
}

function readSnapshot(s: Snapshot) {
    // this.clearSelection();
    // this.focused.style = null;
    Source.subs = Format.JSON.parse(s.archive).done();
    fileChanged.set(!s.saved);
    Source.onSubtitleObjectReload.dispatch();
    Source.onSubtitlesChanged.dispatch(s.change);
}

function autosaveTimestamp(now: Date = new Date()): string {
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0'); // 月份从 0 开始
    const day = String(now.getDate()).padStart(2, '0');

    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');

    // 格式：YYYYMMDD_HHMMSS
    return `${year}${month}${day}_${hours}${minutes}${seconds}`;
}

async function doAutoSave() {
    if (!changedSinceLastAutosave) {
        Debug.info('no change since last autosave');
        return;
    }; // only autosave when changed

    await guardAsync(async () => {
        if (!await fs.exists('autosave', { baseDir: fs.BaseDirectory.AppLocalData }))
            await fs.mkdir('autosave', { baseDir: fs.BaseDirectory.AppLocalData });
        const currentFile = get(Source.currentFile);
        const autoSaveName =
            (currentFile == '' ? 'untitled' : await basename(currentFile, '.json'))
            + '_' + autosaveTimestamp() + '.json';
        const text = Format.JSON.write(Source.subs).toString();
        await fs.writeTextFile(
            await join('autosave', autoSaveName), text, 
            { baseDir: fs.BaseDirectory.AppLocalData });
        changedSinceLastAutosave = false;
        Debug.info('autosaved', currentFile ?? '<untitled>');
        Frontend.setStatus($_('msg.autosave-complete', {values: {time: new Date().toLocaleTimeString(),}}));
    }, $_('msg.autosave-failed'));
}

async function cleanAutosave() {
    if (!await fs.exists('autosave', { baseDir: fs.BaseDirectory.AppLocalData }))
        return;

    const maxAge = InterfaceConfig.data.keepAutosaveFor * 1000 * 60 * 60 * 24;
    if (maxAge <= 0) return;
    const regex = /^.+_(\d{8}_\d{6})\.json$/;
    const old = autosaveTimestamp(new Date(Date.now() - maxAge));
    await guardAsync(async () => {
        const entries = await fs.readDir(
            'autosave', { baseDir: fs.BaseDirectory.AppLocalData });
        for (const {name, isFile} of entries) {
            if (!isFile) return;
            const match = regex.exec(name);
            if (match && match[1] < old) {
                await fs.remove(await join('autosave', name), 
                    { baseDir: fs.BaseDirectory.AppLocalData });
                Debug.debug('cleaned autosave:', name);
            }
        }
    }, $_('msg.failed-to-clean-autosave'));
}

const zFileSaveState = z.object({
    name: z.string(), 
    video: z.optional(z.string()),
    audioStream: z.optional(z.int()),
});

let recentOpened = Memorized.$('recentOpened', z.array(zFileSaveState), []);
let intervalId = 0;
let changedSinceLastAutosave = false;
let currentFile = writable('');
let fileChanged = writable(false);

let undoStack = [] as Snapshot[];
let redoStack = [] as Snapshot[];

async function pushRecent(file: string) {
    const got = recentOpened.get();
    const i = got.findIndex((x) => x.name == file);
    if (i >= 0)
        got.unshift(...got.splice(i, 1));
    else
        got.unshift({name: file});
    while (got.length > InterfaceConfig.data.nRecentOpened)
        got.pop();
    await Memorized.save();
}

export const Source = {
    subs: new Subtitles(),

    get currentFile() { return readonly(currentFile); },
    get fileChanged() { return readonly(fileChanged); },
    get recentOpened() { return recentOpened; },

    onUndoBufferChanged: new EventHost(),
    onSubtitlesChanged: new EventHost<[type: ChangeType]>(),
    onSubtitleObjectReload: new EventHost(),

    init() {
        this.markChanged(ChangeType.General);
        fileChanged.set(false);
    },

    markChanged(type: ChangeType) {
        Debug.trace('marking change:', ChangeType[type]);
        fileChanged.set(true);
        changedSinceLastAutosave = true;

        Editing.editChanged = false;
        Editing.isEditingVirtualEntry.set(false);
        undoStack.push({
            archive: Format.JSON.write(this.subs).toString(), 
            change: type,
            saved: false}); // TODO
        redoStack = [];
        this.onUndoBufferChanged.dispatch();
        this.onSubtitlesChanged.dispatch(type);
    },

    clearUndoRedo() {
        redoStack = [];
        redoStack = [];
        this.markChanged(ChangeType.General);
        this.onUndoBufferChanged.dispatch();
    },

    canUndo() { return undoStack.length > 1; },
    canRedo() { return redoStack.length > 0; },

    undo() {
        if (!this.canUndo()) {
            Frontend.setStatus($_('msg.nothing-to-undo'), 'info');
            return false;
        }
        redoStack.push(redoStack.pop()!);
        let snap = redoStack.at(-1)!;
        readSnapshot(snap);
        this.onUndoBufferChanged.dispatch();
        Frontend.setStatus($_('msg.undone'), 'info');
        return true;
    },

    redo() {
        if (!this.canRedo()) {
            Frontend.setStatus($_('msg.nothing-to-redo'), 'info');
            return false;
        }
        redoStack.push(redoStack.pop()!);
        let snap = redoStack.at(-1)!;
        readSnapshot(snap);
        this.onUndoBufferChanged.dispatch();
        Frontend.setStatus($_('msg.redone'), 'info');
        return true;
    },

    async openDocument(newSubs: Subtitles, path: string = '') {
        if (path !== '') pushRecent(path);
        this.subs = newSubs;
        Editing.clearFocus(false);
        Editing.clearSelection();
        this.clearUndoRedo();
        Editing.focused.style = newSubs.defaultStyle;
        currentFile.set(
            (newSubs.migrated !== 'none' 
                && newSubs.migrated !== 'olderVersion') ? '' : path);
        fileChanged.set(newSubs.migrated == 'olderVersion');
        changedSinceLastAutosave = false;

        this.onSubtitleObjectReload.dispatch();
        this.onSubtitlesChanged.dispatch(ChangeType.General);
        this.onSubtitlesChanged.dispatch(ChangeType.StyleDefinitions);
    },

    async exportTo(file: string, text: string) {
        return guardAsync(async () => {
            await fs.writeTextFile(file, text);
            Frontend.setStatus($_('msg.exported-to-file', {values: {file}}));
            return true;
        }, $_('msg.error-when-writing-to-file', {values: {file}}), false);
    },

    async saveTo(file: string, text: string) {
        return guardAsync(async () => {
            await fs.writeTextFile(file, text);
            Frontend.setStatus($_('msg.saved-to-file', {values: {file}}));
            fileChanged.set(false);
            changedSinceLastAutosave = false;
            if (file != get(this.currentFile)) {
                pushRecent(file);
                currentFile.set(file);
            }
            await cleanAutosave();
            return true;
        }, $_('msg.error-when-writing-to-file', {values: {file}}), false);
    },

    startAutoSave() {
        let first = true;
        if (intervalId) {
            clearInterval(intervalId);
        }
        if (InterfaceConfig.data.autosaveInterval <= 0) {
            return; // autosave is disabled
        }
        intervalId = setInterval(async () => {
            if (first) {
                first = false;
                return; // skip the first interval to avoid immediate autosave
            }
            await doAutoSave();
        }, InterfaceConfig.data.autosaveInterval * 1000 * 60);
    }
}

export const SourceCommands = {
    undo: new UICommand(() => $_('category.document'),
        [ CommandBinding.from(['CmdOrCtrl+Z'], ['Table', 'Timeline']),
          CommandBinding.from(['CmdOrCtrl+Alt+Z']) ],
    {
        name: () => $_('menu.undo'),
        isApplicable: () => Source.canUndo(),
        call: () => { Source.undo() }
    }),
    redo: new UICommand(() => $_('category.document'),
        [ CommandBinding.from(['CmdOrCtrl+Shift+Z'], ['Table', 'Timeline']),
          CommandBinding.from(['CmdOrCtrl+Alt+Shift+Z']) ],
    {
        name: () => $_('menu.redo'),
        isApplicable: () => Source.canRedo(),
        call: () => { Source.redo() }
    }),
}
KeybindingManager.register(SourceCommands);