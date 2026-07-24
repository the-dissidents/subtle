import type { TimelineLayout } from "../Layout";
import type { TimelineInput } from "../Input.svelte";

export abstract class TimelineAction {
    readonly origPos: number;

    constructor(public self: TimelineInput, public layout: TimelineLayout, public e0: MouseEvent) {
        this.origPos = this.self.convertX(e0.offsetX);
    }

    onMouseMove(_e: MouseEvent): boolean { return false; }
    onMouseDown(_e: MouseEvent): boolean { return false; }
    canBeginDrag(_e0: MouseEvent): boolean { return false; }

    onDrag(_offsetX: number, _offsetY: number, _ev: MouseEvent): Promise<void> | void {}

    onDragEnd(_offsetX: number, _offsetY: number, _ev: MouseEvent): Promise<void> | void {
        return this.interrupt();
    }

    onDragInterrupted(): Promise<void> | void {
        return this.interrupt();
    }

    interrupt(): Promise<void> | void {
        this.self.currentAction = undefined;
    }
}
