console.info('Editing loading');

import { Basic } from "../Basic";
import { Debug } from "../Debug";
import { ChangeCause, ChangeType, Source } from "./Source";
import { Frontend } from "./Frontend";

import type RichEdit from "../component/richedit/RichEdit.svelte";
import { Memorized } from "../config/MemorizedValue.svelte";
import { EventHost } from "@the_dissidents/svelte-ui";

import { SubtitleEntry, type SubtitleStyle } from "../core/Subtitles.svelte";
import { MetricDefinition, Metrics } from "../core/Filter";
import { RichText } from "../core/RichText";

import { writable } from "svelte/store";
import { SvelteMap } from "svelte/reactivity";
import { ask } from "@tauri-apps/plugin-dialog";
import * as z from "zod/v4-mini";

import { _, unwrapFunctionStore } from 'svelte-i18n';
const $_ = unwrapFunctionStore(_);

export type SelectionData = {
    type: 'selection',

    // shift-selecting doesn't effect submitted entries
    submitted: Set<SubtitleEntry>,

    // for shift-selecting
    currentGroup?: {
        // the origin of sequence selection, not necessarily the focused
        // this is always also in submitted
        head: SubtitleEntry,
        // we can also define a `tail` but giving the entries here is more efficient
        entries: Set<SubtitleEntry>
    },

    // the highlighted, focused entry
    focused?: SubtitleEntry,
} | {
    type: 'virtual-entry'
} | {
    type: 'none'
};

/** @deprecated */
export type SelectionState = {
    submitted: Set<SubtitleEntry>,
    currentGroup: Set<SubtitleEntry>,
    focused: SubtitleEntry | null
};

type WritableFocusState = {
    control: RichEdit | null,
}

export type FocusState = {
    control: RichEdit | null,
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
    if (ev.getModifierState(Basic.ctrlKey)) return SelectMode.Multiple;
    return SelectMode.Single;
}

Metrics['selected'] = new MetricDefinition('boolean', 'editing',
    () => $_('metrics.selected'),
    () => $_('metrics.selected'),
    (e) => Selection.has(e));

function updateActiveChannel() {
    const focused = Selection.focusedEntry;
    Debug.assert(!!focused);

    const style = Editing.activeChannel;
    if (!style || !focused.texts.has(style)) {
        const first = Source.subs.styles.find((x) => focused.texts.has(x));
        Debug.assert(first !== undefined);
        Editing.setActiveChannel(first);
        return first;
    }
    return style;
}

let __control: RichEdit | null = null;

const focusState: WritableFocusState = {
    get control() { return __control; },
    set control(x) {
        __control = x;
    },
};

let selection = { type: 'none' } as SelectionData;

// Blur the rich text editor whenever UI focus leaves the editing field, because this doesn't automatically happen if the selection didn't change.
// idk if this is the correct place for this logic
Frontend.uiFocus.subscribe((focus) => {
    if (focus !== 'EditingField')
        focusState.control?.blur();
});

