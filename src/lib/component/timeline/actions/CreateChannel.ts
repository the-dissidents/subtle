import type { SubtitleEntry } from "$lib/core/Subtitles.svelte";
import { Editing } from "$lib/frontend/Editing";
import { get } from "svelte/store";
import type { TimelineInput } from "../Input.svelte";
import type { TimelineLayout } from "../Layout";
import { TimelineAction } from "./TimelineAction";
import { ChangeType, Source } from "$lib/frontend/Source";
import { _ } from "svelte-i18n";

export class CreateChannel extends TimelineAction {
    private deregister: () => void;
    private readonly targets: Set<SubtitleEntry>;

    constructor(
        self: TimelineInput, layout: TimelineLayout,
        e0: MouseEvent, targets: SubtitleEntry[]
    ) {
        super(self, layout, e0);
        this.deregister = self.registerInterruptKey();
        this.targets = new Set(targets);
    }

    override onDrag(_offsetX: number, offsetY: number, _ev: MouseEvent): Promise<void> | void {
        const channel = this.layout.getChannelFromOffsetY(offsetY);
        if (!channel) return;

        this.self.newChannel = { targets: this.targets, channel };
        this.layout.manager.requestRender();
    }

    override async onDragEnd(_offsetX: number, offsetY: number) {
        await this.interrupt();

        const channel = this.layout.getChannelFromOffsetY(offsetY);
        if (!channel) return;

        for (const target of this.targets) {
            if (target.texts.get(channel)) continue;
            target.texts.set(channel, '');
            if (get(Editing.useUntimedForNewEntires))
                await Editing.fillWithFirstLineOfUntimed(target, channel);
        }

        await Source.markChanged(ChangeType.InPlace, get(_)('action.create-channel'));
    }

    override async interrupt() {
        await super.interrupt();
        this.deregister();
        this.self.newChannel = null;
    }
}
