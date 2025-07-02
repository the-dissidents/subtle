import { UICommand } from "./CommandBase";

import { get } from "svelte/store";
import { Debug } from "../Debug";
import * as clipboard from "@tauri-apps/plugin-clipboard-manager";
import { LinearFormatCombineStrategy, SubtitleUtil } from "../core/SubtitleUtil.svelte";
import { Editing, KeepInViewMode, SelectMode } from "./Editing";
import { Frontend, parseSubtitleSource } from "./Frontend";
import { Source, ChangeType, ChangeCause } from "./Source";
import { Labels, SubtitleEntry, type SubtitleStyle } from "../core/Subtitles.svelte";
import { Playback } from "./Playback";
import { Utils } from "./Utils";
import { Dialogs } from "./Dialogs";
import { InputConfig } from "../config/Groups";
import { Basic } from "../Basic";
import { Format } from "../core/Formats";
import { Toolboxes } from "./Toolboxes";
import { CommandBinding, KeybindingManager } from "./Keybinding";

import { _, unwrapFunctionStore } from 'svelte-i18n';
const $_ = unwrapFunctionStore(_);

const toJSON = (entries: SubtitleEntry[]) => 
    Format.JSON.write(Source.subs).useEntries(entries).toString();
const toASS = (entries: SubtitleEntry[]) => 
    Format.ASS.write(Source.subs).headerless().useEntries(entries).toString();

const toSRT = (entries: SubtitleEntry[]) => 
    Format.SRT.write(Source.subs)
        .useEntries(entries)
        .strategy(LinearFormatCombineStrategy.Recombine)
        .toString();
const toPlaintext = (entries: SubtitleEntry[]) => 
    Format.plaintext.write(Source.subs)
        .useEntries(entries)
        .strategy(LinearFormatCombineStrategy.KeepOrder)
        .toString();

async function copySelection(transform: (use: SubtitleEntry[]) => string) {
    let selection = Editing.getSelection();
    if (selection.length == 0) return;
    await clipboard.writeText(transform(selection));
    Frontend.setStatus($_('msg.copied'));
};

function hasSelection(n = 0) {
    return Editing.getSelection().length > n;
}

export function hasFocus() {
    return Editing.getFocusedEntry() instanceof SubtitleEntry;
}

function selectionDistinctStyles() {
    const styles = Editing.getSelection().map((x) => [...x.texts.keys()]).flat();
    return Source.subs.styles.filter((x) => styles.includes(x));
}

function selectionCanCombine() {
    const styles = Editing.getSelection().map((x) => [...x.texts.keys()]).flat();
    const distinctStyles = Source.subs.styles.filter((x) => styles.includes(x));
    return styles.length == distinctStyles.length;
}

function selectionCommonStyles() {
    const selection = Editing.getSelection();
    return Source.subs.styles
        .filter((x) => selection.every((y) => y.texts.has(x)));
}

function notSelectionCommonStyles() {
    const common = selectionCommonStyles();
    return Source.subs.styles.filter((x) => !common.includes(x));
}

export function forEachStyle(h: (style: SubtitleStyle) => void, styles = Source.subs.styles) {
    return styles.map((style) => ({
        name: style.name,
        call: () => h(style)
    }));
}

function doubleForEachStyle(
    styles1: SubtitleStyle[],
    styles2: SubtitleStyle[],
    menuName: () => string,
    h: (a: SubtitleStyle, b: SubtitleStyle) => void,
    skipSame = true
) {
    return styles1.map((x) => ({
        name: x.name, menuName,
        items: (skipSame ? styles2.filter((y) => y != x) : styles2).map((y) => ({
            name: y.name,
            call: () => h(x, y)
        }))
    }));
}

