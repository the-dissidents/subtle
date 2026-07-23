import { Basic } from "$lib/Basic";
import { InputConfig } from "$lib/config/Groups";
import type { SubtitleEntry } from "$lib/core/Subtitles.svelte";
import { Debug } from "$lib/Debug";
import { Playback } from "$lib/frontend/Playback";
import { type TimelineInput, TimelineHandle } from "../Input.svelte";
import type { TimelineLayout } from "../Layout";
import { MoveResizeBase } from "./MoveResizeBase";

export class DragSeam extends MoveResizeBase {
    origVal: number;

    constructor(self: TimelineInput, layout: TimelineLayout, e0: MouseEvent,
        private first: SubtitleEntry, private second: SubtitleEntry,
        afterEnd: () => Promise<void>) {
        super(self, layout, e0, new Map([
            [first, { start: first.start, end: first.end }],
            [second, { start: second.start, end: second.end }]
        ]), afterEnd);
        Debug.assert(Basic.approx(first.end, second.start, InputConfig.data.epsilon));
        this.origVal = first.end;
    }

    async onDrag(offsetX: number, _offsetY: number) {
        const val = this.origVal + this.self.convertX(offsetX) - this.origPos;
        let newVal = val;
        if (TimelineHandle.useSnap.get())
            newVal = this.self.snapVisible([val]);
        if (Basic.approx(newVal, val, InputConfig.data.epsilon) && TimelineHandle.snapToFrame.get())
            newVal = Playback.snapPositionToFrame(val, 'round');
        newVal = Math.max(this.first.start, Math.min(this.second.end, newVal));
        this.first.end = newVal;
        this.second.start = newVal;

        this.changed = newVal != this.origVal;
        await this.layout.keepPosInSafeArea(newVal);
        this.layout.manager.requestRender();
    }
}
