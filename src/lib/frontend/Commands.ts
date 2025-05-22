import { Interface } from "./Interface";
import { binding } from "./Keybinding";
import { UICommand } from "./CommandBase";

import { _, unwrapFunctionStore } from 'svelte-i18n';
import { get } from "svelte/store";
import { Debug } from "../Debug";
import * as clipboard from "@tauri-apps/plugin-clipboard-manager";
import { LinearFormatCombineStrategy, SubtitleUtil } from "../core/SubtitleUtil.svelte";
import { Editing, KeepInViewMode, SelectMode } from "./Editing";
import { parseSubtitleSource } from "./Frontend";
import { EventHost } from "../details/EventHost";
import { Source, ChangeType, ChangeCause } from "./Source";
import { Labels, SubtitleEntry, Subtitles, type SubtitleStyle } from "../core/Subtitles.svelte";
import { Playback } from "./Playback";
import { Utils } from "./Utils";
import { Dialogs } from "./Dialogs";
import { InputConfig } from "../config/Groups";
import { Basic } from "../Basic";
import { PrivateConfig } from "../config/PrivateConfig";
import { Format } from "../core/Formats";
import { Toolboxes } from "./Toolboxes";
const $_ = unwrapFunctionStore(_);

const toJSON = (useEntries: SubtitleEntry[]) => 
    Format.JSON.write(Source.subs, { useEntries });
const toASS = (useEntries: SubtitleEntry[]) => 
    Format.ASS.write(Source.subs, { useEntries });

const toSRT = (useEntries: SubtitleEntry[]) => 
    Format.SRT.write(Source.subs, 
        { useEntries, combine: LinearFormatCombineStrategy.Recombine });
const toPlaintext = (useEntries: SubtitleEntry[]) => 
    Format.plaintext.write(Source.subs, 
        { useEntries, combine: LinearFormatCombineStrategy.KeepOrder });

async function copySelection(transform: (use: SubtitleEntry[]) => string) {
    let selection = Editing.getSelection();
    if (selection.length == 0) return;
    await clipboard.writeText(transform(selection));
    Interface.setStatus($_('msg.copied'));
};

function hasSelection(n = 0) {
    return Editing.getSelection().length > n;
}

function hasFocus() {
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
    const styles = selection.map((x) => [...x.texts.keys()]).flat();
    const distinctStyles = Source.subs.styles.filter((x) => styles.includes(x));
    const commonStyles = distinctStyles
        .filter((x) => selection.every((y) => y.texts.has(x)));
    return Source.subs.styles.filter((x) => !commonStyles.includes(x));
}

function notSelectionCommonStyles() {
    const common = selectionCommonStyles();
    const notCommon = Source.subs.styles.filter((x) => !common.includes(x));
    return notCommon;
}