// Low-level manipulation of selection state
export const Selection = {
    get type() {
        return selection.type;
    },

    get isVirtualEntry() {
        return selection.type == 'virtual-entry';
    },

    get focusedEntry() {
        return selection.type == 'selection' ? selection.focused : undefined;
    },

    /**
     * @returns the currently selected entries, in source order
     */
    get entries() {
        if (selection.type !== 'selection') return [];
        return Source.subs.entries.filter((x) => Selection.has(x));
    },

    get size() {
        if (selection.type !== 'selection') return 0;
        if (selection.currentGroup) {
            Debug.assert(selection.submitted.has(selection.currentGroup.head));
            Debug.assert(selection.currentGroup.entries.has(selection.currentGroup.head));
        } else
            Debug.assert(selection.submitted.size > 0);
        const size = selection.submitted.size + (selection.currentGroup?.entries.size ?? 1) - 1;
        Debug.assert(size == this.entries.length);
        return size;
    },

    has(entry: SubtitleEntry) {
        if (selection.type !== 'selection') return false;
        return selection.submitted.has(entry)
            || (selection.currentGroup?.entries.has(entry) ?? false);
    },

    isDisjunct() {
        let state = 0;
        for (const ent of Source.subs.entries) {
            if (this.has(ent)) {
                if (state == 2) return true;
                else state = 1;
            } else if (state == 1) state = 2;
        }
        return false;
    },

    submitCurrentGroup() {
        Debug.assert(selection.type == 'selection');
        if (!selection.currentGroup) return;

        for (const e of selection.currentGroup.entries)
            selection.submitted.add(e);
        selection.currentGroup = undefined;
    },

    setSync(entries: readonly SubtitleEntry[], focus?: SubtitleEntry) {
        Debug.assert(entries.length > 0);
        selection = {
            type: 'selection',
            submitted: new Set(entries),
            focused: focus ?? entries[0]
        };
    },

    // dispatches `onSelectionChanged`
    // sets focus to first of entries if not given
    async set(entries: readonly SubtitleEntry[], focused?: SubtitleEntry) {
        if (entries.length == 0) {
            await this.clear();
            return;
        }

        focused = focused ?? entries[0];
        if (this.focusedEntry !== focused)
            await Editing.submitFocusedEntry();

        selection = {
            type: 'selection',
            submitted: new Set(entries),
            focused
        };
        Debug.assert(selection.submitted.has(focused));
        Editing.onSelectionChanged.dispatch(ChangeCause.Action);
    },

    // calls `Editing.clearFocus` and dispatches `onSelectionChanged`
    async clear(cause = ChangeCause.UIList) {
        if (selection.type == 'none') return;

        if (this.focusedEntry)
            await Editing.submitFocusedEntry();
        selection = { type: 'none' };
        Editing.onSelectionChanged.dispatch(cause);
    },

    clearSync(cause = ChangeCause.UIList) {
        if (selection.type == 'none') return;
        selection = { type: 'none' };
        Editing.onSelectionChanged.dispatch(cause);
    },
};