export const BasicCommands = {
    editThisEntry: new UICommand(() => $_('category.editing'),
        [ CommandBinding.from(['Enter'], ['Table', 'Timeline']), ],
    {
        name: () => $_('action.edit-this-entry'),
        isApplicable: () => Editing.getFocusedEntry() !== null,
        call() {
            const focusedEntry = Editing.getFocusedEntry();
            if (focusedEntry == 'virtual')
                Editing.startEditingNewVirtualEntry();
            else
                Editing.startEditingFocusedEntry();
        }
    }),
    editNextEntry: new UICommand(() => $_('category.editing'),
        [ CommandBinding.from(['Enter'], ['EditingField']), ],
    {
        name: () => $_('action.edit-next-entry'),
        isApplicable: hasFocus,
        call() {
            const focusedEntry = Editing.getFocusedEntry();
            if (!(focusedEntry instanceof SubtitleEntry)) return;
            Editing.submitFocusedEntry();
            let i = Source.subs.entries.indexOf(focusedEntry) + 1;
            if (i == Source.subs.entries.length)
                Editing.startEditingNewVirtualEntry();
            else
                Editing.offsetFocus(1, SelectMode.Single, 
                    InputConfig.data.enterNavigationType == 'keepPosition' 
                    ? KeepInViewMode.SamePosition 
                    : KeepInViewMode.KeepInSight);
        }
    }),
    focusOnTable: new UICommand(() => $_('category.editing'),
        [ CommandBinding.from(['Escape'], ['EditingField']), ],
    {
        name: () => $_('action.focus-on-table'),
        call() {
            if (Editing.focused.control) {
                Editing.focused.control.blur();
                Frontend.uiFocus.set('Table');
            }
        }
    }),

    openSearch: new UICommand(() => $_('category.search'),
        [ CommandBinding.from(['CmdOrCtrl+F']), ],
    {
        name: () => $_('action.open-search'),
        call() {
            Toolboxes.search!.focus();
        }
    }),
    findNext: new UICommand(() => $_('category.search'),
        [ CommandBinding.from(['CmdOrCtrl+G']), ],
    {
        name: () => $_('action.find-next'),
        call: () => Toolboxes.search!.execute('select', 'next')
    }),
    findPrevious: new UICommand(() => $_('category.search'),
        [ CommandBinding.from(['CmdOrCtrl+Shift+G']), ],
    {
        name: () => $_('action.find-previous'),
        call: () => Toolboxes.search!.execute('select', 'previous')
    }),
    replaceNext: new UICommand(() => $_('category.search'),
        [ CommandBinding.from(['CmdOrCtrl+H']), ],
    {
        name: () => $_('action.replace-next'),
        call: () => Toolboxes.search!.execute('replace', 'next')
    }),
    replacePrevious: new UICommand(() => $_('category.search'),
        [ CommandBinding.from(['CmdOrCtrl+Shift+H']), ],
    {
        name: () => $_('action.replace-previous'),
        call: () => Toolboxes.search!.execute('replace', 'previous')
    }),
    
    playEntry: new UICommand(() => $_('category.media'),
        [ CommandBinding.from(['P'], ['Table', 'Timeline']),
          CommandBinding.from(['Alt+P']), ],
    {
        name: () => $_('action.play-entry'),
        async call() {
            if (Playback.player === null) return;
            const current = Editing.selection.focused;
            if (current === null) return;
            Playback.playArea.override = {
                start: current.start,
                end: current.end,
                loop: false
            };
            await Playback.forceSetPosition(current.start);
            await Basic.waitUntil(() => !Playback.player!.isPreloading);
            await Playback.play(true);
        }
    }),

    copyJSON: new UICommand(() => $_('category.editing'),
        [ CommandBinding.from(['CmdOrCtrl+C'], ['Table', 'Timeline']) ],
    {
        name: () => $_('action.copy-json'),
        isApplicable: hasSelection,
        call: () => copySelection(toJSON)
    }),
    copySRT: new UICommand(() => $_('category.editing'),
        [ ],
    {
        name: () => $_('action.copy-srt'),
        isApplicable: hasSelection,
        call: () => copySelection(toSRT)
    }),
    copyASS: new UICommand(() => $_('category.editing'),
        [ ],
    {
        name: () => $_('action.copy-ass'),
        isApplicable: hasSelection,
        call: () => copySelection(toASS)
    }),
    copyPlaintext: new UICommand(() => $_('category.editing'),
        [ ],
    {
        name: () => $_('action.copy-plaintext'),
        isApplicable: hasSelection,
        call: () => copySelection(toPlaintext)
    }),
    copyMenu: new UICommand(() => $_('category.editing'),
        [ ],
    {
        name: () => $_('action.copy'),
        isApplicable: hasSelection,
        items: [
            {
                name: () => $_('cxtmenu.json-internal'),
                call: () => copySelection(toJSON)
            }, {
                name: () => $_('cxtmenu.srt'),
                call: () => copySelection(toSRT)
            }, {
                name: () => $_('cxtmenu.ass-fragment'),
                call: () => copySelection(toASS)
            }, {
                name: () => $_('cxtmenu.plain-text'),
                call: () => copySelection(toPlaintext)
            }
        ]
    }),
    copyChannelText: new UICommand(() => $_('category.editing'),
        [ ],
    {
        name: () => $_('action.copy-text'),
        isApplicable: hasSelection,
        items: () => forEachStyle((style) => {
            let selection = Editing.getSelection();
            if (selection.length == 0) return;
            let results: string[] = [];
            selection.forEach((x) => {
                let text = x.texts.get(style);
                if (text) results.push(text);
            })
            clipboard.writeText(results.join(' '));
            Frontend.setStatus($_('msg.copied'));
        }, selectionDistinctStyles()),
        emptyText: () => $_('msg.no-available-item')
    }),
    cut: new UICommand(() => $_('category.editing'),
        [ CommandBinding.from(['CmdOrCtrl+X'], ['Table']) ],
    {
        name: () => $_('action.cut'),
        isApplicable: hasSelection,
        async call() {
            await copySelection(toJSON);
            Editing.deleteSelection();
        }
    }),
    paste: new UICommand(() => $_('category.editing'),
        [ CommandBinding.from(['CmdOrCtrl+V'], ['Table']) ],
    {
        name: () => $_('action.paste'),
        async call() {
            const source = await clipboard.readText();
            if (!source) return;
            let portion = parseSubtitleSource(source);
            if (!portion) {
                Frontend.setStatus($_('msg.failed-to-parse-clipboard-data-as-subtitles'), 'error');
                return;
            }
            let position: number;
            if (Editing.selection.submitted.size > 0 || Editing.selection.focused) {
                position = Source.subs.entries.findIndex(
                    (x) => Editing.selection.submitted.has(x) 
                        || Editing.selection.currentGroup.has(x));
                Editing.clearSelection();
            } else position = Source.subs.entries.length;

            let entries = SubtitleUtil.merge(Source.subs, portion, {
                position: 'Custom',
                customPosition: position,
                style: portion.migrated == 'text' ? 'UseOverrideForAll' : 'KeepDifferent',
                overrideStyle: Source.subs.defaultStyle
            });
            if (entries.length > 0) {
                Editing.setSelection(entries);
                Source.markChanged(ChangeType.General);
                Frontend.setStatus($_('msg.pasted'));
            } else {
                Frontend.setStatus($_('msg.nothing-to-paste'), 'error');
            }
        },
    }),
    deleteSelection: new UICommand(() => $_('category.editing'),
        [ CommandBinding.from(['Delete'], ['Table', 'Timeline']),
          CommandBinding.from(['CmdOrCtrl+Backspace'], ['Table', 'Timeline']),
          CommandBinding.from(['Alt+Delete']),
          CommandBinding.from(['CmdOrCtrl+Alt+Backspace']), ],
    {
        name: () => $_('action.delete'),
        isApplicable: hasSelection,
        call: () => Editing.deleteSelection(),
    }),
    selectAll: new UICommand(() => $_('category.editing'),
        [ CommandBinding.from(['CmdOrCtrl+A'], ['Table', 'Timeline']) ],
    {
        name: () => $_('action.select-all'),
        call() {
            Editing.selection.focused = null;
            Editing.selection.currentGroup.clear();
            for (let e of Source.subs.entries)
                Editing.selection.submitted.add(e);
            Editing.onSelectionChanged.dispatch(ChangeCause.Action);
        },
    }),
    selectByChannel: new UICommand(() => $_('category.editing'),
        [ ],
    {
        name: () => $_('action.select-all-by-channel'),
        isApplicable: hasSelection,
        items: () => forEachStyle((style) => {
            Editing.selection.currentGroup.clear();
            Editing.selection.focused = null;
            Editing.selection.submitted = new Set(
                Source.subs.entries.filter((e) => e.texts.has(style)));
            Editing.onSelectionChanged.dispatch(ChangeCause.Action);
        }, selectionDistinctStyles()),
        emptyText: () => $_('msg.no-available-item')
    }),
    invertSelection: new UICommand(() => $_('category.editing'),
        [ ],
    {
        name: () => $_('action.invert-selection'),
        isApplicable: hasSelection,
        call() {
            let newSelection = new Set<SubtitleEntry>;
            let oldSelection = new Set(Editing.getSelection());
            for (let e of Source.subs.entries)
                if (!oldSelection.has(e)) newSelection.add(e);
            Editing.clearFocus();
            Editing.selection.focused = null;
            Editing.selection.currentGroup.clear();
            Editing.selection.submitted = newSelection;
            Editing.onSelectionChanged.dispatch(ChangeCause.Action);
        },
    }),
    insertBeforeFocus: new UICommand(() => $_('category.editing'),
        [ ],
    {
        name: () => $_('action.insert-before'),
        isApplicable: hasFocus,
        call() {
            const ent = Editing.getFocusedEntry();
            Debug.assert(ent instanceof SubtitleEntry);
            const index = Source.subs.entries.indexOf(ent);
            Debug.assert(index >= 0);

            const pos = get(Playback.isLoaded) ? Playback.position : Infinity;
            let start: number, end: number;
            if (Source.subs.entries.length == 0) {
                start = 0;
                end = 2;
            } else if (index == 0) {
                let first = Source.subs.entries[0];
                start = Math.max(Math.min(pos, first.start - 2), 0);
                end = Math.min(start + 2, first.start);
            } else {
                Debug.assert(ent !== undefined);
                let last = Source.subs.entries[index - 1];
                if (last.end <= ent.start) {
                    start = Math.max(Math.min(pos, ent.start - 2), last.end);
                    end = Math.min(start + 2, ent.start);
                } else {
                    start = Math.max(Math.min(pos, ent.start - 2), 0);
                    end = Math.min(start + 2, ent.start);
                }
            }
            Editing.insertEntry(ent.texts.keys(), start, end, index);
            Source.markChanged(ChangeType.Times);
        },
    }),
    insertAfterFocus: new UICommand(() => $_('category.editing'),
        [ CommandBinding.from(['CmdOrCtrl+Enter'], ['Table', 'EditingField']), ],
    {
        name: () => $_('action.insert-after'),
        call() {
            let ent = Editing.getFocusedEntry();
            if (!(ent instanceof SubtitleEntry)) ent = null;
            let index = ent ? Source.subs.entries.indexOf(ent) + 1 : Source.subs.entries.length;
            Debug.assert(index >= 0);

            const pos = get(Playback.isLoaded) ? Playback.position : Infinity;
            let start: number, end: number;
            if (index == Source.subs.entries.length) {
                let last = Source.subs.entries.at(-1);
                start = Math.max(pos, last?.end ?? 0);
                end = start + 2;
            } else {
                Debug.assert(ent !== null);
                let next = Source.subs.entries[index];
                if (next.start >= ent.end) {
                    start = Math.max(Math.min(next.start, pos), ent.end);
                    end = Math.min(start + 2, next.start);
                } else {
                    start = ent.end;
                    end = start + 2;
                }
            }
            Editing.insertEntry(ent?.texts?.keys() ?? undefined, start, end, index);
            Source.markChanged(ChangeType.Times);
        },
    }),
    moveUp: new UICommand(() => $_('category.editing'),
        [ CommandBinding.from(['CmdOrCtrl+ArrowUp'], ['EditingField', 'Table']) ],
    {
        name: () => $_('action.move-up'),
        isApplicable: () => hasSelection() && !Utils.isSelectionDisjunct(),
        call: () => Utils.moveSelectionContinuous(-1),
    }),
    moveDown: new UICommand(() => $_('category.editing'),
        [ CommandBinding.from(['CmdOrCtrl+ArrowDown'], ['EditingField', 'Table']) ],
    {
        name: () => $_('action.move-down'),
        isApplicable: () => hasSelection() && !Utils.isSelectionDisjunct(),
        call: () => Utils.moveSelectionContinuous(1),
    }),
    moveToBeginning: new UICommand(() => $_('category.editing'),
        [ ],
    {
        name: () => $_('action.move-to-beginning'),
        isApplicable: () => hasSelection(),
        call: () => Utils.moveSelectionTo('beginning'),
    }),
    moveToEnd: new UICommand(() => $_('category.editing'),
        [ ],
    {
        name: () => $_('action.move-to-end'),
        isApplicable: () => hasSelection(),
        call: () => Utils.moveSelectionTo('end'),
    }),
    moveMenu: new UICommand(() => $_('category.editing'),
        [],
    {
        name: () => $_('action.move'),
        items: [
            {
                name: () => $_('action.up'),
                isApplicable: () => hasSelection() && !Utils.isSelectionDisjunct(),
                call: () => Utils.moveSelectionContinuous(-1),
            }, {
                name: () => $_('action.down'),
                isApplicable: () => hasSelection() && !Utils.isSelectionDisjunct(),
                call: () => Utils.moveSelectionContinuous(1),
            }, {
                name: () => $_('action.to-the-beginning'),
                isApplicable: () => hasSelection(),
                call: () => Utils.moveSelectionTo('beginning'),
            }, {
                name: () => $_('action.to-the-end'),
                isApplicable: () => hasSelection(),
                call: () => Utils.moveSelectionTo('end'),
            }
        ]
    }),
    combineIntoOneEntry: new UICommand(() => $_('category.editing'),
        [],
    {
        name: () => $_('action.combine'),
        isApplicable: () => hasSelection(1) && selectionCanCombine(),
        call() {
            const selection = Editing.getSelection();
            const first = selection[0];
            for (const entry of selection.slice(1)) {
                for (const [style, text] of entry.texts)
                    first.texts.set(style, text);
                const index = Source.subs.entries.indexOf(entry);
                Debug.assert(index >= 0);
                Source.subs.entries.splice(index, 1);
            }
            Source.markChanged(ChangeType.Times);
        },
    }),
    splitChannels: new UICommand(() => $_('category.editing'),
        [],
    {
        name: () => $_('action.split-simultaneous'),
        isApplicable: () => hasSelection(),
        call() {
            const selection = Editing.getSelection();
            let newSelection: SubtitleEntry[] = [];
            for (let i = 0; i < selection.length; i++) {
                let entry = selection[i];
                let index = Source.subs.entries.indexOf(entry);
                let newEntries: SubtitleEntry[] = [];
                for (const style of Source.subs.styles) {
                    const text = entry.texts.get(style);
                    if (text !== undefined) {
                        let newEntry = new SubtitleEntry(entry.start, entry.end);
                        newEntry.texts.set(style, text);
                        newEntries.push(newEntry);
                    }
                }
                Source.subs.entries.splice(index, 1, ...newEntries);
                newSelection.push(...newEntries);
            }
            if (newSelection.length != selection.length) {
                Editing.clearSelection();
                for (let ent of newSelection)
                    Editing.selection.submitted.add(ent);
                Source.markChanged(ChangeType.Times);
            }
        },
    }),
    connectAll: new UICommand(() => $_('category.editing'),
        [],
    {
        name: () => $_('action.connect-all'),
        isApplicable: () => hasSelection(1),
        call: () => Utils.mergeEntries(Editing.getSelection(), true),
    }),
    connectKeepingFirstOnly: new UICommand(() => $_('category.editing'),
        [],
    {
        name: () => $_('action.connect-keeping-first-only'),
        isApplicable: () => hasSelection(1),
        call: () => Utils.mergeEntries(Editing.getSelection(), false),
    }),
    connectMenu: new UICommand(() => $_('category.editing'),
        [],
    {
        name: () => $_('action.merge-entries'),
        items: [
            {
                name: () => $_('action.connect-all'),
                isApplicable: () => hasSelection(1),
                call: () => Utils.mergeEntries(Editing.getSelection(), true),
            }, {
                name: () => $_('action.keep-first-only'),
                isApplicable: () => hasSelection(1),
                call: () => Utils.mergeEntries(Editing.getSelection(), false),
            }
        ]
    }),
    label: new UICommand(() => $_('category.editing'),
        [],
    {
        name: () => $_('action.label'),
        isApplicable: hasSelection,
        items: Labels.map((x) => ({
            name: () => $_(`label.${x}`),
            call() {
                for (let entry of Editing.getSelection())
                    entry.label = x;
                Source.markChanged(ChangeType.InPlace);
            },
        }))
    }),
    transformTimes: new UICommand(() => $_('category.tool'),
        [],
    {
        name: () => $_('action.transform-times'),
        isDialog: true,
        async call() {
            let options = await Dialogs.timeTransform.showModal!();
            if (options && SubtitleUtil.shiftTimes(Source.subs, options))
                Source.markChanged(ChangeType.Times);
        },
    }),
    sortSelectionByTime: new UICommand(() => $_('category.tool'),
        [],
    {
        name: () => $_('action.sort-by-time'),
        isApplicable: () => hasSelection(1) && !Utils.isSelectionDisjunct(),
        call() {
            const selection = Editing.getSelection();
            // assumes selection is not disjunct
            let start = Source.subs.entries.indexOf(selection[0]);
            if (start < 0) return Debug.early();
            let positionMap = new Map<SubtitleEntry, number>();
            for (let i = 0; i < Source.subs.entries.length; i++)
                positionMap.set(Source.subs.entries[i], i);
            selection.sort((a, b) => a.start - b.start);
            Source.subs.entries.splice(start, selection.length, ...selection);
            Source.markChanged(ChangeType.Order);
        },
    }),
    createChannel: new UICommand(() => $_('category.editing'),
        [],
    {
        name: () => $_('action.create-channel'),
        isApplicable: () => hasSelection() && notSelectionCommonStyles().length > 0,
        items: () => forEachStyle((x) => {
            const selection = Editing.getSelection();
            let done = false;
            for (let ent of selection)
                if (!ent.texts.has(x)) {
                    ent.texts.set(x, '');
                    done = true;
                }
            if (done) Source.markChanged(ChangeType.InPlace);
        }, notSelectionCommonStyles()),
        emptyText: () => $_('msg.no-available-item')
    }),
    removeChannel: new UICommand(() => $_('category.editing'),
        [],
    {
        name: () => $_('action.remove-channel'),
        isApplicable: () => hasSelection(),
        items: () => forEachStyle(
            (x) => Utils.removeStyle(Editing.getSelection(), x), 
            selectionDistinctStyles()),
        emptyText: () => $_('msg.no-available-item')
    }),
    removeNewlines: new UICommand(() => $_('category.tool'),
        [],
    {
        name: () => $_('action.remove-newlines'),
        isApplicable: () => hasSelection(),
        items: () => forEachStyle(
            (x) => Utils.removeNewlines(Editing.getSelection(), x), 
            selectionDistinctStyles()),
        emptyText: () => $_('msg.no-available-item')
    }),
    removeBlankChannels: new UICommand(() => $_('category.tool'),
        [],
    {
        name: () => $_('action.remove-empty'),
        isApplicable: () => hasSelection(),
        call() {
            const selection = Editing.getSelection();
            let done = 0;
            for (const ent of selection) {
                for (const [style, text] of ent.texts) {
                    if (text === '') {
                        ent.texts.delete(style);
                        done++;
                    }
                    if (ent.texts.size == 0) {
                        Source.subs.entries.splice(
                            Source.subs.entries.indexOf(ent), 1);
                    }
                }
            }
            Frontend.setStatus($_('msg.changed-n-entries', {values: {n: done}}));
            if (done) Source.markChanged(ChangeType.Times);
        },
    }),
    replaceChannel: new UICommand(() => $_('category.editing'),
        [],
    {
        name: () => $_('action.replace-channel'),
        isApplicable: () => hasSelection() && Source.subs.styles.length > 1,
        items: () => doubleForEachStyle(
            selectionDistinctStyles(), Source.subs.styles,
            () => $_('cxtmenu.by'),
            (x, y) => Utils.replaceStyle(Editing.getSelection(), x, y)
        ),
        emptyText: () => $_('msg.no-available-item')
    }),
    exchangeChannel: new UICommand(() => $_('category.editing'),
        [],
    {
        name: () => $_('action.exchange-channel'),
        isApplicable: () => hasSelection() && selectionDistinctStyles().length > 1,
        items: () => doubleForEachStyle(
            selectionDistinctStyles(), selectionDistinctStyles(),
            () => $_('cxtmenu.and'),
            (x, y) => Utils.exchangeStyle(Editing.getSelection(), x, y)
        ),
        emptyText: () => $_('msg.no-available-item')
    }),
    mergeChannel: new UICommand(() => $_('category.editing'),
        [],
    {
        name: () => $_('action.merge-channel'),
        isApplicable: () => hasSelection() && selectionDistinctStyles().length > 1,
        items: () => doubleForEachStyle(
            selectionDistinctStyles(), selectionDistinctStyles(),
            () => $_('cxtmenu.and'),
            (x, y) => Utils.mergeStyle(Editing.getSelection(), x, y)
        ),
        emptyText: () => $_('msg.no-available-item')
    }),
    mergeDuplicates: new UICommand(() => $_('category.tool'),
        [],
    {
        name: () => $_('action.merge-overlapping-duplicates'),
        isApplicable: () => hasSelection(1),
        call: () => Utils.mergeDuplicate(Editing.getSelection())
    }),
    fixOverlap: new UICommand(() => $_('category.tool'),
        [],
    {
        name: () => $_('action.fix-erroneous-overlapping'),
        isApplicable: () => hasSelection(1),
        call: () => Utils.fixOverlap(Editing.getSelection())
    }),
};

KeybindingManager.register(BasicCommands);