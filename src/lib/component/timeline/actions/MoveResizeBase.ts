import type { SubtitleEntry } from "$lib/core/Subtitles.svelte";
import { Source, ChangeType } from "$lib/frontend/Source";
import { _ } from "svelte-i18n";
import { get } from "svelte/store";
import { TimelineAction, TimelineInput } from "../Input.svelte";
import type { TimelineLayout } from "../Layout";

export abstract class MoveResizeBase extends TimelineAction {
    changed = false;

    private deregister: () => void;

    constructor(
        self: TimelineInput, layout: TimelineLayout, e0: MouseEvent,
        protected origPositions: Map<SubtitleEntry, { start: number; end: number; }>,
        private afterEnd: () => void
    ) {
        super(self, layout, e0);
        this.deregister = self.registerInterruptKey();
    }

    async onDragEnd() {
        this.deregister();
        this.self.currentAction = undefined;
        this.self.alignmentLine = null;
        this.layout.manager.requestRender();
        if (this.changed)
            await Source.markChanged(ChangeType.Times, get(_)('c.drag-to-move-resize'));
        else
            this.afterEnd();
    }

    override interrupt() {
        this.self.currentAction = undefined;
        this.self.alignmentLine = null;
        for (const [ent, pos] of this.origPositions.entries()) {
            ent.start = pos.start;
            ent.end = pos.end;
        }
        this.layout.manager.requestRender();
    }
}
