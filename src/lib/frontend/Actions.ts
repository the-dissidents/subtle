import { Menu } from "@tauri-apps/api/menu";
import { Basic } from "../Basic";

import { ASS } from "../core/ASS";
import { type LabelTypes, Labels, SubtitleEntry, SubtitleTools, Subtitles } from "../core/Subtitles.svelte";
import { LinearFormatCombineStrategy, SimpleFormats } from "../core/SimpleFormats";

import { Editing, getSelectMode, SelectMode } from "./Editing";
import { Utils } from "./Utils";
import { ChangeCause, ChangeType, Source } from "./Source";
import { Interface, UIFocus } from "./Interface";
import { Dialogs } from "./Dialogs";
import { Playback } from "./Playback";

const toSRT = (x: Subtitles) => 
    SimpleFormats.export.SRT(x.entries, LinearFormatCombineStrategy.Recombine);
const toPlaintext = (x: Subtitles) => 
    SimpleFormats.export.plaintext(x.entries, LinearFormatCombineStrategy.KeepOrder);

export const Actions = {
    processGlobalKeydown(ev: KeyboardEvent) {
        const ctrlOrMeta = ev.getModifierState(Basic.ctrlKey());
        const inModal = Dialogs.modalOpenCounter > 0;
        const focus = Interface.getUIFocus();
        const focusedEntry = Editing.getFocusedEntry();

        const tableFocused = focus == UIFocus.Table && !inModal;
        const altOrTableOrTimeline = 
            (focus == UIFocus.Timeline || focus == UIFocus.Table || ev.altKey) && !inModal;
        const altOrTimeline = 
            (focus == UIFocus.Timeline || ev.altKey) && !inModal;
        // console.log('KEYDOWN', ev.key, ev.code, inModal, UIFocus[focus]);
        
        if (ev.key == 'Enter' && ctrlOrMeta) {
            // insert after
            ev.preventDefault();
            let focused = focusedEntry instanceof SubtitleEntry ? focusedEntry : undefined;
            Utils.insertEntryAfter(focused);
        }
        else if (ev.key == 'Enter' && tableFocused) {
            // edit this entry
            ev.preventDefault();
            if (focusedEntry == 'virtual')
                Editing.startEditingNewVirtualEntry();
            else
                Editing.startEditingFocusedEntry();
        }
        else if (ev.key == 'a' && ctrlOrMeta && altOrTableOrTimeline) {
            // select all
            Utils.selectAll();
            ev.preventDefault();
        }
        else if ((ev.key == 'Delete' || (ev.key == 'Backspace' && ctrlOrMeta)) 
            && altOrTableOrTimeline) 
        {
            // delete
            Editing.deleteSelection();
            ev.preventDefault();
        }
        else if (ev.key == 'c' && ctrlOrMeta && altOrTableOrTimeline) {
            // copy
            Utils.copySelection();
            ev.preventDefault();
        }
        else if (ev.key == 'v' && ctrlOrMeta && tableFocused) {
            // paste
            Utils.paste();
            ev.preventDefault();
        }
        else if (ev.key == 'x' && ctrlOrMeta && tableFocused) {
            // cut
            Utils.copySelection();
            Editing.deleteSelection();
            ev.preventDefault();
        }
        else if (ev.key == 'z' && ctrlOrMeta && altOrTableOrTimeline) {
            // undo
            ev.preventDefault();
            if (ev.shiftKey)
                Source.redo();
            else
                Source.undo();
        }
        else if (ev.key == 'ArrowUp' && ctrlOrMeta && tableFocused) {
            // move selection up
            ev.preventDefault();
            Utils.moveSelectionContinuous(Editing.getSelection(), -1);
        }
        else if (ev.key == 'ArrowDown' && ctrlOrMeta && tableFocused) {
            // move selection down
            ev.preventDefault();
            Utils.moveSelectionContinuous(Editing.getSelection(), 1);
        }

        else if (ev.key == 's' && ctrlOrMeta) {
            // save
            ev.preventDefault();
            Interface.askSaveFile();
        }

        else if (ev.key == 'ArrowUp' && altOrTableOrTimeline && !ctrlOrMeta) {
            // previous entry
            ev.preventDefault();
            Editing.offsetFocus(-1, getSelectMode(ev));
        }
        else if (ev.key == 'ArrowDown' && altOrTableOrTimeline && !ctrlOrMeta) {
            // next entry
            ev.preventDefault();
            Editing.offsetFocus(1, getSelectMode(ev));
        }
        else if (ev.code == 'Space' && altOrTableOrTimeline) {
            // play/pause
            Playback.toggle();
            ev.preventDefault();
        }
        else if (ev.code == 'KeyI' && altOrTimeline) {
            // in point
            if (Playback.timeline === null) return;
            const pos = Playback.timeline.cursorPos;
            const area = Playback.playArea;
            Playback.playArea.start = 
                (area.start == pos || (area.end !== undefined && area.end <= pos)) 
                ? undefined : pos;
            Playback.timeline.requestRender();
            ev.preventDefault();
        }
        else if (ev.code == 'KeyO' && altOrTimeline) {
            // out point
            if (Playback.timeline === null) return;
            const pos = Playback.timeline.cursorPos;
            const area = Playback.playArea;
            Playback.playArea.end =
                (area.end == pos || (area.start !== undefined && area.start >= pos)) 
                ? undefined : pos;
            Playback.timeline.requestRender();
            ev.preventDefault();
        }
        else if (ev.code == 'KeyP' && altOrTableOrTimeline) {
            // play selected entry
            if (Playback.timeline === null || Playback.video === null) return;
            const current = Editing.selection.focused;
            if (current === null) return;
            Playback.playAreaOverride = {
                start: current.start,
                end: current.end,
                loop: false
            };
            ev.preventDefault();
            (async () => {
                await Playback.forceSetPosition(current.start);
                await Basic.waitUntil(() => !Playback.video!.isPreloading);
                await Playback.play(true);
            })();
        }
        else if (ev.key == 'ArrowLeft' && altOrTimeline) {
            // move backward 1 frame
            ev.preventDefault();
            Playback.video?.requestPreviousFrame();
        }
        else if (ev.key == 'ArrowRight' && altOrTimeline) {
            // move forward 1 frame
            ev.preventDefault();
            Playback.video?.requestNextFrame();
        }
        else if (ev.key == 'ArrowLeft' && ctrlOrMeta && altOrTimeline) {
            // move backward 1s
            Playback.setPosition(Playback.position - 1);
            ev.preventDefault();
        }
        else if (ev.key == 'ArrowRight' && altOrTimeline) {
            // move forward 1s
            Playback.setPosition(Playback.position + 1);
            ev.preventDefault();
        }
        else if (ev.key == 'Enter' && !ev.shiftKey && focus == UIFocus.EditingField){
            // next entry
            ev.preventDefault();
            if (!(focusedEntry instanceof SubtitleEntry)) return;
            Editing.submitFocusedEntry();
            let i = Source.subs.entries.indexOf(focusedEntry) + 1;
            if (i == Source.subs.entries.length)
                Editing.startEditingNewVirtualEntry();
            else
                Editing.offsetFocus(1, SelectMode.Single);
        }
    },

    async contextMenu() {
        let selection = Editing.getSelection();
        if (selection.length == 0) return;
        let isDisjunct = Utils.isSelectionDisjunct();
        let allStyles = [Source.subs.defaultStyle, ...Source.subs.styles];
        let maxLines = Math.max(...selection.map((x) => x.texts.length));
        let label: LabelTypes | undefined = selection[0].label;
        for (const entry of selection) {
            if (entry.label != selection[0].label) {
                label = undefined;
                break;
            }
        }

        let menu = await Menu.new({items: [
        {
            text: 'copy',
            items: [
                {
                    text: 'JSON (internal)',
                    accelerator: `CmdOrCtrl+C`,
                    action: () => Utils.copySelection()
                },
                {
                    text: 'SRT',
                    action: () => Utils.copySelection((x) => toSRT(x))
                },
                {
                    text: 'ASS fragment',
                    action: () => Utils.copySelection(ASS.exportFragment)
                },
                {
                    text: 'plain text',
                    action: () => Utils.copySelection((x) => toPlaintext(x))
                }
            ]
        },
        {
            text: 'cut',
            accelerator: `CmdOrCtrl+X`,
            action: () => {
                Utils.copySelection();
                Editing.deleteSelection();
            }
        },
        {
            text: 'paste',
            accelerator: `${Basic.ctrlKey()}+V`,
            action: () => Utils.paste()
        },
        { item: 'Separator' },
        {
            text: 'delete',
            accelerator: `CmdOrCtrl+Backspace`,
            action: () => Editing.deleteSelection()
        },
        { item: 'Separator' },
        {
            text: 'select all',
            accelerator: `CmdOrCtrl+A`,
            action: () => Utils.selectAll()
        },
        {
            text: 'select all by channel',
            items: allStyles.map((x) => ({
                text: x.name,
                action: () => {
                    Editing.selection.currentGroup = [];
                    Editing.selection.focused = null;
                    Editing.selection.submitted = new Set(
                        Source.subs.entries
                            .filter((e) => e.texts.some((c) => c.style == x)));
                    Editing.onSelectionChanged.dispatch(ChangeCause.Action);
                }
            }))
        },
        {
            text: 'invert selection',
            action: () => Utils.invertSelection()
        },
        { item: 'Separator' },
        {
            text: 'insert before',
            action: () => Utils.insertEntryBefore(selection[0])
        },
        {
            text: 'insert after',
            accelerator: `CmdOrCtrl+Enter`,
            action: () => Utils.insertEntryAfter(selection[0])
        },
        {
            text: 'move',
            enabled: selection.length > 0,
            items: [
                {
                    text: 'up',
                    enabled: !isDisjunct,
                    accelerator: `CmdOrCtrl+Up`,
                    action: () => Utils.moveSelectionContinuous(selection, -1)
                },
                {
                    text: 'down',
                    enabled: !isDisjunct,
                    accelerator: `CmdOrCtrl+Down`,
                    action: () => Utils.moveSelectionContinuous(selection, 1)
                },
                {
                    text: 'to the beginning',
                    action: () => Utils.moveSelectionTo(selection, 'beginning')
                },
                {
                    text: 'to the end',
                    action: () => Utils.moveSelectionTo(selection, 'end')
                }
            ]
        },
        { item: 'Separator' },
        {
            text: 'combine',
            enabled: selection.length > 1,
            action: () => Utils.combineSelection(selection)
        },
        {
            text: 'split simultaneous',
            action: () => Utils.splitSimultaneous(selection)
        },
        {
            text: 'merge entries',
            enabled: !isDisjunct && selection.length > 1,
            items: [
                {
                    text: 'connect all',
                    action: () => Utils.mergeEntries(selection, true)
                },
                {
                    text: 'keep first only',
                    action: () => Utils.mergeEntries(selection, false)
                }
            ]
        },
        { item: 'Separator' },
        {
            text: 'label',
            items: Labels.map((x) => ({
                text: x,
                checked: x === label,
                action: () => {
                    for (let entry of selection)
                        entry.label = x;
                    Source.markChanged(ChangeType.InPlace, ChangeCause.Action);
                }
            }))
        },
        { item: 'Separator' },
        {
            text: 'utilities',
            items: [
                {
                    text: 'transform times...',
                    action: async () => {
                        let options = await Dialogs.timeTransform.showModal!();
                        if (options && Source.subs.shiftTimes(options))
                            Source.markChanged(ChangeType.Times, ChangeCause.Action);
                    }
                },
                { item: 'Separator' },
                {
                    text: 'sort by time',
                    enabled: !isDisjunct && selection.length > 1,
                    action: () => Utils.sortSelection(selection, false)
                },
                {
                    text: 'sort by first style',
                    enabled: !isDisjunct && selection.length > 1,
                    action: () => Utils.sortSelection(selection, true)
                },
                {
                    text: 'sort channels',
                    action: () => Utils.sortChannels(selection)
                },
                { item: 'Separator' },
                {
                    text: 'create channel',
                    items: allStyles.map((x) => ({
                        text: x.name,
                        action: () => {
                            let done = false;
                            for (let ent of selection)
                                if (!ent.texts.find((t) => t.style == x)) {
                                    ent.texts.push({style: x, text: ''});
                                    done = true;
                                }
                            if (done)
                                Source.markChanged(ChangeType.InPlace, ChangeCause.Action);
                        }
                    }))
                },
                {
                    text: 'replace channel',
                    enabled: Source.subs.styles.length > 0,
                    items: allStyles.map((x) => ({
                        text: x.name,
                        items: [{
                            text: 'by:',
                            enabled: false,
                        }, ...allStyles.filter((y) => y != x).map((y) => ({
                            text: y.name,
                            action: () => {
                                if (SubtitleTools.replaceStyle(selection, x, y)) 
                                    Source.markChanged(ChangeType.InPlace, ChangeCause.Action);
                            }
                        }))]
                    }))
                },
                {
                    text: 'replace n-th channel',
                    items: [...Array(maxLines).keys()].map((x) => ({
                        text: (x+1).toString(),
                        items: [{
                            text: 'by:',
                            enabled: false,
                        }, ...allStyles.map((y) => ({
                            text: y.name,
                            action: () => {
                                let changed = false;
                                for (let ent of selection)
                                    if (ent.texts.length > x) {
                                        ent.texts[x].style = y;
                                        changed = true;
                                    }
                                if (changed)
                                    Source.markChanged(ChangeType.InPlace, ChangeCause.Action);
                            }
                        }))]
                    }))
                },
                {
                    text: 'remove channel',
                    enabled: Source.subs.styles.length > 0,
                    items: Source.subs.styles.map((x) => ({
                        text: x.name,
                        action: () => Utils.removeChannel(selection, (t) => t.style == x)
                    }))
                },
                {
                    text: 'remove empty',
                    action: () => Utils.removeChannel(selection, (t) => t.text == '')
                },
                { item: 'Separator' },
                {
                    text: 'merge overlapping duplicates',
                    enabled: selection.length > 1,
                    action: () => Utils.mergeDuplicate(selection)
                },
                {
                    text: 'combine by matching time...',
                    enabled: selection.length > 1,
                    action: () => Dialogs.combine.showModal!()
                },
                {
                    text: 'split by line',
                    enabled: selection.length >= 1,
                    action: () => Utils.splitByNewline(selection)
                },
                {
                    text: 'fix erroneous overlapping',
                    action: () => Utils.fixOverlap(selection)
                }

                // {
                //     text: 'tools',
                //     items: [
                //         {
                //             text: 'remove line breaks',
                //             action: () => {}
                //         },
                //         {
                //             text: 'add line breaks',
                //             action: () => {}
                //         },
                //         {
                //             text: 'combine channels with the same styles',
                //             action: () => {}
                //         }
                //     ]
                // },
            ]
        },
        ]});
        menu.popup();
    }
}