export const Editing = {
    get focused(): FocusState {
        return focusState;
    },

    editChanged: false,
    isEditingVirtualEntry: writable(false),
    useUntimedForNewEntires: Memorized.$('useUntimedForNewEntires', z.boolean(), false),

    // A map from style/channel to editor widgets
    // TODO: this is a pretty bad design.
    styleToEditor: new SvelteMap<SubtitleStyle, RichEdit>(),

    onSelectionChanged: new EventHost<[cause: ChangeCause]>(),
    onKeepEntryInView: new EventHost<[entry: SubtitleEntry | 'virtual']>(),
    onKeepEntryAtPosition: new EventHost<[entry: SubtitleEntry, previous: SubtitleEntry]>(),

    get activeChannel() {
        const channel = Source.subs.view.activeChannel;
        if (channel && !Source.subs.styles.includes(channel))
            Source.subs.view.activeChannel = null;
        return Source.subs.view.activeChannel;
    },

    get activeOrFirstChannel() {
        return this.activeChannel ?? Source.subs.styles[0];
    },

    setActiveChannel(s: SubtitleStyle | null) {
        Debug.assert(!s || Source.subs.styles.includes(s));
        if (Source.subs.view.activeChannel === s) return;

        Source.subs.view.activeChannel = s;
        Source.onSubtitleViewChanged.dispatch();
    },

    startEditingFocusedEntry() {
        const style = updateActiveChannel();
        const editor = this.styleToEditor.get(style);
        if (!editor) return Debug.early();
        editor.focus();
        editor.scrollIntoView();
    },

    insertAtTime(start: number, end: number, style: SubtitleStyle) {
        let index = 0;
        let beforeTime = -Infinity;
        Source.subs.entries.forEach((ent, i) => {
            if (ent.end <= start && ent.end >= beforeTime) {
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
        void Debug.trace('insertEntry', start, end, index);
        const entry = new SubtitleEntry(start, end);
        if (!styles) styles = [Editing.activeOrFirstChannel];
        for (const s of styles)
            entry.texts.set(s, '');

        Source.subs.entries.splice(index, 0, entry);
        setTimeout(() => this.selectEntry(entry, SelectMode.Single), 0);
        return entry;
    },

    async fillWithFirstLineOfUntimed(entry: SubtitleEntry, style: SubtitleStyle, separator = '\n') {
        const untimed = Source.subs.metadata.special.untimedText;
        const firstNewline = untimed.indexOf(separator);
        const line = firstNewline < 0 ? untimed : untimed.substring(0, firstNewline);
        if (line.length > 0 && (line.length < 500
            || await ask($_('msg.untimed-first-line-very-long'))))
        {
            entry.texts.set(style, line);
            Source.subs.metadata.special.untimedText =
                firstNewline < 0 ? '' : untimed.substring(firstNewline + separator.length);
        }
    },

    async startEditingNewVirtualEntry() {
        Frontend.setStatus($_('msg.new-entry-appended'));
        const last = Source.subs.entries.at(-1);
        const entry = last
            ? new SubtitleEntry(last.end, last.end + 2)
            : new SubtitleEntry(0, 2);
        if (last) {
            for (const [style, _] of last.texts)
                entry.texts.set(style, '');
        } else {
            entry.texts.set(Editing.activeOrFirstChannel, '');
        }
        Source.subs.entries.push(entry);
        await Source.markChanged(ChangeType.Times, $_('action.insert-after'));

        // focus on the new entry
        await this.selectEntry(entry, SelectMode.Single);

        setTimeout(() => {
            this.onKeepEntryInView.dispatch(entry);
            this.startEditingFocusedEntry();
        }, 0);
        this.isEditingVirtualEntry.set(true);
    },

    async insertChannel(style: SubtitleStyle) {
        const focused = Selection.focusedEntry;
        Debug.assert(!!focused);

        if (focused.texts.has(style)) return;
        focused.texts.set(style, '');
        this.setActiveChannel(style);
        await Source.markChanged(ChangeType.InPlace, $_('c.insert-channel'));
        this.startEditingFocusedEntry();
    },

    async deleteChannel(style: SubtitleStyle) {
        const focused = Selection.focusedEntry;
        Debug.assert(!!focused);

        if (!focused.texts.has(style)) return Debug.early();
        Debug.assert(focused.texts.size > 1);
        focused.texts.delete(style);
        await Source.markChanged(ChangeType.InPlace, $_('c.delete-channel'));
    },

    async submitEntry(entry: SubtitleEntry, style: SubtitleStyle, text: RichText) {
        entry.texts.set(style, text);
        this.editChanged = false;
        await Source.markChanged(ChangeType.InPlace, $_('c.edit-entry'));
    },

    async submitFocusedEntry() {
        if (selection.type !== 'selection' || !selection.focused)
            return Debug.early();
        if (!this.editChanged) return;

        const focused = selection.focused;
        const style = this.activeChannel;
        const control = focusState.control;
        Debug.assert(style !== null);
        Debug.assert(control !== null);
        await this.submitEntry(focused, style, control.getText());
    },

    /** @deprecated */
    async clearFocus(check = true) {
        switch (selection.type) {
            case "none": return;
            case "selection":
                if (!selection.focused) return;
                if (check) await this.submitFocusedEntry();
                selection.focused = undefined;
                return;
            case "virtual-entry":
                selection = { type: 'none' };
                return;
            default:
                Debug.never(selection);
        }
    },

    async deleteSelection(cause = ChangeCause.UIList) {
        const selection = Selection.entries;
        if (selection.length == 0) return;
        const next = Source.subs.entries.at(Source.subs.entries.indexOf(selection.at(-1)!) + 1);
        const newEntries =
            Source.subs.entries.filter((x) => !selection.includes(x));
        Source.subs.entries = newEntries;
        await Selection.clear();
        if (next) await this.selectEntry(next, SelectMode.Single);
        else await this.selectVirtualEntry();

        await Source.markChanged(ChangeType.Times, $_('action.delete'));
        this.onSelectionChanged.dispatch(cause);
    },

    async offsetFocus(n: number, mode: SelectMode, keepType = KeepInViewMode.KeepInSight) {
        if (Selection.isVirtualEntry && mode == SelectMode.Single && n == -1
         && Source.subs.entries.length > 0)
        {
            await this.selectEntry(
                Source.subs.entries.at(-1)!, mode, ChangeCause.UIList, keepType);
            return;
        }

        const focused = Selection.focusedEntry;
        if (!focused) return;
        const i = Source.subs.entries.indexOf(focused) + n;
        if (i >= Source.subs.entries.length) {
            if (mode == SelectMode.Single)
                await this.selectVirtualEntry();
            return;
        }
        if (i < 0) return;
        await this.selectEntry(Source.subs.entries[i], mode, ChangeCause.UIList, keepType);
    },

    // TODO: why no keepType?
    async toggleEntry(ent: SubtitleEntry, mode: SelectMode, cause = ChangeCause.UIList) {
        // it's only a 'toggle' when multiselecting; otherwise, just select it
        if (mode === SelectMode.Multiple) {
            this.isEditingVirtualEntry.set(false);
            if (selection.type == 'selection') {
                if (selection.focused == ent) {
                    await this.submitFocusedEntry();
                    selection.focused = undefined;
                }

                // leaving sequence selection mode
                Selection.submitCurrentGroup();

                if (selection.submitted.has(ent)) {
                    selection.submitted.delete(ent);
                    if (selection.submitted.size == 0)
                        selection = { type: 'none' };
                    this.onSelectionChanged.dispatch(cause);
                    return;
                }
            }
        }
        await this.selectEntry(ent, mode, cause);
    },

    async selectVirtualEntry() {
        await Selection.clear();
        selection = { type: 'virtual-entry' };
        this.onKeepEntryInView.dispatch("virtual");
    },

    async selectEntry(
        ent: SubtitleEntry, mode: SelectMode,
        cause = ChangeCause.UIList, keepType = KeepInViewMode.KeepInSight
    ) {
        if (selection.type !== 'selection') selection = {
            type: 'selection',
            submitted: new Set([ent]),
        };

        const oldFocused = selection.focused;

        // selecting an entry always sets it as focused
        if (selection.focused != ent) {
            const oldFocus = selection.focused;
            if (oldFocus) {
                this.isEditingVirtualEntry.set(false);
                await this.submitFocusedEntry();
            }
            selection.focused = ent;

            if (keepType == KeepInViewMode.SamePosition && oldFocus)
                this.onKeepEntryAtPosition.dispatch(ent, oldFocus);
            else
                this.onKeepEntryInView.dispatch(ent);
        }

        switch (mode) {
            case SelectMode.Sequence: {
                const head = selection.currentGroup
                    ? selection.currentGroup.head
                    : (oldFocused ?? ent);

                if (ent === head) {
                    selection.submitted.add(ent);
                    selection.currentGroup = undefined;
                    break;
                }

                if (!selection.currentGroup)
                    selection.currentGroup = { entries: new Set(), head };
                const a = Source.subs.entries.indexOf(selection.currentGroup.head);
                const b = Source.subs.entries.indexOf(ent);
                Debug.assert(a >= 0 && b >= 0);
                selection.currentGroup.entries = new Set(
                    Source.subs.entries.slice(Math.min(a, b), Math.max(a, b) + 1));
                break;
            }
            case SelectMode.Single:
                // clear other parts of selection
                selection.currentGroup = undefined;
                selection.submitted.clear();
                selection.submitted.add(ent);
                break;
            case SelectMode.Multiple:
                // leaving sequence selection mode
                Selection.submitCurrentGroup();
                selection.submitted.add(ent);
                break;
        }

        this.onSelectionChanged.dispatch(cause);
    },
}
