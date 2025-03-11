import { Menu } from "@tauri-apps/api/menu";
import { Basic, assert } from "./Basic";
import { ChangeCause, ChangeType, getSelectMode, SelectMode, UIFocus, type Frontend } from "./Frontend";
import { Labels, SubtitleEntry, SubtitleStyle, SubtitleTools, type LabelTypes, type SubtitleChannel } from "./core/Subtitles.svelte";
import { ASS } from "./core/ASS";

export class UIHelper {
    constructor(public readonly frontend: Frontend) {}

    processGlobalKeydown(ev: KeyboardEvent) {
        const ctrlOrMeta = ev.getModifierState(Basic.ctrlKey());
        const inModal = this.frontend.states.modalOpenCounter > 0;
        const focus = this.frontend.getUIFocus();
        const focusedEntry = this.frontend.getFocusedEntry();

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
            this.frontend.insertEntryAfter(focused);
        }
        else if (ev.key == 'Enter' && tableFocused) {
            // edit this entry
            ev.preventDefault();
            if (focusedEntry == 'virtual')
                this.frontend.startEditingNewVirtualEntry();
            else
                this.frontend.startEditingFocusedEntry();
        }
        else if (ev.key == 'a' && ctrlOrMeta && altOrTableOrTimeline) {
            // select all
            this.#selectAll();
            ev.preventDefault();
        }
        else if ((ev.key == 'Delete' || (ev.key == 'Backspace' && ctrlOrMeta)) 
            && altOrTableOrTimeline) 
        {
            // delete
            this.frontend.deleteSelection();
            ev.preventDefault();
        }
        else if (ev.key == 'c' && ctrlOrMeta && altOrTableOrTimeline) {
            // copy
            this.frontend.copySelection();
            ev.preventDefault();
        }
        else if (ev.key == 'v' && ctrlOrMeta && tableFocused) {
            // paste
            this.frontend.paste();
            ev.preventDefault();
        }
        else if (ev.key == 'x' && ctrlOrMeta && tableFocused) {
            // cut
            this.frontend.copySelection();
            this.frontend.deleteSelection();
            ev.preventDefault();
        }
        else if (ev.key == 'z' && ctrlOrMeta && altOrTableOrTimeline) {
            // undo
            ev.preventDefault();
            if (ev.shiftKey)
                this.frontend.redo();
            else
                this.frontend.undo();
        }
        else if (ev.key == 'ArrowUp' && ctrlOrMeta && tableFocused) {
            // move selection up
            ev.preventDefault();
            this.#moveSelectionContinuous(this.frontend.getSelection(), -1);
        }
        else if (ev.key == 'ArrowDown' && ctrlOrMeta && tableFocused) {
            // move selection down
            ev.preventDefault();
            this.#moveSelectionContinuous(this.frontend.getSelection(), 1);
        }

        else if (ev.key == 's' && ctrlOrMeta) {
            // save
            ev.preventDefault();
            this.frontend.askSaveFile();
        }

