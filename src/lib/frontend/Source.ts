console.info('Source loading');

import { get, readonly, writable } from "svelte/store";
import { Subtitles } from "../core/Subtitles.svelte";
import { Format } from "../core/Formats";

import * as fs from "@tauri-apps/plugin-fs";
import { basename } from '@tauri-apps/api/path';
import { guardAsync, Interface } from "./Interface";
import { PrivateConfig } from "../config/PrivateConfig";
import { InterfaceConfig } from "../config/Groups";
import { Editing } from "./Editing";
import { EventHost } from "./Frontend";

import { unwrapFunctionStore, _ } from 'svelte-i18n';
import { Debug } from "../Debug";

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
    StyleDefinitions,
    General,   // TODO: this is unclear
    Metadata
}

function readSnapshot(s: Snapshot) {
    // this.clearSelection();
    // this.focused.style = null;
    Source.subs = Format.JSON.parse(s.archive)!;
    fileChanged.set(!s.saved);
    Source.onSubtitleObjectReload.dispatch();
    Source.onSubtitlesChanged.dispatch(s.change);
}

let intervalId = 0;
let changedSinceLastAutosave = false;
let currentFile = writable('');
let fileChanged = writable(false);

export const Source = {
    subs: new Subtitles(),
    undoStack: [] as Snapshot[],
    redoStack: [] as Snapshot[],

    get currentFile() { return readonly(currentFile); },
    get fileChanged() { return readonly(fileChanged); },

    onUndoBufferChanged: new EventHost(),
    onSubtitlesChanged: new EventHost<[type: ChangeType]>(),
    onSubtitleObjectReload: new EventHost(),

    init() {
        this.markChanged(ChangeType.General);
        fileChanged.set(false);
    },

    markChanged(type: ChangeType) {
        fileChanged.set(true);
        changedSinceLastAutosave = true;

        Editing.editChanged = false;
        Editing.isEditingVirtualEntry.set(false);
        this.undoStack.push({
            archive: Format.JSON.write(this.subs), 
            change: type,
            saved: false}); // TODO
        this.redoStack = [];
        this.onUndoBufferChanged.dispatch();
        this.onSubtitlesChanged.dispatch(type);
    },

    clearUndoRedo() {
        this.undoStack = [];
        this.redoStack = [];
        this.markChanged(ChangeType.General);
        this.onUndoBufferChanged.dispatch();
    },

    canUndo() {return this.undoStack.length > 1;},
    canRedo() {return this.redoStack.length > 0;},

    undo() {
        if (!this.canUndo()) return false;
        this.redoStack.push(this.undoStack.pop()!);
        let snap = this.undoStack.at(-1)!;
        readSnapshot(snap);
        this.onUndoBufferChanged.dispatch();
        return true;
    },

    redo() {
        if (!this.canRedo()) return false;
        this.undoStack.push(this.redoStack.pop()!);
        let snap = this.undoStack.at(-1)!;
        readSnapshot(snap);
        this.onUndoBufferChanged.dispatch();
        return true;
    },

    async openDocument(newSubs: Subtitles, path: string) {
        PrivateConfig.pushRecent(path);
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
            Interface.status.set($_('msg.exported-to-file', {values: {file}}));
            return true;
        }, $_('msg.error-when-writing-to-file', {values: {file}}), false);
    },

    async saveTo(file: string, text: string) {
        return guardAsync(async () => {
            await fs.writeTextFile(file, text);
            Interface.status.set($_('msg.saved-to-file', {values: {file}}));
            fileChanged.set(false);
            changedSinceLastAutosave = false;
            if (file != get(this.currentFile)) {
                PrivateConfig.pushRecent(file);
                currentFile.set(file);
            }
            return true;
        }, $_('msg.error-when-writing-to-file', {values: {file}}), false);
    },

    async doAutoSave() {
        function getCurrentTimestampForFilename(): string {
            const now = new Date();

            const year = now.getFullYear();
            const month = String(now.getMonth() + 1).padStart(2, '0'); // 月份从 0 开始
            const day = String(now.getDate()).padStart(2, '0');

            const hours = String(now.getHours()).padStart(2, '0');
            const minutes = String(now.getMinutes()).padStart(2, '0');
            const seconds = String(now.getSeconds()).padStart(2, '0');

            // 格式：YYYYMMDD_HHMMSS
            return `${year}${month}${day}_${hours}${minutes}${seconds}`;
        }
        if (!changedSinceLastAutosave) {
            Debug.info('no change since last autosave');
            return;
        }; // only autosave when changed

        await guardAsync( async ()=> {
            const currentFile = get(this.currentFile);
            const autoSaveName =
                (currentFile == '' ? 'untitled' : await basename(currentFile, '.json'))
                + '_' + getCurrentTimestampForFilename() + '.json';
            const text = Format.JSON.write(this.subs);
            await fs.writeTextFile(autoSaveName, text, { baseDir: fs.BaseDirectory.AppLocalData });
            changedSinceLastAutosave = false;
            Debug.info('autosaved', currentFile ?? '<untitled>');
            Interface.status.set($_('msg.autosave-complete', {values: {time: new Date().toLocaleTimeString(),}}));
        }, $_('msg.autosave-failed'));
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
            await Source.doAutoSave();
        }, InterfaceConfig.data.autosaveInterval * 1000 * 60);
    }
}