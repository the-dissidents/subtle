import { clipboard, dialog, fs, tauri } from "@tauri-apps/api";
import { assert } from "./Basic";
import { SubtitleEntry, SubtitleStyle, SubtitleTools, Subtitles, type SubtitleChannel, SubtitleUtil, SubtitleImport, SubtitleExport, MergePosition, MergeStyleBehavior, type MergeOptions } from "./Subtitles";
import type ImportOptionsDialog from "./ImportOptionsDialog.svelte";
import { showMenu } from "tauri-plugin-context-menu";
import type TimeTransformDialog from "./TimeTransformDialog.svelte";
import type SearchDialog from "./SearchDialog.svelte";
import { Playback } from "./Playback";
import { UIHelper } from "./UICommands";
import { Config } from "./Config";
import type CombineDialog from "./CombineDialog.svelte";
import type SplitLanguagesDialog from "./SplitLanguagesDialog.svelte";

type Snapshot = {
    archive: string,
    change: ChangeType,
    saved: boolean
}

type SelectionState = {
    submitted: Set<SubtitleEntry>,
    currentGroup: SubtitleEntry[],
    currentStart: SubtitleEntry | null
};

type FocusState = {
    entry: SubtitleEntry | null,
    style: SubtitleStyle | null
}

export enum ChangeCause {
    UIForm,
    UIList,
    Action,
    Timeline
}

export enum ChangeType {
    NonTime,
    Times,
    Styles,
    Both
}

export class EventHost<T extends unknown[] = []> {
    #listeners = new Set<(...args: [...T]) => void>;
    dispatch(...args: [...T]) {
        this.#listeners.forEach((x) => x(...args));
    };
    bind(f: (...args: [...T]) => void) {
        this.#listeners.add(f);
    }
    unbind(f: (...args: [...T]) => void) {
        this.#listeners.delete(f);
    }
}

const IMPORT_FILTERS = [
    { name: 'SRT subtitles', extensions: ['srt'] },
    { name: 'SSA subtitles', extensions: ['ssa', 'ass'] },
    { name: 'subtle archive', extensions: ['json'] }];

export class Frontend {
    subs: Subtitles;
    undoStack: Snapshot[] = [];
    redoStack: Snapshot[] = [];
    timeEpsilon = 0.01;

    ui: {
        editTable?: HTMLElement;
        tableHeader?: HTMLElement;
        subscontainer?: HTMLElement;
    } = {};

    modalDialogs: {
        importOpt?: ImportOptionsDialog;
        timeTrans?: TimeTransformDialog;
        combine?: CombineDialog;
        splitLanguages?: SplitLanguagesDialog;
    } = {};

    dialogs: {
        search?: SearchDialog;
    } = {};

    states = {
        isEditing: false,
        isEditingVirtualEntry: false,
        modalOpenCounter: 0,
        virtualEntryHighlighted: false,
        editChanged: false,
    };

    selection: SelectionState = {
        submitted: new Set(),
        currentGroup: [],
        currentStart: null
    };
    current: FocusState = {
        entry: null,
        style: null
    };

    currentFile = '';
    fileChanged = false;