        else if (ev.key == 'ArrowUp' && altOrTableOrTimeline && !ctrlOrMeta) {
            // previous entry
            ev.preventDefault();
            this.frontend.offsetFocus(-1, getSelectMode(ev));
        }
        else if (ev.key == 'ArrowDown' && altOrTableOrTimeline && !ctrlOrMeta) {
            // next entry
            ev.preventDefault();
            this.frontend.offsetFocus(1, getSelectMode(ev));
        }
        else if (ev.code == 'Space' && altOrTableOrTimeline) {
            // play/pause
            this.frontend.playback.toggle();
            ev.preventDefault();
        }
        else if (ev.code == 'KeyI' && altOrTimeline) {
            // in point
            if (this.frontend.playback.timeline === null) return;
            const pos = this.frontend.playback.timeline.cursorPos;
            const area = this.frontend.playback.playArea;
            this.frontend.playback.playArea.start = 
                (area.start == pos || (area.end !== undefined && area.end <= pos)) 
                ? undefined : pos;
            this.frontend.playback.timeline.requestRender();
            ev.preventDefault();
        }
        else if (ev.code == 'KeyO' && altOrTimeline) {
            // out point
            if (this.frontend.playback.timeline === null) return;
            const pos = this.frontend.playback.timeline.cursorPos;
            const area = this.frontend.playback.playArea;
            this.frontend.playback.playArea.end =
                (area.end == pos || (area.start !== undefined && area.start >= pos)) 
                ? undefined : pos;
            this.frontend.playback.timeline.requestRender();
            ev.preventDefault();
        }
        else if (ev.code == 'KeyP' && altOrTableOrTimeline) {
            // play selected entry
            if (this.frontend.playback.timeline === null) return;
            const current = this.frontend.selection.focused;
            if (current === null) return;
            this.frontend.playback.playAreaOverride = {
                start: current.start,
                end: current.end,
                loop: false
            };
            // cf. comment at line 99 in Playback.ts
            this.frontend.playback.setPosition(current.start)
                .then(() => this.frontend.playback.play(true));
            ev.preventDefault();
        }
        else if (ev.key == 'ArrowLeft' && altOrTimeline) {
            // move backward 1s or 1 frame
            let skipTime = ctrlOrMeta
                ? 1 / (this.frontend.playback.video?.framerate ?? 24)
                : 1;
            this.frontend.playback.setPosition(this.frontend.playback.position - skipTime);
            ev.preventDefault();
        }
        else if (ev.key == 'ArrowRight' && altOrTimeline) {
            // move forward 1s or 1 frame
            let skipTime = ctrlOrMeta
                ? 1 / (this.frontend.playback.video?.framerate ?? 24)
                : 1;
            this.frontend.playback.setPosition(this.frontend.playback.position + skipTime);
            ev.preventDefault();
        }
        else if (ev.key == 'ArrowLeft' && ctrlOrMeta && altOrTimeline) {
            // move backward 1s
            this.frontend.playback.setPosition(this.frontend.playback.position - 1);
            ev.preventDefault();
        }
        else if (ev.key == 'ArrowRight' && altOrTimeline) {
            // move forward 1s
            this.frontend.playback.setPosition(this.frontend.playback.position + 1);
            ev.preventDefault();
        }
        else if (ev.key == 'Enter' && !ev.shiftKey && focus == UIFocus.EditingField){
            // next entry
            ev.preventDefault();
            if (!(focusedEntry instanceof SubtitleEntry)) return;
            this.frontend.submitFocusedEntry();
            let i = this.frontend.subs.entries.indexOf(focusedEntry) + 1;
            if (i == this.frontend.subs.entries.length)
                this.frontend.startEditingNewVirtualEntry();
            else
                this.frontend.offsetFocus(1, SelectMode.Single);
        }
    }

    async contextMenu() {
        let selection = this.frontend.getSelection();
        if (selection.length == 0) return;
        let isDisjunct = this.frontend.isSelectionDisjunct();
        let allStyles = [this.frontend.subs.defaultStyle, ...this.frontend.subs.styles];
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
                    action: () => this.frontend.copySelection()
                },
                {
                    text: 'SRT',
                    action: () => this.frontend.copySelection((x) => this.frontend.toSRT(x))
                },
                {
                    text: 'ASS fragment',
                    action: () => this.frontend.copySelection(ASS.exportFragment)
                },
                {
                    text: 'plain text',
                    action: () => this.frontend.copySelection((x) => this.frontend.toPlaintext(x))
                }
            ]
        },
        {
            text: 'cut',
            accelerator: `CmdOrCtrl+X`,
            action: () => {
                this.frontend.copySelection();
                this.frontend.deleteSelection();
            }
        },
        {
            text: 'paste',
            accelerator: `${Basic.ctrlKey()}+V`,
            action: () => this.frontend.paste()
        },
        { item: 'Separator' },
        {
            text: 'delete',
            accelerator: `CmdOrCtrl+Backspace`,
            action: () => this.frontend.deleteSelection()
        },
        { item: 'Separator' },
        {
            text: 'select all',
            accelerator: `CmdOrCtrl+A`,
            action: () => this.#selectAll()
        },
        {
            text: 'select all by channel',
            items: allStyles.map((x) => ({
                text: x.name,
                action: () => {
                    this.frontend.selection.currentGroup = [];
                    this.frontend.selection.focused = null;
                    this.frontend.selection.submitted = new Set(this.frontend.subs.entries.filter((e) => e.texts.some((c) => c.style == x)));
                    this.frontend.onSelectionChanged.dispatch(ChangeCause.Action);
                }
            }))
        },
        {
            text: 'invert selection',
            action: () => this.#invertSelection()
        },
        { item: 'Separator' },
        {
            text: 'insert before',
            action: () => this.frontend.insertEntryBefore(selection[0])
        },
        {
            text: 'insert after',
            accelerator: `CmdOrCtrl+Enter`,
            action: () => this.frontend.insertEntryAfter(selection[0])
        },
        {
            text: 'move',
            enabled: selection.length > 0,
            items: [
                {
                    text: 'up',
                    enabled: !isDisjunct,
                    accelerator: `CmdOrCtrl+Up`,
                    action: () => this.#moveSelectionContinuous(selection, -1)
                },
                {
                    text: 'down',
                    enabled: !isDisjunct,
                    accelerator: `CmdOrCtrl+Down`,
                    action: () => this.#moveSelectionContinuous(selection, 1)
                },
                {
                    text: 'to the beginning',
                    action: () => this.#moveSelectionTo(selection, 'beginning')
                },
                {
                    text: 'to the end',
                    action: () => this.#moveSelectionTo(selection, 'end')
                }
            ]
        },
        { item: 'Separator' },
        {
            text: 'combine',
            enabled: selection.length > 1,
            action: () => this.#combineSelection(selection)
        },
        {
            text: 'split simultaneous',
            action: () => this.#splitSimultaneous(selection)
        },
        {
            text: 'merge entries',
            enabled: !isDisjunct && selection.length > 1,
            items: [
                {
                    text: 'connect all',
                    action: () => this.#mergeEntries(selection, true)
                },
                {
                    text: 'keep first only',
                    action: () => this.#mergeEntries(selection, false)
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
                    for (let entry of selection) {
                        entry.label = x;
                        // entry.update.dispatch();
                    }
                    this.frontend.markChanged(ChangeType.InPlace, ChangeCause.Action);
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
                        let options = await this.frontend.modalDialogs.timeTransform.showModal!();
                        if (options && this.frontend.subs.shiftTimes(options))
                            this.frontend.markChanged(ChangeType.Times, ChangeCause.Action);
                    }
                },
                { item: 'Separator' },
                {
                    text: 'sort by time',
                    enabled: !isDisjunct && selection.length > 1,
                    action: () => this.#sortSelection(selection, false)
                },
                {
                    text: 'sort by first style',
                    enabled: !isDisjunct && selection.length > 1,
                    action: () => this.#sortSelection(selection, true)
                },
                {
                    text: 'sort channels',
                    action: () => this.#sortChannels(selection)
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
                                    // ent.update.dispatch();
                                    done = true;
                                }
                            if (done)
                                this.frontend.markChanged(ChangeType.InPlace, ChangeCause.Action);
                        }
                    }))
                },
                {
                    text: 'replace channel',
                    enabled: this.frontend.subs.styles.length > 0,
                    items: allStyles.map((x) => ({
                        text: x.name,
                        items: [{
                            text: 'by:',
                            enabled: false,
                        }, ...allStyles.filter((y) => y != x).map((y) => ({
                            text: y.name,
                            action: () => {
                                if (SubtitleTools.replaceStyle(selection, x, y)) 
                                    this.frontend.markChanged(ChangeType.InPlace, ChangeCause.Action);
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
                                        // ent.update.dispatch();
                                        changed = true;
                                    }
                                if (changed) this.frontend.markChanged(
                                    ChangeType.InPlace, ChangeCause.Action);
                            }
                        }))]
                    }))
                },
                {
                    text: 'remove channel',
                    enabled: this.frontend.subs.styles.length > 0,
                    items: this.frontend.subs.styles.map((x) => ({
                        text: x.name,
                        action: () => this.#removeChannel(selection, (t) => t.style == x)
                    }))
                },
                {
                    text: 'remove empty',
                    action: () => this.#removeChannel(selection, (t) => t.text == '')
                },
                { item: 'Separator' },
                {
                    text: 'merge overlapping duplicates',
                    enabled: selection.length > 1,
                    action: () => this.#mergeDuplicate(selection)
                },
                {
                    text: 'combine by matching time...',
                    enabled: selection.length > 1,
                    action: () =>
                        this.frontend.modalDialogs.combine.showModal!()
                },
                {
                    text: 'split by line',
                    enabled: selection.length >= 1,
                    action: () => this.#splitByNewline(selection)
                },
                {
                    text: 'fix erroneous overlapping',
                    action: () => this.#fixOverlap(selection)
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

    #removeChannel(selection: SubtitleEntry[], pred: (ch: SubtitleChannel) => boolean) {
        console.log(selection);
        let done = 0;
        let newSelection: SubtitleEntry[] = [];
        for (let ent of selection)
            if (ent.texts.find((t) => pred(t))) {
                ent.texts = ent.texts.filter((t) => !pred(t));
                console.log(ent.texts);
                if (ent.texts.length > 0) newSelection.push(ent);
                else this.frontend.subs.entries.splice(
                    this.frontend.subs.entries.indexOf(ent), 1);
                // ent.update.dispatch();
                done++;
            }
        if (done > 0) {
            this.frontend.clearSelection();
            this.frontend.selection.submitted = new Set(newSelection);
            this.frontend.markChanged(ChangeType.InPlace, ChangeCause.Action);
            this.frontend.status.set(`changed ${done} entrie${done > 1 ? 's' : ''}`);
        } else {
            this.frontend.status.set(`changed nothing`);
        }
    }

    #selectAll() {
        this.frontend.selection.focused = null;
        this.frontend.selection.currentGroup = [];
        for (let e of this.frontend.subs.entries)
            this.frontend.selection.submitted.add(e);
        this.frontend.onSelectionChanged.dispatch(ChangeCause.Action);
    }

    #invertSelection() {
        let newSelection = new Set<SubtitleEntry>;
        let oldSelection = new Set(this.frontend.getSelection());
        for (let e of this.frontend.subs.entries)
            if (!oldSelection.has(e)) newSelection.add(e);
        this.frontend.clearFocus();
        this.frontend.selection.focused = null;
        this.frontend.selection.currentGroup = [];
        this.frontend.selection.submitted = newSelection;
        this.frontend.onSelectionChanged.dispatch(ChangeCause.Action);
    }

    #sortSelection(selection: SubtitleEntry[], byStyle: boolean) {
        // assumes selection is not disjunct
        if (selection.length == 0) return;
        let start = this.frontend.subs.entries.indexOf(selection[0]);
        if (start < 0) return;
        let positionMap = new Map<SubtitleEntry, number>();
        for (let i = 0; i < this.frontend.subs.entries.length; i++)
            positionMap.set(this.frontend.subs.entries[i], i);
        if (byStyle) selection.sort((a, b) => 
            a.texts[0].style.name.localeCompare(b.texts[0].style.name)); 
        else selection.sort((a, b) => a.start - b.start);
        this.frontend.subs.entries.splice(start, selection.length, ...selection);
        this.frontend.markChanged(ChangeType.Order, ChangeCause.Action);
    }

    #sortChannels(selection: SubtitleEntry[]) {
        let indices = new Map<SubtitleStyle, number>();
        indices.set(this.frontend.subs.defaultStyle, 0);
        for (let i = 0; i < this.frontend.subs.styles.length; i++)
            indices.set(this.frontend.subs.styles[i], i+1);
        for (let ent of selection) {
            ent.texts.sort((a, b) => 
                (indices.get(a.style) ?? 0) - (indices.get(b.style) ?? 0));
            // ent.update.dispatch();
        }
        this.frontend.markChanged(ChangeType.InPlace, ChangeCause.Action);
    }

    #moveSelectionContinuous(selection: SubtitleEntry[], direction: number) {
        if (this.frontend.isSelectionDisjunct()) return;
        
        if (selection.length == 0 || direction == 0) return;
        let index = this.frontend.subs.entries.indexOf(selection[0]);
        if (index + direction < 0 || index + direction > this.frontend.subs.entries.length) return;
        this.frontend.subs.entries.splice(index, selection.length);
        this.frontend.subs.entries.splice(index + direction, 0, ...selection);
        this.frontend.markChanged(ChangeType.Order, ChangeCause.Action);
        setTimeout(() => {
            this.frontend.keepEntryInView(direction > 0 ? selection.at(-1)! : selection[0]);
        }, 0);
    }

    #moveSelectionTo(selection: SubtitleEntry[], to: 'beginning' | 'end') {
        if (selection.length == 0) return;
        let selectionSet = new Set(selection);
        let newEntries = this.frontend.subs.entries.filter((x) => !selectionSet.has(x));
        switch (to) {
        case "beginning":
            newEntries = [...selection, ...newEntries]; break;
        case "end":
            newEntries = [...newEntries, ...selection]; break;
        }
        this.frontend.subs.entries = newEntries;
        this.frontend.markChanged(ChangeType.Order, ChangeCause.Action);
    }

    #fixOverlap(selection: SubtitleEntry[], epsilon = 0.05) {
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
        if (count > 0) {
            this.frontend.markChanged(ChangeType.Times, ChangeCause.Action);
            this.frontend.status.set(`changed ${count} entrie${count > 1 ? 's' : ''}`);
        } else this.frontend.status.set(`changed nothing`);
    }

    #combineSelection(selection: SubtitleEntry[]) {
        if (selection.length <= 1) return;
        let main = selection[0];
        for (let i = 1; i < selection.length; i++) {
            let other = selection[i];
            main.texts.push(...other.texts);
            const index = this.frontend.subs.entries.indexOf(other);
            assert(index > 0);
            this.frontend.subs.entries.splice(index, 1);
        }
        // main.update.dispatch();
        this.frontend.markChanged(ChangeType.Times, ChangeCause.Action);
        this.frontend.status.set(`combined ${selection.length} entries`);
    }

    #mergeDuplicate(selection: SubtitleEntry[]) {
        let deletion = new Set<SubtitleEntry>;
        for (let i = 0; i < selection.length; i++) {
            let entry = selection[i];
            if (deletion.has(entry) || entry.texts.length > 1) continue;
            
            for (let j = 0; j < selection.length; j++) {
                if (i == j) continue;
                let other = selection[j];
                if (deletion.has(other) || other.texts.length > 1) continue;
                if (other.texts[0].text != entry.texts[0].text) continue;

                if (Math.abs(other.start - entry.end) < this.frontend.timeEpsilon 
                    || Math.abs(other.end - entry.start) < this.frontend.timeEpsilon) 
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
            const index = this.frontend.subs.entries.indexOf(entry);
            assert(index > 0);
            this.frontend.subs.entries.splice(index, 1);
        }
        this.frontend.markChanged(ChangeType.Times, ChangeCause.Action);
    }

    #mergeEntries(selection: SubtitleEntry[], keepAll: boolean) {
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
        // entry.update.dispatch();
        this.frontend.subs.entries.splice(
            this.frontend.subs.entries.indexOf(entry) + 1,
            selection.length - 1);
        this.frontend.selectEntry(entry, SelectMode.Single);
        this.frontend.markChanged(ChangeType.Times, ChangeCause.Action);
    }

    #splitByNewline(selection: SubtitleEntry[]) {
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
            // entry.update.dispatch();
        }
        this.frontend.markChanged(ChangeType.Times, ChangeCause.Action);
    }

    #splitSimultaneous(selection: SubtitleEntry[]) {
        if (selection.length == 0) return;
        let newSelection: SubtitleEntry[] = [];
        for (let i = 0; i < selection.length; i++) {
            let entry = selection[i];
            let index = this.frontend.subs.entries.indexOf(entry);
            newSelection.push(entry);
            for (let j = 1; j < entry.texts.length; j++) {
                index++;
                let newEntry = new SubtitleEntry(entry.start, entry.end, entry.texts[j]);
                this.frontend.subs.entries.splice(index, 0, newEntry);
                newSelection.push(newEntry);
            }
            entry.texts = [entry.texts[0]];
            // entry.update.dispatch();
        }
        if (newSelection.length != selection.length) {
            this.frontend.clearSelection();
            for (let ent of newSelection)
                this.frontend.selection.submitted.add(ent);
            this.frontend.markChanged(ChangeType.Times, ChangeCause.Action);
        }
    }
}