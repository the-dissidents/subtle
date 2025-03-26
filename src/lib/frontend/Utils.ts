console.info('Utils loading');

import * as clipboard from "@tauri-apps/plugin-clipboard-manager";
import { assert } from "../Basic";
import { MergePosition, MergeStyleBehavior, SubtitleEntry, Subtitles, type SubtitleChannel, type SubtitleStyle } from "../core/Subtitles.svelte";
import { Editing, SelectMode } from "./Editing";
import { parseSubtitleSource } from "./Frontend";
import { Interface } from "./Interface";
import { ChangeCause, ChangeType, Source } from "./Source";
import { SimpleFormats } from "../core/SimpleFormats";
import { Playback } from "./Playback";

import { unwrapFunctionStore, _ } from 'svelte-i18n';
const $_ = unwrapFunctionStore(_);

export const Utils = {
    timeEpsilon: 0.01,

    isSelectionDisjunct() {
        let state = 0;
        for (let i = 0; i < Source.subs.entries.length; i++) {
            let ent = Source.subs.entries[i];
            if (Editing.selection.submitted.has(ent)
             || Editing.selection.currentGroup.includes(ent))
            {
                if (state == 2) return true;
                else state = 1;
            } else if (state == 1) state = 2;
        }
        return false;
    },

    copySelection(transform = SimpleFormats.export.JSON) {
        let selection = new Set(
            [...Editing.selection.currentGroup, ...Editing.selection.submitted]);
        if (selection.size == 0) return;
        let sorted = Source.subs.entries.filter((x) => selection.has(x));
        let temp = new Subtitles(Source.subs);
        temp.entries = sorted;
        clipboard.writeText(transform(temp));
        Interface.status.set('copied');
    },

    async paste() {
        const source = await clipboard.readText();
        if (!source) return;
        let [portion, _] = parseSubtitleSource(source);
        if (!portion) {
            console.log('error reading clipboard: ' + source);
            Interface.status.set($_('msg.failed-to-parse-clipboard-data-as-subtitles'));
            return;
        }
        let position: number;
        if (Editing.selection.submitted.size > 0 || Editing.selection.focused) {
            position = Source.subs.entries.findIndex(
                (x) => Editing.selection.submitted.has(x) 
                    || Editing.selection.currentGroup.includes(x));
            Editing.clearSelection();
        } else position = Source.subs.entries.length;

        let entries = Source.subs.merge(portion, {
            position: MergePosition.Custom,
            customPosition: position,
            style: MergeStyleBehavior.KeepDifferent
        });
        if (entries.length > 0) {
            Editing.setSelection(entries);
            Source.markChanged(ChangeType.General, ChangeCause.Action);
            Interface.status.set($_('msg.pasted'));
        } else {
            Interface.status.set($_('msg.nothing-to-paste'));
        }
    },

    insertEntryBefore(ent?: SubtitleEntry) {
        let index = ent ? Source.subs.entries.indexOf(ent) : 0;
        if (index < 0) return;
        let start: number, end: number;
        let pos = Playback.isLoaded ? Playback.position : Infinity;
        if (Source.subs.entries.length == 0) {
            start = 0;
            end = 2;
        } else if (index == 0) {
            let first = Source.subs.entries[0];
            start = Math.max(Math.min(pos, first.start - 2), 0);
            end = Math.min(start + 2, first.start);
        } else {
            assert(ent !== undefined);
            let last = Source.subs.entries[index - 1];
            if (last.end <= ent.start) {
                start = Math.max(Math.min(pos, ent.start - 2), last.end);
                end = Math.min(start + 2, ent.start);
            } else {
                start = Math.max(Math.min(pos, ent.start - 2), 0);
                end = Math.min(start + 2, ent.start);
            }
        }
        return Editing.insertEntry(ent, start, end, index);
    },

    insertEntryAfter(ent?: SubtitleEntry) {
        let index = ent ? Source.subs.entries.indexOf(ent) + 1 : Source.subs.entries.length;
        if (index < 0) return;
        let start: number, end: number;
        let pos = Playback.isLoaded ? Playback.position : Infinity;
        if (index == Source.subs.entries.length) {
            let last = Source.subs.entries.at(-1);
            start = Math.max(pos, last?.end ?? 0);
            end = start + 2;
        } else {
            assert(ent !== undefined);
            let next = Source.subs.entries[index];
            if (next.start >= ent.end) {
                start = Math.max(Math.min(next.start, pos), ent.end);
                end = Math.min(start + 2, next.start);
            } else {
                start = ent.end;
                end = start + 2;
            }
        }
        return Editing.insertEntry(ent, start, end, index);
    },

    removeChannel(selection: SubtitleEntry[], pred: (ch: SubtitleChannel) => boolean) {
        console.log(selection);
        let done = 0;
        let newSelection: SubtitleEntry[] = [];
        for (let ent of selection)
            if (ent.texts.find((t) => pred(t))) {
                ent.texts = ent.texts.filter((t) => !pred(t));
                console.log(ent.texts);
                if (ent.texts.length > 0) newSelection.push(ent);
                else Source.subs.entries.splice(
                    Source.subs.entries.indexOf(ent), 1);
                // ent.update.dispatch();
                done++;
            }

        Interface.status.set($_('msg.changed-n-entries', {values: {n: done}}));
        if (done > 0) {
            Editing.clearSelection();
            Editing.selection.submitted = new Set(newSelection);
            Source.markChanged(ChangeType.InPlace, ChangeCause.Action);
        }
    },

    selectAll() {
        Editing.selection.focused = null;
        Editing.selection.currentGroup = [];
        for (let e of Source.subs.entries)
            Editing.selection.submitted.add(e);
        Editing.onSelectionChanged.dispatch(ChangeCause.Action);
    },

    invertSelection() {
        let newSelection = new Set<SubtitleEntry>;
        let oldSelection = new Set(Editing.getSelection());
        for (let e of Source.subs.entries)
            if (!oldSelection.has(e)) newSelection.add(e);
        Editing.clearFocus();
        Editing.selection.focused = null;
        Editing.selection.currentGroup = [];
        Editing.selection.submitted = newSelection;
        Editing.onSelectionChanged.dispatch(ChangeCause.Action);
    },


    sortSelection(selection: SubtitleEntry[], byStyle: boolean) {
        // assumes selection is not disjunct
        if (selection.length == 0) return;
        let start = Source.subs.entries.indexOf(selection[0]);
        if (start < 0) return;
        let positionMap = new Map<SubtitleEntry, number>();
        for (let i = 0; i < Source.subs.entries.length; i++)
            positionMap.set(Source.subs.entries[i], i);
        if (byStyle) selection.sort((a, b) => 
            a.texts[0].style.name.localeCompare(b.texts[0].style.name)); 
        else selection.sort((a, b) => a.start - b.start);
        Source.subs.entries.splice(start, selection.length, ...selection);
        Source.markChanged(ChangeType.Order, ChangeCause.Action);
    },

    sortChannels(selection: SubtitleEntry[]) {
        let indices = new Map<SubtitleStyle, number>();
        indices.set(Source.subs.defaultStyle, 0);
        for (let i = 0; i < Source.subs.styles.length; i++)
            indices.set(Source.subs.styles[i], i+1);
        for (let ent of selection) {
            ent.texts.sort((a, b) => 
                (indices.get(a.style) ?? 0) - (indices.get(b.style) ?? 0));
            // ent.update.dispatch();
        }
        Source.markChanged(ChangeType.InPlace, ChangeCause.Action);
    },

    moveSelectionContinuous(selection: SubtitleEntry[], direction: number) {
        if (this.isSelectionDisjunct()) return;
        
        if (selection.length == 0 || direction == 0) return;
        let index = Source.subs.entries.indexOf(selection[0]);
        if (index + direction < 0 || index + direction > Source.subs.entries.length) return;
        Source.subs.entries.splice(index, selection.length);
        Source.subs.entries.splice(index + direction, 0, ...selection);
        Source.markChanged(ChangeType.Order, ChangeCause.Action);

        let entry = direction > 0 ? selection.at(-1)! : selection[0];
        setTimeout(() => {
            Editing.onKeepEntryInView.dispatch(entry);
        }, 0);
    },

    moveSelectionTo(selection: SubtitleEntry[], to: 'beginning' | 'end') {
        if (selection.length == 0) return;
        let selectionSet = new Set(selection);
        let newEntries = Source.subs.entries.filter((x) => !selectionSet.has(x));
        switch (to) {
        case "beginning":
            newEntries = [...selection, ...newEntries]; break;
        case "end":
            newEntries = [...newEntries, ...selection]; break;
        }
        Source.subs.entries = newEntries;
        Source.markChanged(ChangeType.Order, ChangeCause.Action);
    },

    fixOverlap(selection: SubtitleEntry[], epsilon = 0.05) {
        let count = 0;
        for (let i = 0; i < selection.length - 1; i++) {
            let entry = selection[i];
            for (let j = 1; j < selection.length; j++) {
                let other = selection[j];
                if (entry.start < other.end && other.end - entry.start < epsilon) {
                    entry.start = other.end;
                    count++;
                }
                if (entry.end > other.start && entry.end - other.start < epsilon) {
                    entry.end = other.start;
                    count++;
                }
            }
            // entry.update.dispatch();
        }

        Interface.status.set($_('msg.changed-n-entries', {values: {n: count}}));
        if (count > 0)
            Source.markChanged(ChangeType.Times, ChangeCause.Action);
    },

    combineSelection(selection: SubtitleEntry[]) {
        if (selection.length <= 1) return;
        let main = selection[0];
        for (let i = 1; i < selection.length; i++) {
            let other = selection[i];
            main.texts.push(...other.texts);
            const index = Source.subs.entries.indexOf(other);
            assert(index > 0);
            Source.subs.entries.splice(index, 1);
        }
        // main.update.dispatch();
        Source.markChanged(ChangeType.Times, ChangeCause.Action);
        Interface.status.set($_('msg.combined-n-entries', {values: {n: selection.length}}));
    },

    mergeDuplicate(selection: SubtitleEntry[]) {
        let deletion = new Set<SubtitleEntry>;
        for (let i = 0; i < selection.length; i++) {
            let entry = selection[i];
            if (deletion.has(entry) || entry.texts.length > 1) continue;
            
            for (let j = 0; j < selection.length; j++) {
                if (i == j) continue;
                let other = selection[j];
                if (deletion.has(other) || other.texts.length > 1) continue;
                if (other.texts[0].text != entry.texts[0].text) continue;

                if (Math.abs(other.start - entry.end) < this.timeEpsilon 
                    || Math.abs(other.end - entry.start) < this.timeEpsilon) 
                {
                    entry.start = Math.min(entry.start, other.start);
                    entry.end = Math.max(entry.end, other.end);
                    // entry.update.dispatch();
                    deletion.add(other);
                    break;
                }
            }
        }
        for (const entry of deletion) {
            const index = Source.subs.entries.indexOf(entry);
            assert(index > 0);
            Source.subs.entries.splice(index, 1);
        }
        Source.markChanged(ChangeType.Times, ChangeCause.Action);
    },

    mergeEntries(selection: SubtitleEntry[], keepAll: boolean) {
        let entry = selection[0];
        let start = entry.start, end = entry.end;
        for (let i = 1; i < selection.length; i++) {
            if (keepAll) for (const text of selection[i].texts) {
                const last = entry.texts.findLast(
                    (x) => x.style.name == text.style.name);
                if (last) last.text += ' ' + text.text;
                else entry.texts.push(text);
            }
            start = Math.min(start, selection[i].start);
            end = Math.max(end, selection[i].end);
        }
        entry.start = start;
        entry.end = end;
        Source.subs.entries.splice(
            Source.subs.entries.indexOf(entry) + 1,
            selection.length - 1);
        Editing.selectEntry(entry, SelectMode.Single);
        Source.markChanged(ChangeType.Times, ChangeCause.Action);
    },

    splitByNewline(selection: SubtitleEntry[]) {
        for (const entry of selection) {
            let newChannels: SubtitleChannel[] = [];
            for (const channel of entry.texts) {
                let split = channel.text.split('\n');
                if (split.length > 1) {
                    newChannels.push(...split.map(
                        (x) => ({style: channel.style, text: x})));
                } else newChannels.push(channel);
            }
            entry.texts = newChannels;
        }
        Source.markChanged(ChangeType.Times, ChangeCause.Action);
    },

    splitSimultaneous(selection: SubtitleEntry[]) {
        if (selection.length == 0) return;
        let newSelection: SubtitleEntry[] = [];
        for (let i = 0; i < selection.length; i++) {
            let entry = selection[i];
            let index = Source.subs.entries.indexOf(entry);
            newSelection.push(entry);
            for (let j = 1; j < entry.texts.length; j++) {
                index++;
                let newEntry = new SubtitleEntry(entry.start, entry.end, entry.texts[j]);
                Source.subs.entries.splice(index, 0, newEntry);
                newSelection.push(newEntry);
            }
            entry.texts = [entry.texts[0]];
        }
        if (newSelection.length != selection.length) {
            Editing.clearSelection();
            for (let ent of newSelection)
                Editing.selection.submitted.add(ent);
            Source.markChanged(ChangeType.Times, ChangeCause.Action);
        }
    }
}