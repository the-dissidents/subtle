import { Basic } from "$lib/Basic";
import { InputConfig } from "$lib/config/Groups";
import type { SubtitleEntry } from "$lib/core/Subtitles.svelte";
import { Debug } from "$lib/Debug";
import { Playback } from "$lib/frontend/Playback";
import { Source } from "$lib/frontend/Source";
import { TimelineConfig } from "../Config";
import { MoveResizeBase } from "./MoveResizeBase";
import type { TimelineLayout } from "../Layout";
import { type TimelineInput, TimelineHandle } from "../Input.svelte";

export class DragMove extends MoveResizeBase {
    points: number[];
    start: number;

    getReferencePoints(sels: SubtitleEntry[]) {
        const map = sels.reduce(
            (prev, current) => {
                const start = current.start;
                const end = current.end;
                for (const style of current.texts.keys()) {
                    if (Source.subs.view.timelineExcludeStyles.has(style))
                        continue;
                    const startend = prev.get(style.name);
                    if (startend) {
                        if (start < startend[0]) startend[0] = start;
                        if (end > startend[1]) startend[1] = end;
                    }
                    else
                        prev.set(style.name, [start, end]);
                };
                return prev;
            },
            new Map<string, [number, number]>());
        const points = [...map.values()].flat();
        return [...new Set(points)];
    }

    constructor(
        self: TimelineInput, layout: TimelineLayout, e0: MouseEvent,
        origPositions: Map<SubtitleEntry, { start: number; end: number; }>,
        afterEnd: () => Promise<void>,
        underMouse: SubtitleEntry[]
    ) {
        super(self, layout, e0, origPositions, afterEnd);
        const [first, last] = this.self.selectionFirstLast();
        const ref = TimelineConfig.data.multiselectDragReference;
        const one = underMouse.find((x) => this.self.selection.has(x))!;
        this.points =
            ref == 'eachStyleofWhole'
                ? this.getReferencePoints([...this.self.selection])
                : ref == 'whole'
                    ? [first.start, last.end]
                    : ref == 'one'
                        ? [one.start, one.end]
                        : Debug.never(ref as never);
        this.start = first.start;
    }

    onDrag(offsetX: number, _offsetY: number): void {
        const dval = this.self.convertX(offsetX) - this.origPos;
        let newDval = dval;
        if (TimelineHandle.useSnap.get())
            newDval = this.self.snapVisible(this.points, this.start + dval) - this.start;
        if (Basic.approx(newDval, dval, InputConfig.data.epsilon)
            && TimelineHandle.snapToFrame.get())
            newDval = Playback.snapPositionToFrame(this.start + dval, 'round') - this.start;
        this.changed = newDval != 0;
        for (const [ent, pos] of this.origPositions.entries()) {
            ent.start = pos.start + newDval;
            ent.end = pos.end + newDval;
        }
        this.layout.manager.requestRender();
    }
}