    #status = 'ok';
    get status() {return this.#status;}
    set status(x: string) {
        this.#status = x;
        this.onStatusChanged.dispatch();
    }

    onUndoBufferChanged = new EventHost();
    onStatusChanged = new EventHost();
    onSubtitlesChanged = new EventHost<[type: ChangeType, cause: ChangeCause]>();
    onSubtitleObjectReload = new EventHost();
    onSelectionChanged = new EventHost<[cause: ChangeCause]>();

    playback = new Playback(this);
    uiHelper = new UIHelper(this);

    constructor() {
        //this.subs = new Subtitles();
        this.subs = SubtitleTools.makeTestSubtitles();
        this.markChanged(ChangeType.Times, ChangeCause.Action);
        this.fileChanged = false;
    }

    // common utilities

    markChanged(type: ChangeType, cause: ChangeCause) {
        this.fileChanged = true;
        this.states.editChanged = false;
        this.states.isEditingVirtualEntry = false;
        this.undoStack.push({
            archive: JSON.stringify(this.subs.toSerializable()), 
            change: type,
            saved: !this.fileChanged});
        this.redoStack = [];
        this.onUndoBufferChanged.dispatch();
        this.onSubtitlesChanged.dispatch(type, cause);
    }

    canUndo() {return this.undoStack.length > 1;}
    canRedo() {return this.redoStack.length > 0;}
    getSelection() {
        return this.subs.entries.filter(
            (x) => this.selection.submitted.has(x) || 
                this.selection.currentGroup.includes(x));
    }

    isSelectionDisjunct() {
        let state = 0;
        for (let i = 0; i < this.subs.entries.length; i++) {
            let ent = this.subs.entries[i];
            if (this.selection.submitted.has(ent) || 
                this.selection.currentGroup.includes(ent))
            {
                if (state == 2) return true;
                else state = 1;
            } else if (state == 1) state = 2;
        }
        return false;
    }

    #readSnapshot(s: Snapshot) {
        this.clearSelection();
        this.current.entry = null;
        this.current.style = null;
        this.subs = Subtitles.deserialize(JSON.parse(s.archive));
        this.fileChanged = !s.saved;
        this.onSubtitleObjectReload.dispatch();
        this.onSubtitlesChanged.dispatch(s.change, ChangeCause.Action);
    }

    undo() {
        if (!this.canUndo()) return false;
        this.redoStack.push(this.undoStack.pop()!);
        let snap = this.undoStack.at(-1)!;
        this.#readSnapshot(snap);
        this.onUndoBufferChanged.dispatch();
        return true;
    }

    redo() {
        if (!this.canRedo()) return false;
        this.undoStack.push(this.redoStack.pop()!);
        let snap = this.undoStack.at(-1)!;
        this.#readSnapshot(snap);
        this.onUndoBufferChanged.dispatch();
        return true;
    }

    // document management

    // ADV_TODO: warn if not saved

    async askImportFile() {
        assert(this.modalDialogs.importOpt !== undefined);
        const selected = await dialog.open({multiple: false, filters: IMPORT_FILTERS});
        if (typeof selected != 'string') return;
        const text = await fs.readTextFile(selected);
        let newSubs = this.retrieveFromSource(text);
        if (!newSubs) {
            this.#status = `import failed for ${selected}`;
            return;
        }
        let off = this.modalDialogs.importOpt.$on('submit', (ev) => {
            assert(newSubs !== null);
            this.#mergeSubtitles(newSubs, ev.detail);
            off();
        });
        this.modalDialogs.importOpt.$set({show: true});
    }
  
    async askOpenFile() {
        const selected = await dialog.open({multiple: false, filters: IMPORT_FILTERS});
        if (typeof selected != 'string') return;
        await this.openDocument(selected);
    }

    async askOpenVideo() {
        const selected = await dialog.open({multiple: false, 
        filters: [{name: 'video file', extensions: ['avi', 'mp4', 'webm', 'mkv']}]});
        if (typeof selected != 'string') return;
        await this.openVideo(selected);
    }
  
    async askSaveFile(saveAs = false) {
        let file = this.currentFile;
        if (file == '' || saveAs) {
            const selected = await dialog.save({
                filters: [{name: 'subtle archive', extensions: ['json']}]});
            if (typeof selected != 'string') return;
            file = selected;
        }
        const text = JSON.stringify(this.subs.toSerializable());
        if (await this.saveTo(file, text)) {
        }
    }

    async askExportFile() {
        let ask = async (ext: string, func: (s: Subtitles) => string) => {
            const selected = await dialog.save({
                filters: [{name: 'subtitle file', extensions: [ext]}]});
            if (typeof selected != 'string') return;
            await this.saveTo(selected, func(this.subs), true);
        }
        showMenu({items: [
            {
                label: 'SRT',
                event: () => ask('srt', SubtitleExport.SRT)
            },
            {
                label: 'ASS',
                event: () => ask('ass', SubtitleExport.ASS)
            },
            {
                label: 'plain text',
                event: () => ask('txt', SubtitleExport.plaintext)
            }
        ]})
    }

