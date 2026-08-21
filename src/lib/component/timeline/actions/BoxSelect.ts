import type { SubtitleEntry } from "$lib/core/Subtitles.svelte";
import { Editing } from "$lib/frontend/Editing";
import { TimelineInput } from "../Input.svelte";
import type { TimelineLayout, Box } from "../Layout";
import { TimelineAction } from "./TimelineAction";
import { Debug } from "$lib/Debug";

export class BoxSelect extends TimelineAction {
    origSelection: SubtitleEntry[];

    thisGroup: SubtitleEntry[] = [];
    x1: number;
    y1: number;

    private deregister: () => void;

    constructor(self: TimelineInput, layout: TimelineLayout, e0: MouseEvent) {
        super(self, layout, e0);
        this.origSelection = Editing.selectedEntries;
        this.x1 = e0.offsetX + this.layout.manager.scroll[0];
        this.y1 = e0.offsetY + this.layout.manager.scroll[1];
        this.deregister = self.registerInterruptKey();
    }

    override async onDrag(offsetX: number, offsetY: number) {
        const x2 = offsetX + this.layout.manager.scroll[0], y2 = offsetY + this.layout.manager.scroll[1];
        const b: Box = {
            x: Math.min(this.x1, x2), y: Math.min(this.y1, y2),
            w: Math.abs(this.x1 - x2), h: Math.abs(this.y1 - y2)
        };
        this.self.selectBox = b;

        const newGroup = this.layout.findEntriesByPosition(b.x, b.y, b.w, b.h);
        const focused = this.layout.findEntriesByPosition(x2, y2).at(0);
        if (newGroup.length != this.thisGroup.length) {
            // selection changed
            this.thisGroup = newGroup;
            if (focused) Debug.assert(newGroup.includes(focused));
            await this.self.changeSelection([...this.origSelection, ...newGroup], focused);
        }
        await this.layout.keepPosInSafeArea((x2 - this.layout.leftColumnWidth) / this.layout.scale);
        this.layout.manager.requestRender();
    }

    override onDragEnd(): void {
        this.deregister();
        this.self.currentAction = undefined;
        this.self.selectBox = null;
        this.layout.manager.requestRender();
    }

    override async interrupt() {
        this.self.currentAction = undefined;
        this.self.selectBox = null;
        // FIXME: this doesn't restore the focused entry
        await this.self.changeSelection(this.origSelection);
        this.layout.manager.requestRender();
    }
}
