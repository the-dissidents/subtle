import { SubtitleEntry, type SubtitleStyle } from "$lib/core/Subtitles.svelte";
import { ChangeType, Source } from "$lib/frontend/Source";
import { TimelineAction, TimelineInput } from "../Input.svelte";
import type { TimelineLayout } from "../Layout";
import { RichText } from "$lib/core/RichText";
import { Debug } from "$lib/Debug";
import { _ } from "svelte-i18n";
import { get } from "svelte/store";

export class SplitEntry extends TimelineAction {
    private deregister: () => void;

    static create(
        self: TimelineInput, layout: TimelineLayout,
        e0: MouseEvent, target: SubtitleEntry
    ) {
        Debug.assert(target.end > target.start);

        if (!self.alignmentLine) return null;
        const pos = self.alignmentLine.pos;
        if (pos <= target.start || pos >= target.end) return null;

        const baseProportion = (pos - target.start) / (target.end - target.start);
        const styles = Source.subs.styles.filter((x) => target.texts.has(x));
        self.splitting = {
            target,
            breakPosition: pos,
            positions: new Map(),
            current: styles[0]
        };

        return new SplitEntry(self, layout, e0, baseProportion, styles);
    }

    private constructor(
        self: TimelineInput, layout: TimelineLayout,
        e0: MouseEvent,
        private baseProportion: number,
        private styles: SubtitleStyle[],
    ) {
        super(self, layout, e0);
        this.onDrag(e0.offsetX);
        this.deregister = self.registerInterruptKey();
    }

    override onMouseMove(): boolean {
        // keep alignment line at same position
        return true;
    }

    override canBeginDrag(e0: MouseEvent): boolean {
        this.onDrag(e0.offsetX);
        return true;
    }

    override onDrag(offsetX: number) {
        Debug.assert(this.self.splitting !== null);
        const split = this.self.splitting;
        const target = split.target;
        const style = this.styles[0];
        const textLength = RichText.length(target.texts.get(style)!);
        const x = (split.breakPosition - this.self.convertX(offsetX)) / (target.end - target.start)
            + this.baseProportion;
        const pos = Math.max(0, Math.min(textLength, Math.floor(x * textLength)));
        split.positions.set(style, pos);
        this.layout.manager.requestRender();
    }

    override interrupt() {
        Debug.assert(this.self.splitting !== null);
        this.self.splitting = null;
        this.self.currentAction = undefined;
        this.layout.manager.requestRender();
    }

    override async onDragEnd(offsetX: number) {
        Debug.assert(this.self.splitting !== null);
        this.styles.shift();

        if (this.styles.length == 0) {
            // all done, do split
            this.deregister();
            const target = this.self.splitting.target;
            const index = Source.subs.entries.indexOf(target);
            if (index < 0) return Debug.early();

            const newEntry = new SubtitleEntry(target.start, this.origPos);
            Source.subs.entries.splice(index, 0, newEntry);
            newEntry.label = target.label;
            target.start = this.origPos;
            for (const [style, text] of target.texts) {
                const pos = this.self.splitting.positions.get(style)!;
                const first = RichText.substring(text, 0, pos);
                const second = RichText.substring(text, pos);
                newEntry.texts.set(style, RichText.trimEnd(first));
                target.texts.set(style, RichText.trimStart(second));
            }
            await Source.markChanged(ChangeType.Times, get(_)('c.split-entry-timeline'));

            this.self.splitting = null;
            this.self.currentAction = undefined;
        } else {
            this.self.splitting.current = this.styles[0];
            this.onDrag(offsetX);
        }
        this.layout.manager.requestRender();
    }
}