function forEachStyle(h: (style: SubtitleStyle) => void, styles = Source.subs.styles) {
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

export const Commands = {
    undo: new UICommand(() => $_('category.document'),
        [ binding(['CmdOrCtrl+Z'], ['Table', 'Timeline']),
          binding(['CmdOrCtrl+Alt+Z']) ],
    {
        name: () => $_('menu.undo'),
        isApplicable: () => Source.canUndo(),
        call: () => { Source.undo() }
    }),
    redo: new UICommand(() => $_('category.document'),
        [ binding(['CmdOrCtrl+Shift+Z'], ['Table', 'Timeline']),
          binding(['CmdOrCtrl+Alt+Shift+Z']) ],
    {
        name: () => $_('menu.redo'),
        isApplicable: () => Source.canRedo(),
        call: () => { Source.redo() }
    }),
    newFile: new UICommand(() => $_('category.document'),
        [ binding(['CmdOrCtrl+N']) ],
    {
        name: () => $_('menu.new-file'),
        call: async () => { 
            if (await Interface.warnIfNotSaved())
                Interface.newFile();
        }
    }),
    openMenu: new UICommand(() => $_('category.document'),
        [ binding(['CmdOrCtrl+O']), ],
    {
        name: () => $_('menu.open'),
        items: () => {
            const paths = PrivateConfig.get('paths');
            return [
                {
                    name: () => $_('cxtmenu.other-file'),
                    isDialog: true,
                    async call() {
                        if (await Interface.warnIfNotSaved())
                            Interface.askOpenFile();
                    },
                },
                ...(paths.length == 0 ? [
                    {
                        name: $_('cxtmenu.no-recent-files'),
                        isApplicable: () => false,
                        call() {}
                    }
                    ] : paths.map((x) => ({
                        name: '[...]/' + x.name.split(Basic.pathSeparator)
                            .slice(-2).join(Basic.pathSeparator),
                        async call() {
                            if (await Interface.warnIfNotSaved())
                                Interface.openFile(x.name);
                        }
                    }))
                ),
            ]
        }
    }),
    openVideo: new UICommand(() => $_('category.document'),
        [ binding(['CmdOrCtrl+Shift+O']), ],
    {
        name: () => $_('menu.open-video'),
        isDialog: true,
        call: () => Interface.askOpenVideo()
    }),
    closeVideo: new UICommand(() => $_('category.document'),
        [ ],
    {
        name: () => $_('menu.close-video'),
        isApplicable: () => get(Playback.isLoaded),
        call: () => Playback.close()
    }),
    import: new UICommand(() => $_('category.document'),
        [ binding(['CmdOrCtrl+I']), ],
    {
        name: () => $_('menu.import'),
        isDialog: true,
        call: () => Interface.askImportFile()
    }),
    exportASS: new UICommand(() => $_('category.document'),
        [ ],
    {
        name: () => $_('menu.export-ass'),
        isDialog: true,
        call: () => Interface.askExportFile('ass', (x) => Format.ASS.write(x))
    }),
    exportSRTPlaintext: new UICommand(() => $_('category.document'),
        [ ],
    {
        name: () => $_('menu.export-srt-plaintext'),
        isDialog: true,
        call: async () => {
            const result = await Dialogs.export.showModal!();
            if (!result) return;
            Interface.askExportFile(result.ext, () => result.content);
        }
    }),
    exportMenu: new UICommand(() => $_('category.document'),
        [ ],
    {
        name: () => $_('menu.export'),
        items: [
            {
                name: () => 'ASS',
                call: () => {Commands.exportASS.call()}
            },
            {
                name: () => $_('cxtmenu.srt-plaintext'),
                call: () => {Commands.exportSRTPlaintext.call()}
            }
        ]
    }),
    save: new UICommand(() => $_('category.document'),
        [ binding(['CmdOrCtrl+S']), ],
    {
        name: () => $_('action.save'),
        call: () => Interface.askSaveFile()
    }),
    saveAs: new UICommand(() => $_('category.document'),
        [ binding(['CmdOrCtrl+Shift+S']), ],
    {
        name: () => $_('menu.save-as'),
        isDialog: true,
        call: () => Interface.askSaveFile(true)
    }),
    openConfiguration: new UICommand(() => $_('category.system'),
        [ ],
    {
        name: () => $_('menu.configuration'),
        isDialog: true,
        call: () => Dialogs.configuration.showModal!()
    }),
    openKeybinding: new UICommand(() => $_('category.system'),
        [ ],
    {
        name: () => $_('menu.keybinding'),
        isDialog: true,
        call: () => Dialogs.keybinding.showModal!()
    }),
    previousEntrySingle: new UICommand(() => $_('category.table'),
        [ binding(['ArrowUp'], ['Table']),
          binding(['Alt+ArrowUp']), ],
    {
        name: () => $_('action.previous-entry-single'),
        call: () => Editing.offsetFocus(-1, SelectMode.Single, 
            InputConfig.data.arrowNavigationType == 'keepPosition' 
            ? KeepInViewMode.SamePosition 
            : KeepInViewMode.KeepInSight)
    }),
    previousEntrySequence: new UICommand(() => $_('category.table'),
        [ binding(['Shift+ArrowUp'], ['Table']),
          binding(['Alt+Shift+ArrowUp']), ],
    {
        name: () => $_('action.previous-entry-sequence'),
        call: () => Editing.offsetFocus(-1, SelectMode.Sequence, 
            InputConfig.data.arrowNavigationType == 'keepPosition' 
            ? KeepInViewMode.SamePosition 
            : KeepInViewMode.KeepInSight)
    }),
    nextEntrySingle: new UICommand(() => $_('category.table'),
        [ binding(['ArrowDown'], ['Table']),
          binding(['Alt+ArrowDown']), ],
    {
        name: () => $_('action.next-entry-single'),
        call: () => Editing.offsetFocus(1, SelectMode.Single, 
            InputConfig.data.arrowNavigationType == 'keepPosition' 
            ? KeepInViewMode.SamePosition 
            : KeepInViewMode.KeepInSight)
    }),
    nextEntrySequence: new UICommand(() => $_('category.table'),
        [ binding(['Shift+ArrowDown'], ['Table']),
          binding(['Alt+Shift+ArrowDown']), ],
    {
        name: () => $_('action.next-entry-sequence'),
        call: () => Editing.offsetFocus(1, SelectMode.Sequence, 
            InputConfig.data.arrowNavigationType == 'keepPosition' 
            ? KeepInViewMode.SamePosition 
            : KeepInViewMode.KeepInSight)
    }),
    editThisEntry:new UICommand(() => $_('category.editing'),
        [ binding(['Enter'], ['Table', 'Timeline']), ],
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
        [ binding(['Enter'], ['EditingField']), ],
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
        [ binding(['Escape'], ['EditingField']), ],
    {
        name: () => $_('action.focus-on-table'),
        call() {
            if (Editing.focused.control) {
                Editing.focused.control.blur();
                Interface.uiFocus.set('Table');
            }
        }
    }),

    openSearch: new UICommand(() => $_('category.search'),
        [ binding(['CmdOrCtrl+F']), ],
    {
        name: () => $_('action.open-search'),
        call() {
            Toolboxes.search!.focus();
        }
    }),
    findNext: new UICommand(() => $_('category.search'),
        [ binding(['CmdOrCtrl+G']), ],
    {
        name: () => $_('action.find-next'),
        call: () => Toolboxes.search!.execute('select', 'next')
    }),
    findPrevious: new UICommand(() => $_('category.search'),
        [ binding(['CmdOrCtrl+Shift+G']), ],
    {
        name: () => $_('action.find-previous'),
        call: () => Toolboxes.search!.execute('select', 'previous')
    }),
    replaceNext: new UICommand(() => $_('category.search'),
        [ binding(['CmdOrCtrl+H']), ],
    {
        name: () => $_('action.replace-next'),
        call: () => Toolboxes.search!.execute('replace', 'next')
    }),
    replacePrevious: new UICommand(() => $_('category.search'),
        [ binding(['CmdOrCtrl+Shift+H']), ],
    {
        name: () => $_('action.replace-previous'),
        call: () => Toolboxes.search!.execute('replace', 'previous')
    }),

    togglePlay: new UICommand(() => $_('category.media'),
        [ binding(['Space'], ['Table', 'Timeline']),
          binding(['Alt+Space']), ],
    {
        name: () => $_('action.toggle-play'),
        call: () => Playback.toggle()
    }),
    toggleInPoint: new UICommand(() => $_('category.media'),
        [ binding(['I'], ['Table', 'Timeline']),
          binding(['Alt+I']), ],
    {
        name: () => $_('action.toggle-in-point'),
        call() {
            const pos = Playback.position;
            Playback.playArea.update((area) => {
                area.start = 
                    (area.start == pos || (area.end !== undefined && area.end <= pos)) 
                    ? undefined : pos;
                return area;
            });
        }
    }),
    toggleOutPoint: new UICommand(() => $_('category.media'),
        [ binding(['O'], ['Table', 'Timeline']),
          binding(['Alt+O']), ],
    {
        name: () => $_('action.toggle-out-point'),
        call() {
            const pos = Playback.position;
            Playback.playArea.update((area) => {
                area.end =
                    (area.end == pos || (area.start !== undefined && area.start >= pos)) 
                    ? undefined : pos;
                return area;
            });
        }
    }),
    playEntry: new UICommand(() => $_('category.media'),
        [ binding(['P'], ['Table', 'Timeline']),
          binding(['Alt+P']), ],
    {
        name: () => $_('action.play-entry'),
        async call() {
            if (Playback.video === null) return;
            const current = Editing.selection.focused;
            if (current === null) return;
            Playback.playAreaOverride = {
                start: current.start,
                end: current.end,
                loop: false
            };
            await Playback.forceSetPosition(current.start);
            await Basic.waitUntil(() => !Playback.video!.isPreloading);
            await Playback.play(true);
        }
    }),
    previousFrame: new UICommand(() => $_('category.media'),
        [ binding(['CmdOrCtrl+ArrowLeft'], ['Timeline']),
          binding(['Alt+CmdOrCtrl+ArrowLeft']), ],
    {
        name: () => $_('action.previous-frame'),
        call: () => Playback.video?.requestPreviousFrame()
    }),
    nextFrame: new UICommand(() => $_('category.media'),
        [ binding(['CmdOrCtrl+ArrowRight'], ['Timeline']),
          binding(['Alt+CmdOrCtrl+ArrowRight']), ],
    {
        name: () => $_('action.next-frame'),
        call: () => Playback.video?.requestNextFrame()
    }),
    jumpBackward: new UICommand(() => $_('category.media'),
        [ binding(['ArrowLeft'], ['Timeline']),
          binding(['Alt+ArrowLeft']), ],
    {
        name: () => $_('action.jump-backward'),
        call: () => Playback.setPosition(Playback.position - InputConfig.data.skipDuration)
    }),
    jumpForward: new UICommand(() => $_('category.media'),
        [ binding(['ArrowRight'], ['Timeline']),
          binding(['Alt+ArrowRight']), ],
    {
        name: () => $_('action.jump-forward'),
        call: () => Playback.setPosition(Playback.position + InputConfig.data.skipDuration)
    }),

    holdToCreateEntry1: new UICommand(() => $_('category.timeline'),
        [ binding(['J'], ['Timeline']) ],
    {
        name: () => $_('action.hold-to-create-entry-1'),
        isApplicable: () => Playback.isPlaying && Editing.activeChannel !== null,
        call: async () => {
            if (Commands.holdToCreateEntry2.activated)
                await Commands.holdToCreateEntry2.end();

            Debug.assert(Editing.activeChannel !== null);
            const pos = Playback.position;
            const entry = Editing.insertAtTime(pos, pos, Editing.activeChannel);
            Playback.onPositionChanged.bind(entry, 
                (newpos) => { entry.end = Math.max(entry.end, newpos) });
            return entry;
        },
        onDeactivate: (entry) => {
            EventHost.unbind(entry);
            Source.markChanged(ChangeType.Times);
        }
    }),
    holdToCreateEntry2: new UICommand(() => $_('category.timeline'),
        [ binding(['K'], ['Timeline']) ],
    {
        name: () => $_('action.hold-to-create-entry-2'),
        isApplicable: () => Playback.isPlaying && Editing.activeChannel !== null,
        call: async () => {
            if (Commands.holdToCreateEntry1.activated)
                await Commands.holdToCreateEntry1.end();
            
            Debug.assert(Editing.activeChannel !== null);
            const pos = Playback.position;
            const entry = Editing.insertAtTime(pos, pos, Editing.activeChannel);
            Playback.onPositionChanged.bind(entry, 
                (newpos) => { entry.end = Math.max(entry.end, newpos) });
            return entry;
        },
        onDeactivate: (entry) => {
            EventHost.unbind(entry);
            Source.markChanged(ChangeType.Times);
        }
    }),

    copyJSON: new UICommand(() => $_('category.editing'),
        [ binding(['CmdOrCtrl+C'], ['Table', 'Timeline']) ],
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
            Interface.setStatus($_('msg.copied'));
        }, selectionDistinctStyles())
    }),
    cut: new UICommand(() => $_('category.editing'),
        [ binding(['CmdOrCtrl+X'], ['Table']) ],
    {
        name: () => $_('action.cut'),
        isApplicable: hasSelection,
        async call() {
            await copySelection(toJSON);
            Editing.deleteSelection();
        }
    }),
    paste: new UICommand(() => $_('category.editing'),
        [ binding(['CmdOrCtrl+V'], ['Table']) ],
    {
        name: () => $_('action.paste'),
        async call() {
            const source = await clipboard.readText();
            if (!source) return;
            let portion = parseSubtitleSource(source);
            if (!portion) {
                Interface.setStatus($_('msg.failed-to-parse-clipboard-data-as-subtitles'), 'error');
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
                Interface.setStatus($_('msg.pasted'));
            } else {
                Interface.setStatus($_('msg.nothing-to-paste'), 'error');
            }
        },
    }),
    deleteSelection: new UICommand(() => $_('category.editing'),
        [ binding(['Delete'], ['Table', 'Timeline']),
          binding(['CmdOrCtrl+Backspace'], ['Table', 'Timeline']),
          binding(['Alt+Delete']),
          binding(['CmdOrCtrl+Alt+Backspace']), ],
    {
        name: () => $_('action.delete'),
        isApplicable: hasSelection,
        call: () => Editing.deleteSelection(),
    }),
    selectAll: new UICommand(() => $_('category.editing'),
        [ binding(['CmdOrCtrl+A'], ['Table']) ],
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
        }, selectionDistinctStyles())
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
        [ binding(['CmdOrCtrl+Enter'], ['Table', 'EditingField']), ],
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
        [ binding(['CmdOrCtrl+ArrowUp'], ['EditingField', 'Table']) ],
    {
        name: () => $_('action.move-up'),
        isApplicable: () => hasSelection() && !Utils.isSelectionDisjunct(),
        call: () => Utils.moveSelectionContinuous(-1),
    }),
    moveDown: new UICommand(() => $_('category.editing'),
        [ binding(['CmdOrCtrl+ArrowDown'], ['EditingField', 'Table']) ],
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
        }, notSelectionCommonStyles())
    }),
    removeChannel: new UICommand(() => $_('category.editing'),
        [],
    {
        name: () => $_('action.remove-channel'),
        isApplicable: () => hasSelection(),
        items: () => forEachStyle(
            (x) => Utils.removeStyle(Editing.getSelection(), x), 
            selectionDistinctStyles())
    }),
    removeNewlines: new UICommand(() => $_('category.tool'),
        [],
    {
        name: () => $_('action.remove-newlines'),
        isApplicable: () => hasSelection(),
        items: () => forEachStyle(
            (x) => Utils.removeNewlines(Editing.getSelection(), x), 
            selectionDistinctStyles())
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
            Interface.setStatus($_('msg.changed-n-entries', {values: {n: done}}));
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
        )
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
        )
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
        )
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
    combineDialog: new UICommand(() => $_('category.tool'),
        [],
    {
        name: () => $_('action.combine-by-matching-time'),
        isDialog: true,
        isApplicable: () => hasSelection(),
        call: () => Dialogs.combine.showModal!()
    }),
    splitDialog: new UICommand(() => $_('category.tool'),
        [],
    {
        name: () => $_('action.split-by-line'),
        isDialog: true,
        isApplicable: () => hasSelection(),
        call: () => Dialogs.splitByLine.showModal!()
    }),
};
