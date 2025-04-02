console.info('Editing loading');

import { get, writable, type Writable } from "svelte/store";
import { SubtitleEntry, type SubtitleStyle } from "../core/Subtitles.svelte";
import { assert, Basic } from "../Basic";
import { Interface } from "./Interface";
import { ChangeCause, ChangeType, Source } from "./Source";
import { EventHost } from "./Frontend";

import { unwrapFunctionStore, _ } from 'svelte-i18n';
const $_ = unwrapFunctionStore(_);

export type SelectionState = {
    submitted: Set<SubtitleEntry>,
    currentGroup: SubtitleEntry[],
    focused: SubtitleEntry | null
};

export type FocusState = {
    entry: Writable<SubtitleEntry | null | 'virtual'>,
    control: HTMLTextAreaElement | null,
    style: SubtitleStyle | null
}

export enum SelectMode {
    Single,
    Multiple,
    Sequence
}

export enum KeepInViewMode {
    SamePosition,
    KeepInSight
}

export function getSelectMode(ev: MouseEvent | KeyboardEvent) {
    if (ev.shiftKey) return SelectMode.Sequence;
    if (ev.getModifierState(Basic.ctrlKey())) return SelectMode.Multiple;
    return SelectMode.Single;
}

export const Editing = {
    selection: {
        submitted: new Set(),
        currentGroup: [],
        focused: null
    } as SelectionState,
    
    // TODO: make it more private to prevent direct editing
    focused: {
        entry: writable(null),
        channel: null,
        control: null,
        style: null
    } as FocusState,

    editChanged: false,
    isEditingVirtualEntry: writable(false),
    styleToEditor: new WeakMap<SubtitleStyle, HTMLTextAreaElement>(),

    onSelectionChanged: new EventHost<[cause: ChangeCause]>(),
    onKeepEntryInView: new EventHost<[entry: SubtitleEntry | 'virtual']>(),
    onKeepEntryAtPosition: new EventHost<[entry: SubtitleEntry, previous: SubtitleEntry]>(),

    getFocusedEntry() {
        return get(this.focused.entry);
    },

    getSelection() {
        return Source.subs.entries.filter(
            (x) => this.selection.submitted.has(x) || 
                this.selection.currentGroup.includes(x));
    },

    startEditingFocusedEntry() {
        let focused = this.getFocusedEntry();
        assert(focused instanceof SubtitleEntry);
        if (this.focused.style === null) {
            const first = focused.texts.has(Source.subs.defaultStyle) 
                ? Source.subs.defaultStyle
                : Source.subs.styles.find((x) => focused.texts.has(x));
            assert(first !== undefined);
            this.focused.style = first;
        }
        let elem = this.styleToEditor.get(this.focused.style);
        if (!elem) return;
        elem.focus();
        elem.scrollIntoView();
    },

    insertEntry(like: SubtitleEntry | undefined, start: number, end: number, index: number) {
        let entry = new SubtitleEntry(start, end);
        if (like) {
            for (const [style, _] of like.texts)
                entry.texts.set(style, '');
        } else {
            entry.texts.set(Source.subs.defaultStyle, '');
        }
        Source.subs.entries.splice(index, 0, entry);
        Source.markChanged(ChangeType.Times);
        setTimeout(() => this.selectEntry(entry, SelectMode.Single), 0);
        return entry;
    },

    startEditingNewVirtualEntry() {
        Interface.status.set($_('msg.new-entry-appended'));
        let last = Source.subs.entries.at(-1);
        let entry = last 
            ? new SubtitleEntry(last.end, last.end + 2) 
            : new SubtitleEntry(0, 2);
        if (last) {
            for (const [style, _] of last.texts)
                entry.texts.set(style, '');
        } else {
            entry.texts.set(Source.subs.defaultStyle, '');
        }
        Source.subs.entries.push(entry);
        Source.markChanged(ChangeType.Times);

        // focus on the new entry
        this.clearSelection();
        this.selectEntry(entry, SelectMode.Single);
        this.focused.style = Source.subs.styles.find((x) => entry.texts.has(x))!;
        setTimeout(() => {
            this.onKeepEntryInView.dispatch(entry);
            this.startEditingFocusedEntry();
        }, 0);
        this.isEditingVirtualEntry.set(true);
    },

    insertChannel(style: SubtitleStyle) {
        let focused = this.getFocusedEntry();
        assert(focused instanceof SubtitleEntry);
        if (focused.texts.has(style)) return;
        focused.texts.set(style, '');
        this.focused.style = style;
        Source.markChanged(ChangeType.InPlace);
        this.startEditingFocusedEntry();
    },

    deleteChannel(style: SubtitleStyle) {
        let focused = this.getFocusedEntry();
        assert(focused instanceof SubtitleEntry);
        if (!focused.texts.has(style)) return;
        focused.texts.delete(style);
        if (this.focused.style == style)
            this.focused.style = null;
        // let channel = focused.texts[index];
        // if (channel == this.focused.channel)
        //     this.clearFocus(false); // don't try to submit since we're deleting it
        // focused.texts = focused.texts.toSpliced(index, 1);
        Source.markChanged(ChangeType.InPlace);
    },

    submitFocusedEntry() {
        let focused = this.getFocusedEntry();
        assert(focused instanceof SubtitleEntry);
        if (!this.editChanged) return;

        const style = this.focused.style;
        const control = this.focused.control;
        assert(style !== null && control !== null);
        focused.texts.set(style, control.value);
        Source.markChanged(ChangeType.InPlace);
    },

    clearFocus(trySubmit = true) {
        let focused = this.getFocusedEntry();
        if (focused == null) return;
        if (trySubmit && focused instanceof SubtitleEntry)
            this.submitFocusedEntry();
        this.focused.entry.set(null);
    },

    setSelection(entries: SubtitleEntry[]) {
        this.selection.submitted.clear();
        for (let ent of entries)
            Editing.selection.submitted.add(ent);
        Editing.selection.focused = entries[0];
        Editing.selection.currentGroup = [entries[0]];
        this.clearFocus();
        Editing.onSelectionChanged.dispatch(ChangeCause.Action);
    },

    clearSelection(cause = ChangeCause.UIList) {
        this.selection.submitted.clear();
        this.selection.currentGroup = [];
        this.selection.focused = null;
        this.clearFocus();
        this.onSelectionChanged.dispatch(cause);
    },

    deleteSelection(cause = ChangeCause.UIList) {
        let selection = this.getSelection();
        if (selection.length == 0) return;
        let next = Source.subs.entries.at(Source.subs.entries.indexOf(selection.at(-1)!) + 1);
        let newEntries = 
            Source.subs.entries.filter((x) => !selection.includes(x));
        Source.subs.entries = newEntries;
        this.clearSelection();
        if (next) this.selectEntry(next, SelectMode.Single);
        else this.selectVirtualEntry();

        Source.markChanged(ChangeType.Times);
        this.onSelectionChanged.dispatch(cause);
    },

    offsetFocus(n: number, mode: SelectMode, keepType = KeepInViewMode.KeepInSight) {
        let focused = this.getFocusedEntry();
        if (focused == 'virtual' && mode == SelectMode.Single) {
            if (n == -1 && Source.subs.entries.length > 0) {
                this.selectEntry(Source.subs.entries.at(-1)!, mode, ChangeCause.UIList, keepType);
                return;
            }
        }

        if (!(focused instanceof SubtitleEntry)) return;
        let i = Source.subs.entries.indexOf(focused) + n;
        if (i >= Source.subs.entries.length) {
            if (mode == SelectMode.Single) {
                this.selectVirtualEntry();
                return;
            }
        }
        if (i < 0) return;
        this.selectEntry(Source.subs.entries[i], mode, ChangeCause.UIList, keepType);
    },

    toggleEntry(ent: SubtitleEntry, mode: SelectMode, cause = ChangeCause.UIList) {
        // it's only a 'toggle' when multiselecting; otherwise, just select it
        if (mode === SelectMode.Multiple) {
            this.isEditingVirtualEntry.set(false);
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
    },

    selectVirtualEntry() {
        this.clearSelection();
        this.focused.entry.set("virtual");
        this.onKeepEntryInView.dispatch("virtual");
    },
  
    selectEntry(
        ent: SubtitleEntry, mode: SelectMode, 
        cause = ChangeCause.UIList, keepType = KeepInViewMode.KeepInSight
    ) {
        switch (mode) {
            case SelectMode.Sequence:
                if (this.selection.focused == null) {
                    this.selection.focused = ent;
                    this.selection.currentGroup = [ent];
                    // this.#status = 'selection initiated';
                } else {
                    let a = Source.subs.entries.indexOf(this.selection.focused);
                    let b = Source.subs.entries.indexOf(ent);
                    assert(a >= 0 && b >= 0);
                    this.selection.currentGroup = 
                    Source.subs.entries.slice(Math.min(a, b), Math.max(a, b) + 1);
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
            const oldFocus = this.getFocusedEntry();

            this.isEditingVirtualEntry.set(false);
            this.clearFocus();
            this.focused.entry.set(ent);
            // TODO: focus on current style
            if (keepType == KeepInViewMode.SamePosition && oldFocus instanceof SubtitleEntry) {
                this.onKeepEntryAtPosition.dispatch(ent, oldFocus);
            } else {
                this.onKeepEntryInView.dispatch(ent);
            }
            this.onSelectionChanged.dispatch(cause);
        }
    },
}