import { assert, Basic } from "./Basic";
import { SubtitleEntry, SubtitleStyle, SubtitleTools, Subtitles, type SubtitleChannel, SubtitleUtil, MergePosition, MergeStyleBehavior, type MergeOptions, type TimeShiftOptions } from "./core/Subtitles.svelte";
import { Playback } from "./Playback";
import { UIHelper } from "./UICommands";
import { Config } from "./Config";
import * as clipboard from "@tauri-apps/plugin-clipboard-manager"
import * as dialog from "@tauri-apps/plugin-dialog"
import * as fs from "@tauri-apps/plugin-fs"
import { Menu } from "@tauri-apps/api/menu";
import type { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { getVersion } from "@tauri-apps/api/app";
import { arch, platform, version } from "@tauri-apps/plugin-os";
import { writable, type Writable, get } from "svelte/store";
import { DialogHandler } from "./DialogBase.svelte";
import { ASS } from "./core/ASS";
import { LinearFormatCombineStrategy, SimpleFormats } from "./core/SimpleFormats";
import chardet, { type AnalyseResult, type EncodingName } from 'chardet';
import * as iconv from 'iconv-lite';

type Snapshot = {
    archive: string,
    change: ChangeType,
    saved: boolean
}

type SelectionState = {
    submitted: Set<SubtitleEntry>,
    currentGroup: SubtitleEntry[],
    focused: SubtitleEntry | null
};

type FocusState = {
    entry: Writable<SubtitleEntry | null | 'virtual'>,
    channel: SubtitleChannel | null,
    control: HTMLTextAreaElement | null,
    // TODO: maybe separate this, it's not really part of the focus, but a kind of current default
    style: SubtitleStyle | null
}

export enum UIFocus {
    Other,
    Table,
    EditingField,
    Timeline
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

export enum SelectMode {
    Single,
    Multiple,
    Sequence
}

export function getSelectMode(ev: MouseEvent | KeyboardEvent) {
    if (ev.shiftKey) return SelectMode.Sequence;
    if (ev.getModifierState(Basic.ctrlKey())) return SelectMode.Multiple;
    return SelectMode.Single;
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
    { name: 'All supported formats', extensions: ['json', 'srt', 'vtt', 'ssa', 'ass'] },
    { name: 'SRT subtitles', extensions: ['srt'] },
    { name: 'VTT subtitles', extensions: ['vtt'] },
    { name: 'SSA subtitles', extensions: ['ssa', 'ass'] },
    { name: 'subtle archive', extensions: ['json'] }];

export class Frontend {
    subs: Subtitles;
    undoStack: Snapshot[] = [];
    redoStack: Snapshot[] = [];
    timeEpsilon = 0.01;

    ui: {
        tableHeader?: HTMLElement;
        subscontainer?: HTMLElement;
    } = {};

    modalDialogs = {
        importOptions: new DialogHandler<void, MergeOptions | null>(),
        timeTransform: new DialogHandler<void, TimeShiftOptions | null>(),
        combine: new DialogHandler<void, void>(),
        encoding: new DialogHandler<
            {source: Uint8Array, result: AnalyseResult}, 
            {decoded: string, encoding: EncodingName} | null>()
    };

    states = {
        isEditingVirtualEntry: writable(false),
        modalOpenCounter: 0,
        editChanged: false,
    };

    selection: SelectionState = {
        submitted: new Set(),
        currentGroup: [],
        focused: null
    };
    
    // TODO: make it more private to prevent direct editing
    focused: FocusState = {
        entry: writable(null),
        channel: null,
        control: null,
        style: null
    };

    uiFocus = writable(UIFocus.Other);
    currentFile = writable('');
    fileChanged = writable(false);
    status = writable('ok');

    onUndoBufferChanged = new EventHost();
    onSubtitlesChanged = new EventHost<[type: ChangeType, cause: ChangeCause]>();
    onSubtitleObjectReload = new EventHost();
    onSelectionChanged = new EventHost<[cause: ChangeCause]>();

    getUIFocus() {
        return get(this.uiFocus);
    }

    getFocusedEntry() {
        return get(this.focused.entry);
    }

    playback = new Playback(this);
    uiHelper = new UIHelper(this);

    entryRows = new WeakMap<SubtitleEntry, HTMLElement>;

    constructor(public readonly window: WebviewWindow) {
        getVersion().then((x) => window.setTitle(`subtle beta ${x} (${platform()}-${version()}/${arch()})`));

        //this.subs = new Subtitles();
        this.subs = SubtitleTools.makeTestSubtitles();
        this.markChanged(ChangeType.Times, ChangeCause.Action);
        this.fileChanged.set(false);
    }

    // common utilities

    markChanged(type: ChangeType, cause: ChangeCause) {
        this.fileChanged.set(true);
        this.states.editChanged = false;
        this.states.isEditingVirtualEntry.set(false);
        this.undoStack.push({
            archive: JSON.stringify(this.subs.toSerializable()), 
            change: type,
            saved: !get(this.fileChanged)});
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
        this.focused.style = null;
        this.subs = Subtitles.deserialize(JSON.parse(s.archive));
        this.fileChanged.set(!s.saved);
        this.onSubtitleObjectReload.dispatch();
        this.onSubtitlesChanged.dispatch(s.change, ChangeCause.Action);
    }

    clearUndoRedo() {
        this.undoStack = [];
        this.redoStack = [];
        this.markChanged(ChangeType.General, ChangeCause.Action);
        this.onUndoBufferChanged.dispatch();
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

    async warnIfNotSaved() {
        return !get(this.fileChanged) || await dialog.confirm('Proceed without saving?');
    }

    async readTextFile(path: string) {
        try {
            const stats = await fs.stat(path);
            if (!stats.isFile) {
                this.status.set(`not a file: ${path}`);
                return;
            }
            if (stats.size > 1024*1024*5 && !await dialog.ask("The file you're opening is very large and likely not a supported subtitle file. Do you really want to proceed? This may crash the application.", {kind: 'warning'})) return null;
        } catch {
            this.status.set(`does not exist: ${path}`);
            return;
        }
        try {
            const file = await fs.readFile(path);
            const result = chardet.analyse(file);
            if (result[0].confidence == 100 && result[0].name == 'UTF-8') {
                return iconv.decode(file, 'UTF-8');
            } else {
                const out = await this.modalDialogs.encoding.showModal!({source: file, result});
                if (!out) return null;
                return out.decoded;
            }
        } catch (e) {
            this.status.set(`unable to read file ${path}: ${e}`);
            return;
        }
    }

    async askImportFile() {
        const selected = await dialog.open({multiple: false, filters: IMPORT_FILTERS});
        if (typeof selected != 'string') return;
        const text = await this.readTextFile(selected);
        if (!text) return;
        let [newSubs, _] = this.retrieveFromSource(text);
        if (!newSubs) {
            this.status.set(`failed to parse as subtitles: ${selected}`);
            return;
        }
        const options = await this.modalDialogs.importOptions.showModal!();
        if (options) {
            this.#mergeSubtitles(newSubs, options);
        }
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
        let file = get(this.currentFile);
        if (file == '' || saveAs) {
            const selected = await dialog.save({
                filters: [{name: 'subtle archive', extensions: ['json']}]});
            if (typeof selected != 'string') return;
            file = selected;
        }
        const text = JSON.stringify(this.subs.toSerializable());
        await this.saveTo(file, text);
    }

    toSRT = (x: Subtitles) => 
        SimpleFormats.export.SRT(x, LinearFormatCombineStrategy.Recombine);
    toPlaintext = (x: Subtitles) => 
        SimpleFormats.export.plaintext(x, LinearFormatCombineStrategy.KeepOrder);

    async askExportFile() {
        let ask = async (ext: string, func: (s: Subtitles) => string) => {
            const selected = await dialog.save({
                filters: [{name: 'subtitle file', extensions: [ext]}]});
            if (typeof selected != 'string') return;
            await this.saveTo(selected, func(this.subs), true);
        }
        let menu = await Menu.new({items: [
            {
                text: 'SRT',
                action: () => ask('srt', (x) => this.toSRT(x))
            },
            {
                text: 'ASS',
                action: () => ask('ass', ASS.export)
            },
            {
                text: 'plain text',
                action: () => ask('txt', (x) => this.toPlaintext(x))
            }
        ]});
        menu.popup();
    }

    async openDocument(path: string) {
        let newSubs: Subtitles | null;
        let isJSON: boolean;
        const text = await this.readTextFile(path);
        if (!text) return;
        [newSubs, isJSON] = this.retrieveFromSource(text);
        if (!newSubs) {
            this.status.set(`failed to parse as subtitles: ${path}`);
            return;
        }

        const video = Config.getVideo(path);
        Config.pushRecent(path);

        this.subs = newSubs;
        this.clearFocus(false);
        this.clearSelection();
        this.focused.style = newSubs.defaultStyle;
        this.currentFile.set(isJSON ? path : '');

        this.status.set('opened: ' + path);
        this.onSubtitleObjectReload.dispatch();
        this.clearUndoRedo();
        this.fileChanged.set(false);
        this.onSubtitlesChanged.dispatch(ChangeType.General, ChangeCause.Action);
        this.onSubtitlesChanged.dispatch(ChangeType.StyleDefinitions, ChangeCause.Action);
        if (video) await this.openVideo(video);
    }

    async openVideo(videoFile: string) {
        try {
            await this.playback.load(videoFile);
        } catch (x) {
            this.status.set(`error opening video '${videoFile}': ${x}`);
        };
        let source = get(this.currentFile);
        if (source != '')
            Config.rememberVideo(source, videoFile);
    }

    async saveTo(file: string, text: string, isExport = false) {
        try {
            await fs.writeTextFile(file, text);
            if (isExport) {
                this.status.set('exported to ' + file);
            } else {
                this.status.set('saved to ' + file);
                this.fileChanged.set(false);
                if (file != get(this.currentFile)) {
                    Config.pushRecent(file);
                    if (this.playback.video?.source)
                        Config.rememberVideo(file, this.playback.video.source);
                    this.currentFile.set(file);
                }
            }
            return true;
        } catch (error) {
            this.status.set(`error when writing to ${file}: ${error}`);
        }
        return false;
    }

    retrieveFromSource(source: string): [Subtitles | null, boolean] {
        let newSub = SimpleFormats.parse.JSON(source);
        if (newSub) return [newSub, true];
        source = SubtitleUtil.normalizeNewlines(source);
        newSub = SimpleFormats.parse.SRT_VTT(source);
        if (newSub) return [newSub, false];
        newSub = ASS.parse(source);
        return [newSub, false];
    }

    // UI actions

    startEditingFocusedEntry() {
        let focused = this.getFocusedEntry();
        assert(focused instanceof SubtitleEntry);
        let channel = focused.texts.find((x) => x.style == this.focused.style);
        if (!channel) {
            channel = focused!.texts[0];
        }
        this.focused.style = channel.style;
        this.focused.channel = channel;
        if (!channel.gui) return;
        // this.status = 'focused on ' + channel.style.name + ' of ' + channel.text;
        channel.gui.focus();
        channel.gui.scrollIntoView();
    }

    keepEntryInView(ent: SubtitleEntry | "virtual") {
        if (!this.ui.subscontainer) return;
        if (!this.ui.tableHeader) return;

        if (ent instanceof SubtitleEntry) {
            const row = this.entryRows.get(ent);
            if (!row) {
                console.warn('?!row', ent);
                return;
            }
            const left = this.ui.subscontainer.scrollLeft;
            row.scrollIntoView({ block: "nearest" });
            this.ui.subscontainer.scrollLeft = left;

            // FIXME: extremely hacky!!
            const headerHeight = this.ui.tableHeader.getBoundingClientRect().height;
            const top = this.ui.subscontainer.scrollTop + headerHeight;
            const zoom = headerHeight / this.ui.tableHeader.clientHeight;
            const rowtop = row.offsetTop * zoom;
            if (rowtop < top)
                this.ui.subscontainer.scrollTop = rowtop - headerHeight;
        } else {
            if (this.subs.entries.length == 0) return;
            this.ui.subscontainer.scroll({top: this.ui.subscontainer.scrollHeight});
        }
    }

    #mergeSubtitles(other: Subtitles, options: MergeOptions) {
        let entries = this.subs.merge(other, options);
        if (entries.length > 0) {
            for (let ent of entries)
                this.selection.submitted.add(ent);
            this.selection.focused = entries[0];
            this.selection.currentGroup = [entries[0]];
            this.onSelectionChanged.dispatch(ChangeCause.Action);
        }
        this.markChanged(ChangeType.General, ChangeCause.Action);
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
        return this.insertEntry(ent, start, end, index);
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
        return this.insertEntry(ent, start, end, index);
    }

    private insertEntry(ent: SubtitleEntry | undefined, start: number, end: number, index: number) {
        let entry = ent
            ? new SubtitleEntry(start, end,
                ...ent.texts.map((x) => ({ style: x.style, text: '' })))
            : new SubtitleEntry(start, end, { style: this.subs.defaultStyle, text: '' });
        this.subs.entries.splice(index, 0, entry);
        this.markChanged(ChangeType.Times, ChangeCause.Action);
        setTimeout(() => this.selectEntry(entry, SelectMode.Single), 0);
        return entry;
    }

    startEditingNewVirtualEntry() {
        this.status.set('new entry appended');
        let last = this.subs.entries.at(-1);
        let entry = last 
            ? new SubtitleEntry(last.end, last.end + 2, 
                ...last.texts.map((x) => ({style: x.style, text: ''}))) 
            : new SubtitleEntry(0, 2, {style: this.subs.defaultStyle, text: ''});
        this.subs.entries.push(entry);
        this.markChanged(ChangeType.Times, ChangeCause.Action);

        // focus on the new entry
        this.clearSelection();
        this.selectEntry(entry, SelectMode.Single);
        this.focused.style = entry.texts[0].style;
        setTimeout(() => {
            this.keepEntryInView(entry);
            this.startEditingFocusedEntry();
        }, 0);
        this.states.isEditingVirtualEntry.set(true);
    }

    insertChannelAt(index: number) {
        let focused = this.getFocusedEntry();
        assert(focused instanceof SubtitleEntry);
        let newChannel: SubtitleChannel = {style: focused.texts[index].style, text: ''};
        focused.texts = focused.texts.toSpliced(index + 1, 0, newChannel);
        // focused.update.dispatch();
        this.markChanged(ChangeType.InPlace, ChangeCause.Action);
        setTimeout(() => {
            // GUI is generated by this time
            newChannel.gui?.focus();
            newChannel.gui?.scrollIntoView();
        }, 0);
    }

    deleteChannelAt(index: number) {
        let focused = this.getFocusedEntry();
        assert(focused instanceof SubtitleEntry);
        let channel = focused.texts[index];
        if (channel == this.focused.channel)
            this.clearFocus(false); // don't try to submit since we're deleting it
        focused.texts = focused.texts.toSpliced(index, 1);
        // focused.update.dispatch();
        this.markChanged(ChangeType.InPlace, ChangeCause.Action);
    }

    submitFocusedEntry() {
        let focused = this.getFocusedEntry();
        assert(focused instanceof SubtitleEntry);
        if (!this.states.editChanged) return;

        let channel = this.focused.channel;
        assert(channel !== null);
        let node = channel.gui;
        assert(node !== undefined);

        channel.text = node.value;
        // focused.update.dispatch();
        this.markChanged(ChangeType.InPlace, ChangeCause.UIForm);
    }

    clearFocus(trySubmit = true) {
        if(this.getFocusedEntry() == null) return;
        if (trySubmit && this.focused.channel !== null)
            this.submitFocusedEntry();
        this.focused.entry.set(null);
        this.focused.channel = null;
    }

    clearSelection(cause = ChangeCause.UIList) {
        this.selection.submitted.clear();
        this.selection.currentGroup = [];
        this.selection.focused = null;
        this.clearFocus();
        this.onSelectionChanged.dispatch(cause);
    }

    deleteSelection(cause = ChangeCause.UIList) {
        let selection = this.getSelection();
        if (selection.length == 0) return;
        let next = this.subs.entries.at(this.subs.entries.indexOf(selection.at(-1)!) + 1);
        let newEntries = 
            this.subs.entries.filter((x) => !selection.includes(x));
        this.subs.entries = newEntries;
        this.clearSelection();
        if (next) this.selectEntry(next, SelectMode.Single);
        else this.selectVirtualEntry();

        this.markChanged(ChangeType.Times, ChangeCause.Action);
        this.onSelectionChanged.dispatch(cause);
    }

    copySelection(transform = SimpleFormats.export.JSON) {
        let selection = new Set(
            [...this.selection.currentGroup, ...this.selection.submitted]);
        if (selection.size == 0) return;
        let sorted = this.subs.entries.filter((x) => selection.has(x));
        let temp = new Subtitles(this.subs);
        temp.entries = sorted;
        clipboard.writeText(transform(temp));
        this.status.set('copied');
    }

    async paste() {
        const source = await clipboard.readText();
        if (!source) return;
        let [portion, _] = this.retrieveFromSource(source);
        if (!portion) {
            console.log('error reading clipboard: ' + source);
            this.status.set('failed to parse clipboard data as subtitles');
            return;
        }
        let position: number;
        if (this.selection.submitted.size > 0 || this.selection.focused) {
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
        this.status.set('pasted');
    }

    offsetFocus(n: number, mode: SelectMode) {
        let focused = this.getFocusedEntry();
        if (focused == 'virtual' && mode == SelectMode.Single) {
            if (n == -1 && this.subs.entries.length > 0)
                this.selectEntry(this.subs.entries.at(-1)!, mode);
        }
        if (!(focused instanceof SubtitleEntry)) return;
        let i = this.subs.entries.indexOf(focused) + n;
        if (i >= this.subs.entries.length) {
            if (mode == SelectMode.Single)
                this.selectVirtualEntry();
        }
        else if (i < 0) return;
        else this.selectEntry(this.subs.entries[i], mode);
    }

    toggleEntry(ent: SubtitleEntry, mode: SelectMode, cause = ChangeCause.UIList) {
        // it's only a 'toggle' when multiselecting; otherwise, just select it
        if (mode === SelectMode.Multiple) {
            this.states.isEditingVirtualEntry.set(false);
            if (this.getFocusedEntry() == ent) {
                this.clearFocus();
            }
            if (this.selection.currentGroup.includes(ent)) {
                for (let e of this.selection.currentGroup)
                    this.selection.submitted.add(e);
                this.selection.focused = null;
                this.selection.currentGroup = [];
            }
            if (this.selection.submitted.has(ent)) {
                this.selection.submitted.delete(ent);
                this.onSelectionChanged.dispatch(cause);
                return;
            }
        }
        this.selectEntry(ent, mode, cause);
    }

    selectVirtualEntry() {
        this.clearSelection();
        this.focused.entry.set("virtual");
        this.keepEntryInView("virtual");
    }
  
    selectEntry(ent: SubtitleEntry, mode: SelectMode, cause = ChangeCause.UIList) {
        switch (mode) {
            case SelectMode.Sequence:
                if (this.selection.focused == null) {
                    this.selection.focused = ent;
                    this.selection.currentGroup = [ent];
                    // this.#status = 'selection initiated';
                } else {
                    let a = this.subs.entries.indexOf(this.selection.focused);
                    let b = this.subs.entries.indexOf(ent);
                    assert(a >= 0 && b >= 0);
                    this.selection.currentGroup = 
                        this.subs.entries.slice(Math.min(a, b), Math.max(a, b) + 1);
                    // this.#status = 'seqselect updated';
                }
                break;
            case SelectMode.Multiple:
                for (let e of this.selection.currentGroup)
                    this.selection.submitted.add(e);
                this.selection.focused = ent;
                this.selection.currentGroup = [ent];
                // this.#status = 'multiselect added item';
                break;
            case SelectMode.Single:
                // clear selection
                this.selection.submitted.clear();
                this.selection.currentGroup = [ent];
                this.selection.focused = ent;
                break;
        }
        if (this.getFocusedEntry() != ent) {
            this.states.isEditingVirtualEntry.set(false);
            this.clearFocus();
            this.focused.entry.set(ent);
            // TODO: focus on current style
            this.keepEntryInView(ent);
            this.onSelectionChanged.dispatch(cause);
        }
    }
}