import { showMenu } from "tauri-plugin-context-menu";
import { Basic, assert } from "./Basic";
import { ChangeCause, ChangeType, type Frontend } from "./frontend";
import { SubtitleEntry, SubtitleExport, SubtitleStyle, SubtitleTools, type SubtitleChannel } from "./Subtitles";

export class UIHelper {
    constructor(public readonly frontend: Frontend) {}

    processGlobalKeydown(ev: KeyboardEvent) {
        let ctrlOrMeta = ev.getModifierState(Basic.ctrlKey());
        let isEditing = this.frontend.states.modalOpenCounter > 0 
            || document.activeElement?.localName == 'input';
        let isEditingList = !this.frontend.states.isEditing && !isEditing;
        let altOrNotEditing = (!this.frontend.states.isEditing || ev.altKey) && !isEditing;

        // console.log(ev, isEditing, isEditingList, isEditing);
        
        if (ev.key == 'Enter' && ctrlOrMeta) {
            // insert after
            ev.preventDefault();
            this.frontend.insertEntryAfter(this.frontend.current.entry ?? undefined);
        }
        if (ev.key == 'Enter' && isEditingList) {
            // next entry
            ev.preventDefault();
            if (this.frontend.states.virtualEntryHighlighted)
                this.frontend.startEditingNewVirtualEntry();
            else
                this.frontend.focusOnCurrentEntry();
        }
        if (ev.key == 'a' && ctrlOrMeta && isEditingList) {
            // select all
            this.#selectAll();
            ev.preventDefault();
        }
        if ((ev.key == 'Delete' || (ev.key == 'Backspace' && ctrlOrMeta)) &&
            isEditingList) 
        {
            // delete
            this.frontend.deleteSelection();
            ev.preventDefault();
        }
        if (ev.key == 'c' && ctrlOrMeta && isEditingList) {
            // copy
            this.frontend.copySelection();
            ev.preventDefault();
        }
        if (ev.key == 'v' && ctrlOrMeta && isEditingList) {
            // paste
            this.frontend.paste();
            ev.preventDefault();
        }
        if (ev.key == 'x' && ctrlOrMeta && isEditingList) {
            // cut
            this.frontend.copySelection();
            this.frontend.deleteSelection();
            ev.preventDefault();
        }
        if (ev.key == 'z' && ctrlOrMeta && isEditingList) {
            // undo
            ev.preventDefault();
            if (ev.shiftKey)
                this.frontend.redo();
            else
                this.frontend.undo();
        }
        if (ev.key == 'ArrowUp' && ctrlOrMeta && isEditingList) {
            // move selection up
            ev.preventDefault();
            this.#moveSelection(this.frontend.getSelection(), -1);
        }
        if (ev.key == 'ArrowDown' && ctrlOrMeta && isEditingList) {
            // move selection down
            ev.preventDefault();
            this.#moveSelection(this.frontend.getSelection(), 1);
        }

        if (ev.key == 's' && ctrlOrMeta) {
            // save
            ev.preventDefault();
            this.frontend.askSaveFile();
        }
        if (ev.key == 'f' && ctrlOrMeta && !isEditing) {
            // search
            ev.preventDefault();
            this.frontend.dialogs.search?.$set({show: true});
        }

        if (ev.key == 'ArrowUp' && altOrNotEditing && !ctrlOrMeta) {
            // previous entry
            ev.preventDefault();
            this.frontend.offsetFocus(-1, ev.shiftKey, ctrlOrMeta);
        }
        if (ev.key == 'ArrowDown' && altOrNotEditing && !ctrlOrMeta) {
            // next entry
            ev.preventDefault();
            this.frontend.offsetFocus(1, ev.shiftKey, ctrlOrMeta);
        }
        if (ev.code == 'Space' && altOrNotEditing) {
            // play/pause
            this.frontend.playback.toggle();
            ev.preventDefault();
        }
        if (ev.key == 'ArrowLeft' && altOrNotEditing) {
            // move backward 1s
            this.frontend.playback.setPosition(this.frontend.playback.position - 1);
            ev.preventDefault();
        }
        if (ev.key == 'ArrowRight' && altOrNotEditing) {
            // move forward 1s
            this.frontend.playback.setPosition(this.frontend.playback.position + 1);
            ev.preventDefault();
        }
        if (ev.key == 'Enter' && !ev.shiftKey && this.frontend.states.isEditing){
            // next entry
            ev.preventDefault();
            let focused = this.frontend.current.entry;
            if (!focused) return;
            let i = this.frontend.subs.entries.indexOf(focused) + 1;
            if (i == this.frontend.subs.entries.length)
                this.frontend.startEditingNewVirtualEntry();
            else
                this.frontend.offsetFocus(1);
        }
    }

