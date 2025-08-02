console.info('Editing loading');

import { get, writable, type Writable } from "svelte/store";
import { SubtitleEntry, type SubtitleStyle } from "../core/Subtitles.svelte";
import { Basic } from "../Basic";
import { ChangeCause, ChangeType, Source } from "./Source";
import { EventHost } from "../details/EventHost";

import { unwrapFunctionStore, _ } from 'svelte-i18n';
import { Debug } from "../Debug";
import { Metric, Metrics } from "../core/Filter";
import { Frontend } from "./Frontend";
import { ask } from "@tauri-apps/plugin-dialog";
const $_ = unwrapFunctionStore(_);

export type SelectionState = {
    submitted: Set<SubtitleEntry>,
    currentGroup: Set<SubtitleEntry>,
    focused: SubtitleEntry | null
};

export type FocusState = {
    entry: Writable<SubtitleEntry | null | 'virtual'>,
    control: HTMLTextAreaElement | null,
    style: Writable<SubtitleStyle | null>
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

Object.defineProperty(Metrics, 'selected', {
    value: new Metric('boolean', 'editing',
        () => $_('metrics.selected'), 
        () => $_('metrics.selected'), 
        (e) => Editing.inSelection(e))
});

function updateFocusedStyle() {
    let focused = Editing.getFocusedEntry();
    Debug.assert(focused instanceof SubtitleEntry);
    const style = get(Editing.focused.style);
    if (style === null
        || !Editing.styleToEditor.has(style)
        || !focused.texts.has(style)
    ) {
        const first = focused.texts.has(Source.subs.defaultStyle) 
            ? Source.subs.defaultStyle
            : Source.subs.styles.find((x) => focused.texts.has(x));
        Debug.assert(first !== undefined);
        Editing.focused.style.set(first);
        Debug.debug('changed focused style to', first.name);
        return first;
    }
    return style;
}

export const Editing = {
    selection: {
        submitted: new Set(),
        currentGroup: new Set(),
        focused: null
    } as SelectionState,
    
    // TODO: make it more private to prevent direct editing
    focused: {
        entry: writable(null),
        control: null,
        style: writable(null)
    } as FocusState,

    editChanged: false,
    isEditingVirtualEntry: writable(false),
    useUntimedForNewEntires: writable(false),

    styleToEditor: new WeakMap<SubtitleStyle, HTMLTextAreaElement>(),

    onSelectionChanged: new EventHost<[cause: ChangeCause]>(),
    onKeepEntryInView: new EventHost<[entry: SubtitleEntry | 'virtual']>(),
    onKeepEntryAtPosition: new EventHost<[entry: SubtitleEntry, previous: SubtitleEntry]>(),

    getFocusedEntry() {
        return get(this.focused.entry);
    },

    inSelection(entry: SubtitleEntry) {
        return this.selection.submitted.has(entry)
            || this.selection.currentGroup.has(entry);
    },

    /**
     * @returns the currently selected entries, in source order
     */
    getSelection() {
        return Source.subs.entries.filter(
            (x) => this.selection.submitted.has(x) || 
                this.selection.currentGroup.has(x));
    },

    startEditingFocusedEntry() {
        const style = updateFocusedStyle();
        let elem = this.styleToEditor.get(style)!;
        elem.focus();
        elem.scrollIntoView();
    },

    insertAtTime(start: number, end: number, style: SubtitleStyle) {
        let index = Source.subs.entries.length;
        let beforeTime = -Infinity;
        Source.subs.entries.forEach((ent, i) => {
            if (ent.texts.has(style) && ent.end <= start && ent.end >= beforeTime) {
                beforeTime = ent.end;
                index = i + 1;
            }
        });
        return this.insertEntry([style], start, end, index);
    },

    insertEntry(
        styles: Iterable<SubtitleStyle> | undefined, 
        start: number, end: number, index: number
    ) {
        let entry = new SubtitleEntry(start, end);
        if (!styles) styles = [Source.subs.defaultStyle];
        for (const s of styles)
            entry.texts.set(s, '');

        Source.subs.entries.splice(index, 0, entry);
        setTimeout(() => this.selectEntry(entry, SelectMode.Single), 0);
        return entry;
    },

    async fillWithFirstLineOfUntimed(entry: SubtitleEntry, style: SubtitleStyle) {
        const untimed = Source.subs.metadata.special.untimedText;
        const firstNewline = untimed.indexOf('\n');
        const line = firstNewline < 0 ? untimed : untimed.substring(0, firstNewline);
        if (line.length > 0 && (line.length < 500 
            || await ask($_('msg.untimed-first-line-very-long'))))
        {
            entry.texts.set(style, line);
            Source.subs.metadata.special.untimedText = 
                firstNewline < 0 ? '' : untimed.substring(firstNewline+1);
        }
    },

    startEditingNewVirtualEntry() {
        Frontend.setStatus($_('msg.new-entry-appended'));
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
        Source.markChanged(ChangeType.Times, $_('action.insert-after'));

        // focus on the new entry
        this.clearSelection();
        this.selectEntry(entry, SelectMode.Single);
        updateFocusedStyle();
        setTimeout(() => {
            this.onKeepEntryInView.dispatch(entry);
            this.startEditingFocusedEntry();
        }, 0);
        this.isEditingVirtualEntry.set(true);
    },

    insertChannel(style: SubtitleStyle) {
        let focused = this.getFocusedEntry();
        Debug.assert(focused instanceof SubtitleEntry);
        if (focused.texts.has(style)) return;
        focused.texts.set(style, '');
        this.focused.style.set(style);
        Source.markChanged(ChangeType.InPlace, $_('c.insert-channel'));
        this.startEditingFocusedEntry();
    },

    deleteChannel(style: SubtitleStyle) {
        let focused = this.getFocusedEntry();
        Debug.assert(focused instanceof SubtitleEntry);
        if (!focused.texts.has(style)) return Debug.early('no such channel to delete');
        Debug.assert(focused.texts.size > 1);
        focused.texts.delete(style);
        updateFocusedStyle();
        Source.markChanged(ChangeType.InPlace, $_('c.delete-channel'));
    },

    submitFocusedEntry() {
        let focused = this.getFocusedEntry();
        Debug.assert(focused instanceof SubtitleEntry);
        if (!this.editChanged) return;

        const style = get(this.focused.style);
        const control = this.focused.control;
        Debug.assert(style !== null && control !== null);
        focused.texts.set(style, control.value);
        Source.markChanged(ChangeType.InPlace, $_('c.edit-entry'));
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
        Editing.selection.currentGroup.clear();
        Editing.selection.currentGroup.add(entries[0]);
        this.clearFocus();
        Editing.onSelectionChanged.dispatch(ChangeCause.Action);
    },

    clearSelection(cause = ChangeCause.UIList) {
        this.selection.submitted.clear();
        Editing.selection.currentGroup.clear();
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

        Source.markChanged(ChangeType.Times, $_('action.delete'));
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
            if (this.selection.currentGroup.has(ent)) {
                for (let e of this.selection.currentGroup)
                    this.selection.submitted.add(e);
                this.selection.focused = null;
                Editing.selection.currentGroup.clear();
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
                    this.selection.currentGroup.clear();
                    this.selection.currentGroup.add(ent);
                } else {
                    let a = Source.subs.entries.indexOf(this.selection.focused);
                    let b = Source.subs.entries.indexOf(ent);
                    Debug.assert(a >= 0 && b >= 0);
                    this.selection.currentGroup = new Set(
                        Source.subs.entries.slice(Math.min(a, b), Math.max(a, b) + 1));
                }
                break;
            case SelectMode.Multiple:
                for (let e of this.selection.currentGroup)
                    this.selection.submitted.add(e);
                this.selection.focused = ent;
                this.selection.currentGroup.clear();
                this.selection.currentGroup.add(ent);
                break;
            case SelectMode.Single:
                // clear selection
                this.selection.submitted.clear();
                this.selection.currentGroup.clear();
                this.selection.currentGroup.add(ent);
                this.selection.focused = ent;
                break;
        }
        if (this.getFocusedEntry() != ent) {
            const oldFocus = this.getFocusedEntry();

            this.isEditingVirtualEntry.set(false);
            this.clearFocus();
            this.focused.entry.set(ent);
            // TODO: focus on current style
            if (keepType == KeepInViewMode.SamePosition && oldFocus instanceof SubtitleEntry)
                this.onKeepEntryAtPosition.dispatch(ent, oldFocus);
            else
                this.onKeepEntryInView.dispatch(ent);
            this.onSelectionChanged.dispatch(cause);
            updateFocusedStyle();
        }
    },
}