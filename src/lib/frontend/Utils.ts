console.info('Utils loading');

import * as dialog from "@tauri-apps/plugin-dialog";

import { SubtitleEntry, type SubtitleStyle } from "../core/Subtitles.svelte";
import { Editing, SelectMode } from "./Editing";
import { ChangeType, Source } from "./Source";

import { Debug } from "../Debug";
import { _, unwrapFunctionStore } from 'svelte-i18n';
import { Frontend } from "./Frontend";
import { get } from "svelte/store";
import { RichText } from "../core/RichText";
const $_ = unwrapFunctionStore(_);

export const Utils = {
    timeEpsilon: 0.01,

    isSelectionDisjunct() {
        let state = 0;
        for (let i = 0; i < Source.subs.entries.length; i++) {
            const ent = Source.subs.entries[i];
            if (Editing.selection.submitted.has(ent)
             || Editing.selection.currentGroup.has(ent))
            {
                if (state == 2) return true;
                else state = 1;
            } else if (state == 1) state = 2;
        }
        return false;
    },

    moveSelectionContinuous(direction: number) {
        if (this.isSelectionDisjunct()) return Debug.early();
        const selection = Editing.getSelection();
        if (selection.length == 0 || direction == 0) return Debug.early();

        const index = Source.subs.entries.indexOf(selection[0]);
        if (index + direction < 0 || index + direction > Source.subs.entries.length) return;
        Source.subs.entries.splice(index, selection.length);
        Source.subs.entries.splice(index + direction, 0, ...selection);
        Source.markChanged(ChangeType.Order, $_('c.move-entries'));

        const entry = direction > 0 ? selection.at(-1)! : selection[0];
        setTimeout(() => {
            Editing.onKeepEntryInView.dispatch(entry);
        }, 0);
    },

    moveSelectionTo(to: 'beginning' | 'end') {
        const selection = Editing.getSelection();
        if (selection.length == 0) return Debug.early();
        const selectionSet = new Set(selection);
        let newEntries = Source.subs.entries.filter((x) => !selectionSet.has(x));
        switch (to) {
        case "beginning":
            newEntries = [...selection, ...newEntries]; break;
        case "end":
            newEntries = [...newEntries, ...selection]; break;
        }
        Source.subs.entries = newEntries;
        Source.markChanged(ChangeType.Order, $_('c.move-entries'));
    },

    // TODO: make this a dialog
    fixOverlap(selection: SubtitleEntry[], epsilon = 0.05) {
        let count = 0;
        for (let i = 0; i < selection.length - 1; i++) {
            const entry = selection[i];
            for (let j = 1; j < selection.length; j++) {
                const other = selection[j];
                if (entry.start < other.end && other.end - entry.start < epsilon) {
                    entry.start = other.end;
                    count++;
                }
                if (entry.end > other.start && entry.end - other.start < epsilon) {
                    entry.end = other.start;
                    count++;
                }
            }
        }

        Frontend.setStatus($_('msg.changed-n-entries', {values: {n: count}}));
        if (count > 0)
            Source.markChanged(ChangeType.Times, $_('action.fix-erroneous-overlapping'));
    },

    mergeDuplicate(selection: SubtitleEntry[]) {
        const deletion = new Set<SubtitleEntry>;
        for (let i = 0; i < selection.length; i++) {
            const entry = selection[i];
            if (deletion.has(entry)) continue;
            
            search: for (let j = 0; j < selection.length; j++) {
                if (i == j) continue;
                const other = selection[j];
                if (deletion.has(other)) continue;
                for (const [style, text] of other.texts) {
                    if (entry.texts.get(style) !== text) continue search;
                }

                if (Math.abs(other.start - entry.end) < this.timeEpsilon 
                 || Math.abs(other.end - entry.start) < this.timeEpsilon) 
                {
                    entry.start = Math.min(entry.start, other.start);
                    entry.end = Math.max(entry.end, other.end);
                    deletion.add(other);
                    break;
                }
            }
        }
        for (const entry of deletion) {
            const index = Source.subs.entries.indexOf(entry);
            Debug.assert(index > 0);
            Source.subs.entries.splice(index, 1);
        }

        Frontend.setStatus($_('msg.combined-n-entries', {values: {n: deletion.size}}));
        if (deletion.size > 0)
            Source.markChanged(ChangeType.Times, $_('action.merge-overlapping-duplicates'));
    },

    mergeStyle(entries: SubtitleEntry[], a: SubtitleStyle, b: SubtitleStyle) {
        let done = 0;
        for (const ent of entries) {
            const textA = RichText.trimEnd(ent.texts.get(a) ?? '');
            const textB = RichText.trimEnd(ent.texts.get(b) ?? '');
            if (textB === '') continue;
            ent.texts.set(a, textA + ' ' + textB);
            ent.texts.delete(b);
            done++;
        }
        Frontend.setStatus($_('msg.changed-n-entries', {values: {n: done}}));
        if (done)
            Source.markChanged(ChangeType.InPlace, $_('action.merge-channel'));
    },

    exchangeStyle(entries: SubtitleEntry[], a: SubtitleStyle, b: SubtitleStyle) {
        let done = 0;
        for (const ent of entries) {
            const textA = ent.texts.get(a);
            const textB = ent.texts.get(b);

            if (textA === undefined) ent.texts.delete(b);
            else ent.texts.set(b, textA);
            if (textB === undefined) ent.texts.delete(a);
            else ent.texts.set(a, textB);

            if (textA !== undefined || textB !== undefined)
                done++;
        }
        Frontend.setStatus($_('msg.changed-n-entries', {values: {n: done}}));
        if (done)
            Source.markChanged(ChangeType.InPlace, $_('action.exchange-channel'));
    },

    async replaceStyle(entries: SubtitleEntry[], a: SubtitleStyle, b: SubtitleStyle) {
        if (entries.some((x) => x.texts.has(a) && x.texts.has(b))
         && !await dialog.confirm($_('msg.overwrite-style', {values: {style: b.name}}))) return;
        let done = 0;
        for (const ent of entries) {
            const textA = ent.texts.get(a);
            if (textA !== undefined) {
                ent.texts.delete(a);
                ent.texts.set(b, textA);
                done++;
            }
        }
        Frontend.setStatus($_('msg.changed-n-entries', {values: {n: done}}));
        if (done)
            Source.markChanged(ChangeType.InPlace, $_('action.replace-channel'));
    },

    removeStyle(entries: SubtitleEntry[], style: SubtitleStyle) {
        let done = 0;
        for (const ent of entries) {
            if (ent.texts.has(style)) {
                ent.texts.delete(style);
                done++;
            }
            if (ent.texts.size == 0) {
                // remove if empty
                Source.subs.entries.splice(
                    Source.subs.entries.indexOf(ent), 1);
            }
        }
        Frontend.setStatus($_('msg.changed-n-entries', {values: {n: done}}));
        if (done)
            Source.markChanged(ChangeType.InPlace, $_('action.remove-channel'));
    },

    removeNewlines(entries: SubtitleEntry[], style: SubtitleStyle) {
        let done = 0;
        for (const ent of entries) {
            const rt = ent.texts.get(style);
            if (!rt) continue;
            const split = RichText.split(rt, '\n');
            if (split.length == 1) continue;
            ent.texts.set(style, RichText.join(split, ' '));
            done++;
        }
        Frontend.setStatus($_('msg.changed-n-entries', {values: {n: done}}));
        if (done)
            Source.markChanged(ChangeType.InPlace, $_('action.remove-newlines'));
    },

    mergeEntries(selection: SubtitleEntry[], keepAll: boolean) {
        const first = selection[0];
        let start = first.start, end = first.end;
        for (let i = 1; i < selection.length; i++) {
            if (keepAll) for (const [style, text] of selection[i].texts) {
                const oldText = first.texts.get(style);
                first.texts.set(style, RichText.concat(oldText ?? '', text));
            }
            start = Math.min(start, selection[i].start);
            end = Math.max(end, selection[i].end);

            Source.subs.entries.splice(
                Source.subs.entries.indexOf(selection[i]), 1);
        }
        first.start = start;
        first.end = end;
        
        Editing.selectEntry(first, SelectMode.Single);
        Source.markChanged(ChangeType.Times, $_('action.merge-entries'));
    },

    getAdjecentEntryWithThisStyle(dir: 'next' | 'previous') {
        const focusedEntry = Editing.getFocusedEntry();
        if (!(focusedEntry instanceof SubtitleEntry)) return null;
        const style = get(Editing.focused.style);
        if (!style) return null;
        const thisIndex = Source.subs.entries.indexOf(focusedEntry);
        Debug.assert(thisIndex >= 0);
        return (dir == 'next' 
            ? Source.subs.entries.find((ent, i) => i > thisIndex && ent.texts.has(style))
            : Source.subs.entries.findLast((ent, i) => i < thisIndex && ent.texts.has(style))
        ) ?? null;
    },

    sortSelection(cmp: (a: SubtitleEntry, b: SubtitleEntry) => number, changeName: string) {
        const selection = Editing.getSelection();
        // assumes selection is not disjunct
        const start = Source.subs.entries.indexOf(selection[0]);
        if (start < 0) return Debug.early();
        const positionMap = new Map<SubtitleEntry, number>();
        for (let i = 0; i < Source.subs.entries.length; i++)
            positionMap.set(Source.subs.entries[i], i);
        selection.sort(cmp);
        Source.subs.entries.splice(start, selection.length, ...selection);
        Source.markChanged(ChangeType.Order, changeName);
    }
}