    contextMenu() {
        let selection = this.frontend.getSelection();
        if (selection.length == 0) return;
        let isDisjunct = this.frontend.isSelectionDisjunct();
        let allStyles = [this.frontend.subs.defaultStyle, ...this.frontend.subs.styles];
        showMenu({items: [
        {
            label: 'copy',
            subitems: [
                {
                    label: 'JSON (internal)',
                    shortcut: 'cmd_or_ctrl+c',
                    event: () => this.frontend.copySelection()
                },
                {
                    label: 'SRT',
                    event: () => this.frontend.copySelection(SubtitleExport.SRT)
                },
                {
                    label: 'ASS fragment',
                    event: () => this.frontend.copySelection(SubtitleExport.ASSFragment)
                },
                {
                    label: 'plain text',
                    event: () => this.frontend.copySelection(SubtitleExport.plaintext)
                }
            ]
        },
        {
            label: 'cut',
            shortcut: 'cmd_or_ctrl+x',
            event: () => {
                this.frontend.copySelection();
                this.frontend.deleteSelection();
            }
        },
        {
            label: 'paste',
            shortcut: 'cmd_or_ctrl+v',
            event: () => this.frontend.paste()
        },
        { is_separator: true },
        {
            label: 'delete',
            shortcut: 'cmd_or_ctrl+backspace',
            event: () => this.frontend.deleteSelection()
        },
        { is_separator: true },
        {
            label: 'select all',
            shortcut: 'cmd_or_ctrl+a',
            event: () => this.#selectAll()
        },
        {
            label: 'select all by channel',
            subitems: allStyles.map((x) => ({
                label: x.name,
                event: () => {
                    this.frontend.selection.currentGroup = [];
                    this.frontend.selection.currentStart = null;
                    this.frontend.selection.submitted = new Set(this.frontend.subs.entries.filter((e) => e.texts.some((c) => c.style == x)));
                    this.frontend.onSelectionChanged.dispatch(ChangeCause.Action);
                }
            }))
        },
        { is_separator: true },
        {
            label: 'insert before',
            event: () => this.frontend.insertEntryBefore(selection[0])
        },
        {
            label: 'insert after',
            shortcut: 'cmd_or_ctrl+enter',
            event: () => this.frontend.insertEntryAfter(selection[0])
        },
        {
            label: 'split simultaneous',
            event: () => this.#splitSimultaneous(selection)
        },
        {
            label: 'merge entries',
            disabled: isDisjunct || selection.length <= 1,
            subitems: [
                {
                    label: 'connect all',
                    event: () => this.#combineEntries(selection, true)
                },
                {
                    label: 'keep first only',
                    event: () => this.#combineEntries(selection, false)
                }
            ]
        },
        { is_separator: true },
        {
            label: 'utilities',
            subitems: [
                {
                    label: 'transform times...',
                    event: () => {
                        if (!this.frontend.modalDialogs.timeTrans) return;
                        let off = this.frontend.modalDialogs.timeTrans.$on('submit', 
                            (ev) => {
                                if (this.frontend.subs.shiftTimes(ev.detail))
                                    this.frontend.markChanged(
                                        ChangeType.Times, ChangeCause.Action);
                                off();
                            });
                        this.frontend.modalDialogs.timeTrans.$set({show: true});
                    }
                },
                { is_separator: true },
                {
                    label: 'sort by time',
                    disabled: isDisjunct || selection.length <= 1,
                    event: () => this.#sortSelection(selection, false)
                },
                {
                    label: 'sort by first style',
                    disabled: isDisjunct || selection.length <= 1,
                    event: () => this.#sortSelection(selection, true)
                },
                {
                    label: 'sort channels',
                    event: () => this.#sortChannels(selection)
                },
                { is_separator: true },
                {
                    label: 'create channel',
                    subitems: allStyles.map((x) => ({
                        label: x.name,
                        event: () => {
                            let done = false;
                            for (let ent of selection)
                                if (!ent.texts.find((t) => t.style == x)) {
                                    ent.texts.push({style: x, text: ''});
                                    done = true;
                                }
                            if (done)
                                this.frontend.markChanged(ChangeType.NonTime, ChangeCause.Action);
                        }
                    }))
                },
                {
                    label: 'replace channel',
                    disabled: this.frontend.subs.styles.length == 0,
                    subitems: allStyles.map((x) => ({
                        label: x.name,
                        subitems: [{
                            label: 'by:',
                            disabled: true,
                        }, ...allStyles.filter((y) => y != x).map((y) => ({
                            label: y.name,
                            event: () => {
                                if (SubtitleTools.replaceStyle(selection, x, y)) 
                                    this.frontend.markChanged(ChangeType.NonTime, ChangeCause.Action);
                            }
                        }))]
                    }))
                },
                {
                    label: 'remove channel',
                    disabled: this.frontend.subs.styles.length == 0,
                    subitems: this.frontend.subs.styles.map((x) => ({
                        label: x.name,
                        event: () => this.#removeChannel(selection, (t) => t.style == x)
                    }))
                },
                {
                    label: 'remove empty',
                    event: () => this.#removeChannel(selection, (t) => t.text == '')
                },
                { is_separator: true },
                {
                    label: 'combine overlapping duplicates',
                    disabled: selection.length <= 1,
                    event: () => this.#combineDuplicate(selection)
                },
                {
                    label: 'combine by matching time...',
                    disabled: selection.length <= 1,
                    event: () =>
                        this.frontend.modalDialogs.combine?.$set({show: true})
                },
                {
                    label: 'split by line',
                    disabled: selection.length <= 1,
                    event: () => this.#splitByNewline(selection)
                },
                {
                    label: 'split by language...',
                    event: () =>
                        this.frontend.modalDialogs.splitLanguages?.$set({show: true})
                },
                {
                    label: 'fix erroneous overlapping',
                    event: () => this.#fixOverlap(selection)
                }
                // TODO: split by line


                // {
                //     label: 'tools',
                //     subitems: [
                //         {
                //             label: 'remove line breaks',
                //             event: () => {}
                //         },
                //         {
                //             label: 'add line breaks',
                //             event: () => {}
                //         },
                //         {
                //             label: 'combine channels with the same styles',
                //             event: () => {}
                //         }
                //     ]
                // },
            ]
        },
        ]});
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
                done++;
            }
        if (done > 0) {
            let focus: SubtitleEntry | null = null;
            if (this.frontend.current.entry
                && newSelection.indexOf(this.frontend.current.entry) >= 0)
                focus = this.frontend.current.entry;
            this.frontend.clearSelection();
            this.frontend.selection.submitted = new Set(newSelection);
            this.frontend.markChanged(ChangeType.NonTime, ChangeCause.Action);
            this.frontend.status = `changed ${done} entrie${done > 1 ? 's' : ''}`;
        } else {
            this.frontend.status = `changed nothing`;
        }
    }

    #selectAll() {
        this.frontend.selection.currentStart = null;
        this.frontend.selection.currentGroup = [];
        for (let e of this.frontend.subs.entries)
            this.frontend.selection.submitted.add(e);
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
        this.frontend.markChanged(ChangeType.NonTime, ChangeCause.Action);
    }

    #sortChannels(selection: SubtitleEntry[]) {
        let indices = new Map<SubtitleStyle, number>();
        indices.set(this.frontend.subs.defaultStyle, 0);
        for (let i = 0; i < this.frontend.subs.styles.length; i++)
            indices.set(this.frontend.subs.styles[i], i+1);
        for (let ent of selection) {
            ent.texts.sort((a, b) => 
                (indices.get(a.style) ?? 0) - (indices.get(b.style) ?? 0));
        }
        this.frontend.markChanged(ChangeType.NonTime, ChangeCause.Action);
    }

    #moveSelection(selection: SubtitleEntry[], direction: number) {
        // assumes selection is not disjunct
        if (selection.length == 0 || direction == 0) return;
        let index = this.frontend.subs.entries.indexOf(selection[0]);
        if (index + direction < 0 || index + direction > this.frontend.subs.entries.length) return;
        this.frontend.subs.entries.splice(index, selection.length);
        this.frontend.subs.entries.splice(index + direction, 0, ...selection);
        this.frontend.markChanged(ChangeType.NonTime, ChangeCause.Action);
        setTimeout(() => {
            this.frontend.keepEntryInView(direction > 0 ? selection.at(-1)! : selection[0]);
        }, 0);
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
        }
        if (count > 0) {
            this.frontend.markChanged(ChangeType.Times, ChangeCause.Action);
            this.frontend.status = `changed ${count} entrie${count > 1 ? 's' : ''}`;
        } else this.frontend.status = `changed nothing`;
    }

    #combineDuplicate(selection: SubtitleEntry[]) {
        let deletion = new Set<SubtitleEntry>;
        for (let i = 0; i < selection.length; i++) {
            let entry = selection[i];
            if (deletion.has(entry) || entry.texts.length > 1) continue;
            
            while (true) {
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
                        deletion.add(other);
                        break;
                    }
                }
                break;
            }
        }
        for (const entry of deletion) {
            let index = this.frontend.subs.entries.indexOf(entry);
            assert(index > 0);
            this.frontend.subs.entries.splice(index, 1);
        }
        this.frontend.markChanged(ChangeType.Times, ChangeCause.Action);
    }

    #combineEntries(selection: SubtitleEntry[], keepAll: boolean) {
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
        this.frontend.subs.entries.splice(
            this.frontend.subs.entries.indexOf(entry) + 1,
            selection.length - 1);
        this.frontend.selectEntry(entry);
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
        }
        if (newSelection.length != selection.length) {
            this.frontend.clearSelection();
            for (let ent of newSelection)
                this.frontend.selection.submitted.add(ent);
            this.frontend.markChanged(ChangeType.Times, ChangeCause.Action);
        }
    }
}