    async openDocument(path: string) {
        let newSubs: Subtitles | null;
        try {
            const text = await fs.readTextFile(path);
            newSubs = this.retrieveFromSource(text);
            if (!newSubs)
                throw 'file is unparsable';
        } catch {
            this.status = `error when reading ${path}`;
            return;
        }

        const video = Config.getVideo(path);
        Config.pushRecent(path);

        this.subs = newSubs;
        this.current.entry = null;
        this.current.style = newSubs.defaultStyle;
        this.currentFile = path;
        this.fileChanged = false;
        this.status = 'opened: ' + path;
        this.onSubtitleObjectReload.dispatch();
        this.markChanged(ChangeType.Both, ChangeCause.Action);
        if (video) await this.openVideo(video);
    }

    async openVideo(file: string) {
        const path = tauri.convertFileSrc(file);
        await this.playback.load(path).catch((x) => this.#status = x).catch((x) => 
            this.status = 'error opening video: ' + x);
        if (this.currentFile != '')
            Config.rememberVideo(this.currentFile, file);
    }

    async saveTo(file: string, text: string, isExport = false) {
        try {
            await fs.writeTextFile(file, text);
            if (isExport) {
                this.status = 'exported to ' + file;
            } else {
                this.status = 'saved to ' + file;
                this.fileChanged = false;
                if (file != this.currentFile) {
                    Config.pushRecent(file);
                    if (this.playback.video?.source)
                        Config.rememberVideo(file, this.playback.video.source);
                    this.currentFile = file;
                }
            }
            return true;
        } catch (error) {
            this.status = `error when writing to ${file}: ${error}`;
        }
        return false;
    }

    retrieveFromSource(source: string) {
        let newSub = SubtitleImport.JSON(source);
        if (newSub) return newSub;
        source = SubtitleUtil.normalizeNewlines(source);
        newSub = SubtitleImport.SRT(source);
        if (newSub) return newSub;
        newSub = SubtitleImport.ASSFragment(source);
        return newSub;
    }

    // UI actions

    focusOnCurrentEntry() {
        if (!this.current.entry) return;
        let focused = this.current.entry;
        let channel = focused.texts.find((x) => x.style == this.current.style);
        if (!channel) channel = focused!.texts[0];
        this.current.style = channel.style;
        if (!channel.gui) return;
        this.status = 'focused on ' + channel.style.name + ' of ' + channel.text;
        channel.gui.focus();
        channel.gui.scrollIntoView();
    }

    keepEntryInView(ent: SubtitleEntry) {
        if (!ent.gui) return;
        if (!this.ui.subscontainer) return;
        if (!this.ui.tableHeader) return;
        ent.gui.scrollIntoView({ block: "nearest" });
        let top = this.ui.subscontainer.scrollTop + this.ui.tableHeader.offsetHeight;
        if (ent.gui.offsetTop < top) this.ui.subscontainer.scroll(
            0, ent.gui.offsetTop - this.ui.tableHeader.offsetHeight);
    }

