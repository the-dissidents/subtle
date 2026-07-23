import { TimelineAction, TimelineInput } from "../Input.svelte";
import type { TimelineLayout } from "../Layout";

export class Scale extends TimelineAction {
    private origScale: number;
    private deregister: () => void;

    constructor(self: TimelineInput, layout: TimelineLayout, e0: MouseEvent) {
        super(self, layout, e0);
        this.origScale = this.layout.scale;
        this.deregister = self.registerInterruptKey();
    }

    async onDrag(_offsetX: number, _offsetY: number, ev: MouseEvent) {
        await this.layout.setScale(this.origScale /
            Math.pow(1.03, (this.e0.clientX - ev.clientX)));
        await this.layout.setOffset(this.origPos - this.e0.offsetX / this.layout.scale);
    }

    onDragEnd(_offsetX: number, _offsetY: number, _ev: MouseEvent): Promise<void> | void {
        this.deregister();
    }
}
