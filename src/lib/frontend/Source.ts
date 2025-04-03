import {get, writable} from "svelte/store";
import {Subtitles, SubtitleTools} from "../core/Subtitles.svelte";

import * as fs from "@tauri-apps/plugin-fs";
import {BaseDirectory} from "@tauri-apps/plugin-fs";
import {guardAsync, Interface} from "./Interface";
import {PrivateConfig} from "../config/PrivateConfig";
import {Editing} from "./Editing";
import {EventHost} from "./Frontend";
import {basename} from '@tauri-apps/api/path';

import {_, unwrapFunctionStore} from 'svelte-i18n';
import {InterfaceConfig} from "../config/Groups";

console.info('Source loading');

const $_ = unwrapFunctionStore(_);

let intervalId = 1

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
    Source.subs = Subtitles.deserialize(JSON.parse(s.archive));
    Source.fileChanged.set(!s.saved);
    Source.onSubtitleObjectReload.dispatch();
    Source.onSubtitlesChanged.dispatch(s.change);
}

export const Source = {
    subs: SubtitleTools.makeTestSubtitles(),
    undoStack: [] as Snapshot[],
    redoStack: [] as Snapshot[],

    currentFile: writable(''),
    fileChanged: writable(false),

    onUndoBufferChanged: new EventHost(),
    onSubtitlesChanged: new EventHost<[type: ChangeType]>(),
    onSubtitleObjectReload: new EventHost(),

    markChanged(type: ChangeType) {
        this.fileChanged.set(true);
        Editing.editChanged = false;
        Editing.isEditingVirtualEntry.set(false);
        this.undoStack.push({
            archive: JSON.stringify(this.subs.toSerializable()), 
            change: type,
            saved: !get(this.fileChanged)});
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

    async openDocument(newSubs: Subtitles, path: string, isImport: boolean) {
        PrivateConfig.pushRecent(path);
        this.subs = newSubs;
        Editing.clearFocus(false);
        Editing.clearSelection();
        Editing.focused.style = newSubs.defaultStyle;
        this.currentFile.set(isImport ? '' : path);
        this.onSubtitleObjectReload.dispatch();
        this.clearUndoRedo();
        this.fileChanged.set(false);
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
            this.fileChanged.set(false);
            if (file != get(this.currentFile)) {
                PrivateConfig.pushRecent(file);
                this.currentFile.set(file);
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
        await guardAsync( async ()=> {
            const currentFile = get(this.currentFile);
            const autoSaveName =
                (currentFile == '' ? 'untitled' : await basename(currentFile, '.json'))
                + '_' + getCurrentTimestampForFilename() + '.json';
            const text = JSON.stringify(Source.subs.toSerializable());
            await fs.writeTextFile(autoSaveName, text, { baseDir: BaseDirectory.AppLocalData });
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