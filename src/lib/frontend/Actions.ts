console.info('Actions loading');

import { Menu } from "@tauri-apps/api/menu";
import { Basic } from "../Basic";
import { InputConfig } from "../config/Groups";

import { ASS } from "../core/ASS";
import { type LabelTypes, Labels, SubtitleEntry, Subtitles } from "../core/Subtitles.svelte";
import { SubtitleUtil } from "../core/SubtitleUtil";
import { LinearFormatCombineStrategy, SimpleFormats } from "../core/SimpleFormats";

import { Editing, getSelectMode, KeepInViewMode, SelectMode } from "./Editing";
import { Utils } from "./Utils";
import { ChangeCause, ChangeType, Source } from "./Source";
import { Interface, UIFocus } from "./Interface";
import { Dialogs } from "./Dialogs";
import { Playback } from "./Playback";

import { unwrapFunctionStore, _ } from 'svelte-i18n';
const $_ = unwrapFunctionStore(_);

const toSRT = (x: Subtitles) => 
    SimpleFormats.export.SRT(x, x.entries, LinearFormatCombineStrategy.Recombine);
const toPlaintext = (x: Subtitles) => 
    SimpleFormats.export.plaintext(x, x.entries, LinearFormatCombineStrategy.KeepOrder);

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
            Editing.offsetFocus(-1, getSelectMode(ev), 
                InputConfig.data.arrowNavigationType == 'keepPosition' 
                ? KeepInViewMode.SamePosition 
                : KeepInViewMode.KeepInSight);
        }
        else if (ev.key == 'ArrowDown' && altOrTableOrTimeline && !ctrlOrMeta) {
            // next entry
            ev.preventDefault();
            Editing.offsetFocus(1, getSelectMode(ev), 
                InputConfig.data.arrowNavigationType == 'keepPosition' 
                ? KeepInViewMode.SamePosition 
                : KeepInViewMode.KeepInSight);
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
        else if (ev.key == 'ArrowLeft' && ctrlOrMeta && altOrTimeline) {
            // move backward 1 frame
            ev.preventDefault();
            Playback.video?.requestPreviousFrame();
        }
        else if (ev.key == 'ArrowRight' && ctrlOrMeta && altOrTimeline) {
            // move forward 1 frame
            ev.preventDefault();
            Playback.video?.requestNextFrame();
        }
        else if (ev.key == 'ArrowLeft' && altOrTimeline) {
            // move backward
            Playback.setPosition(Playback.position - InputConfig.data.skipDuration);
            ev.preventDefault();
        }
        else if (ev.key == 'ArrowRight' && altOrTimeline) {
            // move forward
            Playback.setPosition(Playback.position + InputConfig.data.skipDuration);
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
                Editing.offsetFocus(1, SelectMode.Single, 
                    InputConfig.data.enterNavigationType == 'keepPosition' 
                    ? KeepInViewMode.SamePosition 
                    : KeepInViewMode.KeepInSight);
        }
    },

    async contextMenu() {
        const selection = Editing.getSelection();
        if (selection.length == 0) return;
        const isDisjunct = Utils.isSelectionDisjunct();
        let label: LabelTypes | undefined = selection[0].label;
        for (const entry of selection) {
            if (entry.label != selection[0].label) {
                label = undefined;
                break;
            }
        }
        const styles = selection.map((x) => [...x.texts.keys()]).flat();
        const distinctStyles = Source.subs.styles.filter((x) => styles.includes(x));
        const commonStyles = distinctStyles
            .filter((x) => selection.every((y) => y.texts.has(x)));
        const canCombine = styles.length == distinctStyles.length;

        let menu = await Menu.new({items: [
        {
            text: $_('action.copy'),
            items: [
                {
                    text: $_('cxtmenu.json-internal'),
                    accelerator: `CmdOrCtrl+C`,
                    action: () => Utils.copySelection()
                },
                {
                    text: $_('cxtmenu.srt'),
                    action: () => Utils.copySelection((x) => toSRT(x))
                },
                {
                    text: $_('cxtmenu.ass-fragment'),
                    action: () => Utils.copySelection(ASS.exportFragment)
                },
                {
                    text: $_('cxtmenu.plain-text'),
                    action: () => Utils.copySelection((x) => toPlaintext(x))
                }
            ]
        },
        {
            text: $_('action.cut'),
            accelerator: `CmdOrCtrl+X`,
            action: () => {
                Utils.copySelection();
                Editing.deleteSelection();
            }
        },
        {
            text: $_('action.paste'),
            accelerator: `${Basic.ctrlKey()}+V`,
            action: () => Utils.paste()
        },
        { item: 'Separator' },
        {
            text: $_('action.delete'),
            accelerator: `CmdOrCtrl+Backspace`,
            action: () => Editing.deleteSelection()
        },
        { item: 'Separator' },
        {
            text: $_('action.select-all'),
            accelerator: `CmdOrCtrl+A`,
            action: () => Utils.selectAll()
        },
        {
            text: $_('action.select-all-by-channel'),
            items: Source.subs.styles.map((x) => ({
                text: x.name,
                action: () => {
                    Editing.selection.currentGroup = [];
                    Editing.selection.focused = null;
                    Editing.selection.submitted = new Set(
                        Source.subs.entries.filter((e) => e.texts.has(x)));
                    Editing.onSelectionChanged.dispatch(ChangeCause.Action);
                }
            }))
        },
        {
            text: $_('action.invert-selection'),
            action: () => Utils.invertSelection()
        },
        { item: 'Separator' },
        {
            text: $_('action.insert-before'),
            action: () => Utils.insertEntryBefore(selection[0])
        },
        {
            text: $_('action.insert-after'),
            accelerator: `CmdOrCtrl+Enter`,
            action: () => Utils.insertEntryAfter(selection[0])
        },
        {
            text: $_('action.move'),
            enabled: selection.length > 0,
            items: [
                {
                    text: $_('action.up'),
                    enabled: !isDisjunct,
                    accelerator: `CmdOrCtrl+Up`,
                    action: () => Utils.moveSelectionContinuous(selection, -1)
                },
                {
                    text: $_('action.down'),
                    enabled: !isDisjunct,
                    accelerator: `CmdOrCtrl+Down`,
                    action: () => Utils.moveSelectionContinuous(selection, 1)
                },
                {
                    text: $_('action.to-the-beginning'),
                    action: () => Utils.moveSelectionTo(selection, 'beginning')
                },
                {
                    text: $_('action.to-the-end'),
                    action: () => Utils.moveSelectionTo(selection, 'end')
                }
            ]
        },
        { item: 'Separator' },
        {
            text: $_('action.combine'),
            enabled: selection.length > 1 && canCombine,
            action: () => {
                const first = selection[0];
                for (let i = 1; i < selection.length; i++) {
                    const entry = selection[i];
                    for (const [style, text] of entry.texts)
                        first.texts.set(style, text);
                }
                Source.markChanged(ChangeType.Times);
            }
        },
        {
            text: $_('action.split-simultaneous'),
            action: () => Utils.splitSimultaneous(selection)
        },
        {
            text: $_('action.merge-entries'),
            enabled: !isDisjunct && selection.length > 1,
            items: [
                {
                    text: $_('action.connect-all'),
                    action: () => Utils.mergeEntries(selection, true)
                },
                {
                    text: $_('action.keep-first-only'),
                    action: () => Utils.mergeEntries(selection, false)
                }
            ]
        },
        { item: 'Separator' },
        {
            text: $_('action.label'),
            items: Labels.map((x) => ({
                text: x,
                checked: x === label,
                action: () => {
                    for (let entry of selection)
                        entry.label = x;
                    Source.markChanged(ChangeType.InPlace);
                }
            }))
        },
        { item: 'Separator' },
        {
            text: $_('cxtmenu.utilities'),
            items: [
                {
                    text: $_('action.transform-times'),
                    action: async () => {
                        let options = await Dialogs.timeTransform.showModal!();
                        if (options && SubtitleUtil.shiftTimes(Source.subs, options))
                            Source.markChanged(ChangeType.Times);
                    }
                },
                { item: 'Separator' },
                {
                    text: $_('action.sort-by-time'),
                    enabled: !isDisjunct && selection.length > 1,
                    action: () => Utils.sortSelection(selection)
                },
                { item: 'Separator' },
                {
                    text: $_('action.create-channel'),
                    items: Source.subs.styles.map((x) => ({
                        text: x.name,
                        enabled: !commonStyles.includes(x),
                        action: () => {
                            let done = false;
                            for (let ent of selection)
                                if (!ent.texts.has(x)) {
                                    ent.texts.set(x, '');
                                    done = true;
                                }
                            if (done)
                                Source.markChanged(ChangeType.InPlace);
                        }
                    }))
                },
                {
                    text: $_('action.replace-channel'),
                    enabled: Source.subs.styles.length > 1,
                    items: distinctStyles.map((x) => ({
                        text: x.name,
                        items: [{
                            text: $_('cxtmenu.by'),
                            enabled: false,
                        }, ...Source.subs.styles.filter((y) => y != x).map((y) => ({
                            text: y.name,
                            action: () => Utils.replaceStyle(selection, x, y)
                        }))]
                    }))
                },
                {
                    text: $_('action.exchange-channel'),
                    enabled: distinctStyles.length > 1,
                    items: distinctStyles.map((x) => ({
                        text: x.name,
                        items: [{
                            text: $_('cxtmenu.and'),
                            enabled: false,
                        }, ...distinctStyles.filter((y) => y != x).map((y) => ({
                            text: y.name,
                            action: () => Utils.exchangeStyle(selection, x, y)
                        }))]
                    }))
                },
                {
                    text: $_('action.remove-channel'),
                    enabled: Source.subs.styles.length > 0,
                    items: distinctStyles.map((x) => ({
                        text: x.name,
                        action: () => Utils.removeStyle(selection, x)
                    }))
                },
                {
                    text: $_('action.remove-empty'),
                    action: () => Utils.removeBlankChannels(selection)
                },
                { item: 'Separator' },
                {
                    text: $_('action.merge-overlapping-duplicates'),
                    enabled: selection.length > 1,
                    action: () => Utils.mergeDuplicate(selection)
                },
                {
                    text: $_('action.combine-by-matching-time'),
                    enabled: selection.length > 1,
                    action: () => Dialogs.combine.showModal!()
                },
                {
                    text: $_('action.split-by-line'),
                    enabled: selection.length > 0,
                    action: () => Dialogs.splitByLine.showModal!()
                },
                {
                    text: $_('action.fix-erroneous-overlapping'),
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