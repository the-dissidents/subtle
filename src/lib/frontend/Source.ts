import { get, writable } from "svelte/store";
import { Subtitles, SubtitleTools } from "../core/Subtitles.svelte";

import * as fs from "@tauri-apps/plugin-fs";
import { Interface } from "./Interface";
import { Config } from "../Config";
import { Editing } from "./Editing";
import { EventHost } from "./Frontend";

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
    Source.onSubtitlesChanged.dispatch(s.change, ChangeCause.Action);
}

export const Source = {
    subs: SubtitleTools.makeTestSubtitles(),
    undoStack: [] as Snapshot[],
    redoStack: [] as Snapshot[],

    currentFile: writable(''),
    fileChanged: writable(false),

    onUndoBufferChanged: new EventHost(),
    onSubtitlesChanged: new EventHost<[type: ChangeType, cause: ChangeCause]>(),
    onSubtitleObjectReload: new EventHost(),

    markChanged(type: ChangeType, cause: ChangeCause) {
        this.fileChanged.set(true);
        Editing.editChanged = false;
        Editing.isEditingVirtualEntry.set(false);
        this.undoStack.push({
            archive: JSON.stringify(this.subs.toSerializable()), 
            change: type,
            saved: !get(this.fileChanged)});
        this.redoStack = [];
        this.onUndoBufferChanged.dispatch();
        this.onSubtitlesChanged.dispatch(type, cause);
    },

    clearUndoRedo() {
        this.undoStack = [];
        this.redoStack = [];
        this.markChanged(ChangeType.General, ChangeCause.Action);
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
        Config.pushRecent(path);
        this.subs = newSubs;
        Editing.clearFocus(false);
        Editing.clearSelection();
        Editing.focused.style = newSubs.defaultStyle;
        this.currentFile.set(isImport ? '' : path);

        Interface.status.set('opened: ' + path);
        this.onSubtitleObjectReload.dispatch();
        this.clearUndoRedo();
        this.fileChanged.set(false);
        this.onSubtitlesChanged.dispatch(ChangeType.General, ChangeCause.Action);
        this.onSubtitlesChanged.dispatch(ChangeType.StyleDefinitions, ChangeCause.Action);
    },

    async exportTo(file: string, text: string) {
        try {
            await fs.writeTextFile(file, text);
            Interface.status.set('exported to ' + file);
            return true;
        } catch (error) {
            Interface.status.set(`error when writing to ${file}: ${error}`);
        }
        return false;
    },

    async saveTo(file: string, text: string) {
        try {
            await fs.writeTextFile(file, text);
            Interface.status.set('saved to ' + file);
            this.fileChanged.set(false);
            if (file != get(this.currentFile)) {
                Config.pushRecent(file);
                this.currentFile.set(file);
            }
            return true;
        } catch (error) {
            Interface.status.set(`error when writing to ${file}: ${error}`);
        }
        return false;
    },
}