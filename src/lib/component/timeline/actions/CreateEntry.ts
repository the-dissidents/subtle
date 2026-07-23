import type { SubtitleEntry, SubtitleStyle } from "$lib/core/Subtitles.svelte";
import { Debug } from "$lib/Debug";
import { Editing } from "$lib/frontend/Editing";
import { ChangeType, Source } from "$lib/frontend/Source";
import { get } from "svelte/store";
import { TimelineAction, TimelineInput } from "../Input.svelte";
import type { TimelineLayout } from "../Layout";
import { _ } from "svelte-i18n";

export class CreateEntry extends TimelineAction {
    entry: SubtitleEntry;
    style: SubtitleStyle;

    private deregister: () => void;

    constructor(self: TimelineInput, layout: TimelineLayout, e0: MouseEvent, style: SubtitleStyle) {
        super(self, layout, e0);
        const startPos = this.self.alignmentLine?.pos ?? this.origPos;
        this.entry = Editing.insertAtTime(startPos, startPos, style);
        this.style = style;
        this.deregister = self.registerInterruptKey();
    }

    onDrag(offsetX: number, _offsetY: number): void {
        const curPos = this.self.makeAlignmentLine(offsetX, {always: true});
        if (curPos >= this.entry.start)
            this.entry.end = curPos;
        this.layout.manager.requestRender();
    }

    async onDragEnd() {
        this.deregister();
        this.self.currentAction = undefined;
        if (this.entry.end == this.entry.start) {
            // we assume this is a mistake and treat it like a cancelled action
            await this.onDragInterrupted();
        } else {
            if (get(Editing.useUntimedForNewEntires)) {
                await Editing.fillWithFirstLineOfUntimed(this.entry, this.style);
            }
            await Source.markChanged(ChangeType.Times, get(_)('c.drag-to-create'));
            // TODO: start editing?
        }
    }

    override interrupt() {
        this.self.currentAction = undefined;
        const i = Source.subs.entries.indexOf(this.entry);
        if (i < 0) return Debug.early();
        Source.subs.entries.splice(i, 1);
    }
}