    #mergeSubtitles(other: Subtitles, options: MergeOptions) {
        this.subs.merge(other, options);
        for (let ent of other.entries)
            this.selection.submitted.add(ent);
        this.markChanged(ChangeType.Both, ChangeCause.Action);
    }

    insertEntryBefore(ent?: SubtitleEntry) {
        let index = ent ? this.subs.entries.indexOf(ent) : 0;
        if (index < 0) return;
        let start: number, end: number;
        let pos = this.playback.isLoaded ? this.playback.position : Infinity;
        if (this.subs.entries.length == 0) {
            start = 0;
            end = 2;
        } else if (index == 0) {
            let first = this.subs.entries[0];
            start = Math.max(Math.min(pos, first.start - 2), 0);
            end = Math.min(start + 2, first.start);
        } else {
            assert(ent !== undefined);
            let last = this.subs.entries[index - 1];
            if (last.end <= ent.start) {
                start = Math.max(Math.min(pos, ent.start - 2), last.end);
                end = Math.min(start + 2, ent.start);
            } else {
                start = Math.max(Math.min(pos, ent.start - 2), 0);
                end = Math.min(start + 2, ent.start);
            }
        }
        let entry = ent 
            ? new SubtitleEntry(start, end, 
                ...ent.texts.map((x) => ({style: x.style, text: ''}))) 
            : new SubtitleEntry(start, end, {style: this.subs.defaultStyle, text: ''});
        this.subs.entries.splice(index, 0, entry);
        this.markChanged(ChangeType.Times, ChangeCause.Action);
        setTimeout(() => this.selectEntry(entry), 0);
        return entry;
    }

    insertEntryAfter(ent?: SubtitleEntry) {
        let index = ent ? this.subs.entries.indexOf(ent) + 1 : this.subs.entries.length;
        if (index < 0) return;
        let start: number, end: number;
        let pos = this.playback.isLoaded ? this.playback.position : Infinity;
        if (index == this.subs.entries.length) {
            let last = this.subs.entries.at(-1);
            start = Math.max(pos, last?.end ?? 0);
            end = start + 2;
        } else {
            assert(ent !== undefined);
            let next = this.subs.entries[index];
            if (next.start >= ent.end) {
                start = Math.max(Math.min(next.start, pos), ent.end);
                end = Math.min(start + 2, next.start);
            } else {
                start = ent.end;
                end = start + 2;
            }
        }
        let entry = ent 
            ? new SubtitleEntry(start, end, 
                ...ent.texts.map((x) => ({style: x.style, text: ''}))) 
            : new SubtitleEntry(start, end, {style: this.subs.defaultStyle, text: ''});
        this.subs.entries.splice(index, 0, entry);
        this.markChanged(ChangeType.Times, ChangeCause.Action);
        setTimeout(() => this.selectEntry(entry), 0);
        return entry;
    }

    startEditingNewVirtualEntry() {
        this.#status = 'new entry appended';
        let last = this.subs.entries.at(-1);
        let entry = last 
            ? new SubtitleEntry(last.end, last.end + 2, 
                ...last.texts.map((x) => ({style: x.style, text: ''}))) 
            : new SubtitleEntry(0, 2, {style: this.subs.defaultStyle, text: ''});
        this.subs.entries.push(entry);
        this.markChanged(ChangeType.Times, ChangeCause.Action);

        // focus on the new entry
        this.clearSelection();
        this.selectEntry(entry);
        this.current.style = entry.texts[0].style;
        setTimeout(() => {
            this.keepEntryInView(entry);
            this.focusOnCurrentEntry();
        }, 0);
        this.states.isEditingVirtualEntry = true;
        this.states.virtualEntryHighlighted = false;
    }

    insertChannelAt(index: number) {
        assert(this.current.entry !== null);
        let focused = this.current.entry;
        let newChannel: SubtitleChannel = {style: focused.texts[index].style, text: ''};
        focused.texts = focused.texts.toSpliced(index + 1, 0, newChannel);
        this.markChanged(ChangeType.NonTime, ChangeCause.Action);
        setTimeout(() => {
            newChannel.gui?.focus();
            newChannel.gui?.scrollIntoView();
        }, 0);
    }

    deleteChannelAt(index: number) {
        assert(this.current.entry !== null);
        let focused = this.current.entry;
        focused.texts = focused.texts.toSpliced(index, 1);
        this.markChanged(ChangeType.NonTime, ChangeCause.Action);
    }

    clearSelection(cause = ChangeCause.UIList) {
        this.selection.submitted.clear();
        this.selection.currentGroup = [];
        this.selection.currentStart = null;
        this.current.entry = null;
        this.onSelectionChanged.dispatch(cause);
    }

    deleteSelection(cause = ChangeCause.UIList) {
        let selection = this.getSelection();
        if (selection.length == 0) return;
        let next = this.subs.entries.at(this.subs.entries.indexOf(selection.at(-1)!) + 1);
        let newEntries = this.subs.entries.filter(
            (x) => !selection.includes(x));
        this.subs.entries = newEntries;
        this.clearSelection();
        if (next) this.selectEntry(next);
        else this.states.virtualEntryHighlighted = true;

        this.markChanged(ChangeType.Times, ChangeCause.Action);
        this.onSelectionChanged.dispatch(cause);
    }

    copySelection(transform = SubtitleExport.JSON) {
        let selection = new Set(
            [...this.selection.currentGroup, ...this.selection.submitted]);
        if (selection.size == 0) return;
        let sorted = this.subs.entries.filter((x) => selection.has(x));
        let temp = new Subtitles(this.subs);
        temp.entries = sorted;
        clipboard.writeText(transform(temp));
        this.status = 'copied';
    }

    async paste() {
        const source = await clipboard.readText();
        if (!source) return;
        let portion = this.retrieveFromSource(source);
        if (!portion) {
            this.status = 'cannot read clipboard data as subtitles';
            return;
        }
        let position: number;
        if (this.selection.submitted.size > 0 || this.selection.currentStart) {
            position = this.subs.entries.findIndex(
                (x) => this.selection.submitted.has(x) || 
                    this.selection.currentGroup.includes(x));
            this.clearSelection();
        } else position = this.subs.entries.length;

        this.#mergeSubtitles(portion, {
            position: MergePosition.Custom,
            customPosition: position,
            style: MergeStyleBehavior.KeepDifferent
        });
        this.status = 'pasted';
    }

    offsetFocus(n: number, sequence = false, multiple = false) {
        if (this.current.entry == null) return;
        let focused = this.current.entry;
        let i = this.subs.entries.indexOf(focused) + n;
        if (i < 0 || i >= this.subs.entries.length) {
            this.status = 'focusOffset out of range'
            return;
        }
        this.selectEntry(this.subs.entries[i], sequence, multiple);
    }

    toggleEntry(ent: SubtitleEntry, 
        sequence = false, multiple = false, cause = ChangeCause.UIList) 
    {
        if (multiple) {
            if (this.current.entry == ent)
                this.current.entry = null;
            if (this.selection.currentGroup.includes(ent)) {
                for (let e of this.selection.currentGroup)
                    this.selection.submitted.add(e);
                this.selection.currentStart = null;
                this.selection.currentGroup = [];
            }
            if (this.selection.submitted.has(ent)) {
                this.selection.submitted.delete(ent);
                this.states.isEditingVirtualEntry = false;
                this.states.virtualEntryHighlighted = false;
                this.#status = 'multiselect removed item';
                this.onSelectionChanged.dispatch(cause);
                return;
            }
        }
        this.selectEntry(ent, sequence, multiple, cause);
    }
  
    selectEntry(ent: SubtitleEntry, 
        sequence = false, multiple = false, cause = ChangeCause.UIList) 
    {
        if (sequence) {
            if (this.selection.currentStart == null) {
                this.selection.currentStart = ent;
                this.selection.currentGroup = [ent];
                // this.#status = 'selection initiated';
            } else {
                let a = this.subs.entries.indexOf(this.selection.currentStart);
                let b = this.subs.entries.indexOf(ent);
                assert(a >= 0 && b >= 0);
                this.selection.currentGroup = 
                    this.subs.entries.slice(Math.min(a, b), Math.max(a, b) + 1);
                // this.#status = 'seqselect updated';
            }
        } else if (multiple) {
            for (let e of this.selection.currentGroup)
                this.selection.submitted.add(e);
            this.selection.currentStart = ent;
            this.selection.currentGroup = [ent];
            // this.#status = 'multiselect added item';
        } else {
            // clear selection
            this.selection.submitted.clear();
            this.selection.currentGroup = [ent];
            this.selection.currentStart = ent;
            // this.#status = 'selection initiated';
        }
        if (this.current.entry != ent) {
            // if (this.states.editChanged)
            //     this.markChanged(false, ChangeCause.UIForm);
            this.states.isEditingVirtualEntry = false;
            this.states.virtualEntryHighlighted = false;
            this.current.entry = ent;
            this.keepEntryInView(ent);
            this.onSelectionChanged.dispatch(cause);
        }
    }
}