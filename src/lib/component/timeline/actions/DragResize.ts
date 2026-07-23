import { Basic } from "$lib/Basic";
import { InputConfig } from "$lib/config/Groups";
import type { SubtitleEntry } from "$lib/core/Subtitles.svelte";
import { Playback } from "$lib/frontend/Playback";
import { type TimelineInput, TimelineHandle } from "../Input.svelte";
import type { TimelineLayout } from "../Layout";
import { MoveResizeBase } from "./MoveResizeBase";

export class DragResize extends MoveResizeBase {
    origVal: number;
    start: number;
    end: number;

    constructor(self: TimelineInput, layout: TimelineLayout, e0: MouseEvent,
        origPositions: Map<SubtitleEntry, { start: number; end: number; }>,
        afterEnd: () => Promise<void>,
        private where: 'start' | 'end'
    ) {
        super(self, layout, e0, origPositions, afterEnd);
        const [first, last] = this.self.selectionFirstLast();
        this.origVal = where == 'start' ? first.start : last.end;
        this.start = first.start;
        this.end = last.end;
    }

    async onDrag(offsetX: number, _offsetY: number) {
        if (this.end == this.start) return;

        const val = this.origVal + this.self.convertX(offsetX) - this.origPos;
        let newVal = val;
        if (TimelineHandle.useSnap.get())
            newVal = this.self.snapVisible([val]);
        if (Basic.approx(newVal, val, InputConfig.data.epsilon) && TimelineHandle.snapToFrame.get())
            newVal = Playback.snapPositionToFrame(val, 'round');

        let newStart: number, newEnd: number;
        if (this.where == 'start') {
            newStart = Math.min(this.end, newVal);
            newEnd = this.end;
        } else {
            newStart = this.start;
            newEnd = Math.max(this.start, newVal);
        }
        // transform selection
        const factor = (newEnd - newStart) / (this.end - this.start);
        for (const [ent, pos] of this.origPositions.entries()) {
            ent.start = (pos.start - this.start) * factor + newStart;
            ent.end = (pos.end - this.start) * factor + newStart;
        }
        this.changed = newVal != this.origVal;
        await this.layout.keepPosInSafeArea(newVal);
        this.layout.manager.requestRender();
    }
}
