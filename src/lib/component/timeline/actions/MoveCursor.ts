import { Playback } from "$lib/frontend/Playback";
import { TimelineAction, TimelineInput } from "../Input.svelte";
import type { TimelineLayout } from "../Layout";

export class MoveCursor extends TimelineAction {
    constructor(self: TimelineInput, layout: TimelineLayout, e0: MouseEvent) {
        super(self, layout, e0);
    }

    async onDrag(offsetX: number) {
        let curPos = (offsetX - this.layout.leftColumnWidth) / this.layout.scale + this.layout.offset;
        // always snap to frame, it's only valid that way with video loaded
        curPos = Playback.snapPositionToFrame(curPos, 'round');
        if (curPos == Playback.position) return;
        await Playback.setPosition(curPos);
    }
}
