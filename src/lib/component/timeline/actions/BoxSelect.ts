import type { SubtitleEntry } from "$lib/core/Subtitles.svelte";
import { Editing } from "$lib/frontend/Editing";
import { SvelteSet } from "svelte/reactivity";
import { TimelineAction, TimelineInput } from "../Input.svelte";
import type { TimelineLayout, Box } from "../Layout";

export class BoxSelect extends TimelineAction {
    origSelection: SubtitleEntry[];
    thisGroup: SubtitleEntry[] = [];
    x1: number;
    y1: number;

    private deregister: () => void;

    constructor(self: TimelineInput, layout: TimelineLayout, e0: MouseEvent) {
        super(self, layout, e0);
        this.origSelection = Editing.getSelection();
        this.x1 = e0.offsetX + this.layout.manager.scroll[0];
        this.y1 = e0.offsetY + this.layout.manager.scroll[1];
        this.deregister = self.registerInterruptKey();
    }

    async onDrag(offsetX: number, offsetY: number) {
        const x2 = offsetX + this.layout.manager.scroll[0], y2 = offsetY + this.layout.manager.scroll[1];
        const b: Box = {
            x: Math.min(this.x1, x2), y: Math.min(this.y1, y2),
            w: Math.abs(this.x1 - x2), h: Math.abs(this.y1 - y2)
        };
        this.self.selectBox = b;

        const newGroup = this.layout.findEntriesByPosition(b.x, b.y, b.w, b.h);
        if (newGroup.length != this.thisGroup.length) {
            this.self.selection = new SvelteSet(
                [...this.origSelection, ...newGroup]);
            this.thisGroup = newGroup;
            await this.self.dispatchSelectionChanged();
        }
        await this.layout.keepPosInSafeArea((x2 - this.layout.leftColumnWidth) / this.layout.scale);
        this.layout.manager.requestRender();
    }

    onDragEnd(): void {
        this.deregister();
        this.self.currentAction = undefined;
        this.self.selectBox = null;
        this.layout.manager.requestRender();
    }

    override async interrupt() {
        this.self.currentAction = undefined;
        this.self.selectBox = null;
        this.self.selection = new SvelteSet(this.origSelection);
        await this.self.dispatchSelectionChanged();
        this.layout.manager.requestRender();
    }
}
