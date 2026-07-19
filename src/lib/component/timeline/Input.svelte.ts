import type { CanvasManager } from "../../CanvasManager";
import { Basic } from "../../Basic";
import { Debug } from "../../Debug";

import { SubtitleEntry, type SubtitleStyle } from "../../core/Subtitles.svelte";
import { RichText } from "../../core/RichText";
import { InputConfig } from "../../config/Groups";

import type { TranslatedWheelEvent } from "../../frontend/Frontend";
import { Source, ChangeType, ChangeCause } from "../../frontend/Source";
import { Playback } from "../../frontend/Playback";
import { Editing, SelectMode } from "../../frontend/Editing";
import { Memorized } from "../../config/MemorizedValue.svelte";

import { SubtitleTableHandle } from "../subtitleTable/Input.svelte";
import { TimelineConfig } from "./Config";
import { contextMenu } from "./Menu";
import { TimelineLayout, type Box } from "./Layout";

import { SvelteSet } from "svelte/reactivity";
import { get } from "svelte/store";
import { _ } from "svelte-i18n";
import * as z from "zod/v4-mini";

export const TimelineHandle = {
    lockCursor: Memorized.$('lockCursor', z.boolean(), false),
    snapToFrame: Memorized.$('snapToFrame', z.boolean(), false),
    useSnap: Memorized.$overridable('useSnap', z.boolean(), true),
    currentMode: Memorized.$('currentMode',
        z.union([z.literal('select'), z.literal('create'), z.literal('split')]), 'select'),
    isDuringAction: () => false,
    interruptAction: async (): Promise<void> => {},
}

abstract class TimelineAction {
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

class Scale extends TimelineAction {
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

class MoveCursor extends TimelineAction {
    constructor(self: TimelineInput, layout: TimelineLayout, e0: MouseEvent) {
        super(self, layout, e0);
    }

    async onDrag(offsetX: number) {
        let curPos =
            (offsetX - this.layout.leftColumnWidth) / this.layout.scale + this.layout.offset;
        // always snap to frame, it's only valid that way with video loaded
        curPos = Playback.snapPositionToFrame(curPos, 'round');
        if (curPos == Playback.position) return;
        await Playback.setPosition(curPos);
    }
}

class BoxSelect extends TimelineAction {
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
        const x2 = offsetX + this.layout.manager.scroll[0],
              y2 = offsetY + this.layout.manager.scroll[1];
        const b: Box = {
            x: Math.min(this.x1, x2), y: Math.min(this.y1, y2),
            w: Math.abs(this.x1 - x2), h: Math.abs(this.y1 - y2)};
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

abstract class MoveResizeBase extends TimelineAction {
    changed = false;

    private deregister: () => void;

    constructor(
        self: TimelineInput, layout: TimelineLayout, e0: MouseEvent,
        protected origPositions: Map<SubtitleEntry, { start: number; end: number; }>,
        private afterEnd: () => void
    ) {
        super(self, layout, e0);
        this.deregister = self.registerInterruptKey();
    }

    async onDragEnd() {
        this.deregister();
        this.self.currentAction = undefined;
        this.self.alignmentLine = null;
        this.layout.manager.requestRender();
        if (this.changed)
            await Source.markChanged(ChangeType.Times, get(_)('c.drag-to-move-resize'));
        else
            this.afterEnd();
    }

    override interrupt() {
        this.self.currentAction = undefined;
        this.self.alignmentLine = null;
        for (const [ent, pos] of this.origPositions.entries()) {
            ent.start = pos.start;
            ent.end = pos.end;
        }
        this.layout.manager.requestRender();
    }
}

class DragMove extends MoveResizeBase {
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
                    } else
                        prev.set(style.name, [start, end]);
                };
                return prev;
            },
            new Map<string, [number, number]>());
        const points = [...map.values()].flat();
        return [...new Set(points)]
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

class DragSeam extends MoveResizeBase {
    origVal: number;

    constructor(self: TimelineInput, layout: TimelineLayout, e0: MouseEvent,
        private first: SubtitleEntry, private second: SubtitleEntry,
        afterEnd: () => Promise<void>)
    {
        super(self, layout, e0, new Map([
            [first, {start: first.start, end: first.end}],
            [second, {start: second.start, end: second.end}]
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

class DragResize extends MoveResizeBase {
    origVal: number;
    start: number;
    end: number;

    constructor(self: TimelineInput, layout: TimelineLayout, e0: MouseEvent,
        origPositions: Map<SubtitleEntry, { start: number; end: number; }>,
        afterEnd: () => Promise<void>,
        private where: 'start' | 'end',
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

class CreateEntry extends TimelineAction {
    entry: SubtitleEntry;
    style: SubtitleStyle;

    private deregister: () => void;

    constructor(self: TimelineInput, layout: TimelineLayout, e0: MouseEvent, style: SubtitleStyle) {
        super(self, layout, e0);
        const startPos = this.self.alignmentLine?.pos ?? this.origPos;
        this.entry = Editing.insertAtTime(startPos, startPos, style);
        this.style = style;
        this.deregister = self.registerInterruptKey();
    }

    onDrag(offsetX: number, _offsetY: number): void {
        const curPos = this.self.makeAlignmentLine(offsetX, {always: true});
        if (curPos >= this.entry.start)
            this.entry.end = curPos;
        this.layout.manager.requestRender();
    }

    async onDragEnd() {
        this.deregister();
        this.self.currentAction = undefined;
        if (this.entry.end == this.entry.start) {
            // we assume this is a mistake and treat it like a cancelled action
            await this.onDragInterrupted();
        } else {
            if (get(Editing.useUntimedForNewEntires)) {
                await Editing.fillWithFirstLineOfUntimed(this.entry, this.style);
            }
            await Source.markChanged(ChangeType.Times, get(_)('c.drag-to-create'));
            // TODO: start editing?
        }
    }

    override interrupt() {
        this.self.currentAction = undefined;
        const i = Source.subs.entries.indexOf(this.entry);
        if (i < 0) return Debug.early();
        Source.subs.entries.splice(i, 1);
    }
}

class SplitEntry extends TimelineAction {
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
                newEntry.texts.set(style, RichText.substring(text, 0, pos));
                target.texts.set(style, RichText.substring(text, pos));
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

export class TimelineInput {
    private readonly manager: CanvasManager;

    selectBox: Box | null = null;
    selection = new SvelteSet<SubtitleEntry>;
    alignmentLine: { pos: number, rows: Set<number> } | null = null;
    currentAction: TimelineAction | undefined;

    // ad-hoc, for rendering
    splitting: null | {
        target: SubtitleEntry,
        breakPosition: number,
        positions: Map<SubtitleStyle, number>,
        current: SubtitleStyle
    } = null;

    constructor(private layout: TimelineLayout) {
        this.manager = layout.manager;

        this.manager.canvas.oncontextmenu = (e) => e.preventDefault();
        this.manager.canvas.ondblclick = () => this.#onDoubleClick();
        this.manager.onMouseMove.bind(this, this.#onMouseMove.bind(this));
        this.manager.onMouseDown.bind(this, this.#onMouseDown.bind(this));

        this.manager.canBeginDrag = this.#canBeginDrag.bind(this);
        this.manager.onDrag.bind(this, this.#onDrag.bind(this));
        this.manager.onDragEnd.bind(this, this.#onDragEnd.bind(this));
        this.manager.onDragInterrupted.bind(this, this.#onDragInterrupted.bind(this));

        this.manager.onMouseWheel.bind(this, this.#onMouseWheel.bind(this));
        this.manager.onUserScroll.bind(this, () => {this.layout.requestedSampler = true});

        Editing.onSelectionChanged.bind(this, async (cause) => {
            if (cause != ChangeCause.Timeline) {
                this.selection = new SvelteSet(Editing.getSelection());
                const focused = Editing.getFocusedEntry();
                if (focused instanceof SubtitleEntry)
                    await this.layout.keepEntryInView(focused);
                this.manager.requestRender();
            }
        });

        this.layout.onLayout.bind(this, () => {
            const active = Source.subs.view.timelineActiveChannel?.deref();
            if (active && !this.layout.shownStyles.includes(active))
                Source.subs.view.timelineActiveChannel = null;
        });

        this.currentAction = $state();
        TimelineHandle.isDuringAction = () => this.currentAction !== undefined;
        TimelineHandle.interruptAction = async () => {
            if (!this.currentAction) return;
            this.manager.requestRender();
            await this.currentAction.interrupt();
        };
    }

    /**
     * Suppose there is a ruler on the number axis which has a set of `points` on it and can be
     * moved around by dragging a point at the `reference` location. The goal is to move the
     * reference point slightly (no further than `minDist`) so that one of the `points` aligns with
     * the `target`. If this can't be done, keep the reference point at its original location.
     * Returns the modified reference point and the minimal distance required to move it.
     */
    trySnap(
        data: {minDist: number, reference: number, oldReference?: number},
        points: number[], target: number
    ) {
        const old = data.oldReference ?? data.reference;
        let result = undefined;
        for (const point of points) {
            const diff = point + data.reference - old - target;
            const d = Math.abs(diff);
            if (d < data.minDist) {
                this.alignmentLine = { pos: target, rows: new Set() };
                result = old + target - point;
                data.minDist = d;
            }
        }
        return result;
    }

    snapVisible(points: number[], reference = points[0], includeSelection = false) {
        const data = {
            minDist: TimelineConfig.data.snapDistance / this.layout.scale,
            reference: reference,
            oldReference: points[0]
        };
        let snapped = reference;
        this.alignmentLine = null;
        snapped = this.trySnap(data, points, Playback.position) ?? snapped;
        snapped = this.trySnap(data, points, 0) ?? snapped;
        for (const e of this.layout.getVisibleEntries()) {
            if (this.selection.has(e) && !includeSelection) continue;
            snapped = this.trySnap(data, points, e.start) ?? snapped;
            snapped = this.trySnap(data, points, e.end) ?? snapped;
        }
        if (this.alignmentLine) {
            // TypeScript mistakenly thinks `alignmentLine` is `never`
            const line = this.alignmentLine as { rows: Set<number> };
            const set = new Set<SubtitleStyle>();
            for (const e of this.layout.getVisibleEntries()) {
                if (Math.abs(e.start - snapped) < 0.0001 || Math.abs(e.end - snapped) < 0.0001)
                    [...e.texts.keys()].forEach((x) => set.add(x));
            }
            line.rows.clear();
            this.layout.shownStyles.forEach((s, i) => {
                if (set.has(s))
                    line?.rows.add(i);
            });
        }
        return snapped;
    }

    convertX(x: number) {
        return this.layout.offset + (x - this.layout.leftColumnWidth) / this.layout.scale;
    }

    async dispatchSelectionChanged() {
        await Editing.clearFocus();
        Editing.selection.submitted = new Set(this.selection);
        if (this.selection.size == 1) {
            const array = [...this.selection.values()];
            Editing.selection.currentGroup = new Set(array);
            Editing.selection.focused = array[0];
        } else {
            Editing.selection.currentGroup.clear();
            Editing.selection.focused = null;
        }
        Editing.onSelectionChanged.dispatch(ChangeCause.Timeline);
    }

    selectionFirstLast() {
        Debug.assert(this.selection.size > 0);
        const sels = [...this.selection];
        return sels.reduce<[SubtitleEntry, SubtitleEntry]>(
            ([pf, pl], current) => [
                current.start < pf.start ? current : pf,
                current.end > pl.end ? current : pl],
            [sels[0], sels[0]]);
    }

    async #onMouseWheel(tr: TranslatedWheelEvent, e: WheelEvent) {
        if (tr.isZoom) {
            const origPos = this.convertX(e.offsetX);
            await this.layout.setScale(this.layout.scale / Math.pow(1.03, tr.amount));
            await this.layout.setOffset(
                origPos - (e.offsetX - this.layout.leftColumnWidth) / this.layout.scale);
        } else {
            const amount =
                tr.isTrackpad ? tr.amountX :
                tr.amountX == 0 ? tr.amountY : tr.amountX;
            await this.layout.setOffset(this.layout.offset + amount * 0.5 / this.layout.scale);
        }
    }

    #onDoubleClick() {
        if (this.selection.size == 1
         && Editing.getFocusedEntry() == [...this.selection][0])
        {
            void SubtitleTableHandle.processDoubleClick?.();
        }
    }

    makeAlignmentLine(x: number, {always = false, includeSelection = false}) {
        const pos = this.convertX(x);
        const old = this.alignmentLine?.pos;
        const snap = TimelineHandle.useSnap.get();
        let newPos = pos;
        if (snap)
            newPos = this.snapVisible([pos], pos, includeSelection);
        if (Basic.approx(newPos, pos, InputConfig.data.epsilon) && TimelineHandle.snapToFrame.get())
            newPos = Playback.snapPositionToFrame(newPos, 'round');

        if (!snap || (always && this.alignmentLine === null))
            this.alignmentLine = { pos: newPos, rows: new Set() };
        if (this.alignmentLine?.pos !== old)
            this.manager.requestRender();
        return this.alignmentLine?.pos ?? newPos;
    }

    #hitTest(e: MouseEvent) {
        const inLeftColumn = e.offsetX < this.layout.leftColumnWidth;
        const inHeader = e.offsetY < TimelineLayout.HEADER_HEIGHT;

        const ctrlHeld = e.getModifierState(Basic.ctrlKey);
        const underMouse = (inLeftColumn || inHeader) ? []
            : this.layout.findEntriesByPosition(
                e.offsetX + this.manager.scroll[0], e.offsetY + this.manager.scroll[1]);

        if (inLeftColumn || inHeader || underMouse.length === 0) {
            return {
                inLeftColumn, inHeader, ctrlHeld,
                hover: undefined
            };
        }

        const targetEntry = underMouse.find((x) => this.selection.has(x)) ?? underMouse[0];
        const isOverSelected = underMouse.some((x) => this.selection.has(x));
        const isMultiselect = (this.selection.size > 1 || ctrlHeld) && isOverSelected;
        const shouldCheckSeam = this.selection.size <= 2 || !isOverSelected;

        const [w, x] = this.layout.getHorizontalPos(targetEntry, {local: true});
        const singleDistL = e.offsetX - x;
        const singleDistR = x + w - e.offsetX;

        let selDistL: number, selDistR: number;
        const origPos = this.convertX(e.offsetX);
        if (isOverSelected) {
            const [first, last] = this.selectionFirstLast();
            selDistL = (origPos - first.start) * this.layout.scale;
            selDistR = (last.end - origPos) * this.layout.scale;
        } else {
            selDistL = (origPos - targetEntry.start) * this.layout.scale;
            selDistR = (targetEntry.end - origPos) * this.layout.scale;
        }

        let seam: readonly [SubtitleEntry, SubtitleEntry] | null = null;
        if (shouldCheckSeam) {
            const seamArea = TimelineConfig.data.dragSeamArea;
            if (singleDistL <= seamArea)
                seam = this.#getConnected(e, targetEntry, 'start') ?? null;
            if (!seam && singleDistR <= seamArea)
                seam = this.#getConnected(e, targetEntry, 'end') ?? null;
        }

        return {
            inLeftColumn, inHeader, ctrlHeld,
            hover: {
                underMouse,
                targetEntry,
                isOverSelected,
                isMultiselect,
                singleDistL, singleDistR,
                selDistL, selDistR,
                seam,
                shouldCheckSeam,
            }
        };
    }

    #targetCursor: string | undefined;
    #setCursor(c: string) {
        if (this.#targetCursor === undefined) {
            requestAnimationFrame(() => {
                Debug.assert(this.#targetCursor !== undefined);
                this.manager.canvas.style.cursor = this.#targetCursor;
                this.#targetCursor = undefined;
            });
        }
        this.#targetCursor = c;
    }

    #onMouseMove(e: MouseEvent) {
        this.#setCursor('default');

        if (this.currentAction?.onMouseMove(e))
            return;

        const h = this.#hitTest(e);

        if (h.inLeftColumn)
            return;

        if (h.inHeader) {
            this.#setCursor('col-resize');
            return;
        }

        if (TimelineHandle.currentMode.get() == 'split') {
            if (h.hover) this.#setCursor('text');
            this.makeAlignmentLine(e.offsetX, {always: true});
            return;
        }
        if (TimelineHandle.currentMode.get() == 'create' && !h.hover) {
            this.#setCursor('crosshair');
            this.makeAlignmentLine(e.offsetX, {always: true, includeSelection: true});
            return;
        }

        if (this.alignmentLine !== null) {
            this.alignmentLine = null;
            this.manager.requestRender();
        }

        if (!h.hover || h.ctrlHeld)
            return;

        const ent = h.hover.targetEntry;
        const resizeArea = TimelineConfig.data.dragResizeArea;

        if ((ent.end - ent.start) * this.layout.scale < resizeArea * 2) {
            this.#setCursor('move');
            return;
        }

        if (h.hover.selDistL > resizeArea && h.hover.selDistR > resizeArea)
            this.#setCursor('move');
        else this.#setCursor(h.hover.selDistL <= TimelineConfig.data.dragResizeArea
            ? 'e-resize' : 'w-resize');

        if (h.hover.seam) {
            this.#setCursor('col-resize');
            return;
        }
    }

    #getConnected(e0: MouseEvent, current: SubtitleEntry, pos: 'start' | 'end') {
        // check seams
        const channel = this.layout.getChannelFromOffsetY(e0.offsetY);
        if (!channel) return undefined;
        for (const ent of Source.subs.entries) {
            if (ent == current || !ent.texts.has(channel)) continue;
            if (pos == 'start' && Basic.approx(ent.end, current.start, InputConfig.data.epsilon))
                return [ent, current] as const;
            else if (pos == 'end' && Basic.approx(ent.start, current.end, InputConfig.data.epsilon))
                return [current, ent] as const;
        }
        return undefined;
    }

    #onMouseDown(e: MouseEvent) {
        if (e.offsetX < this.layout.leftColumnWidth) {
            const style = this.layout.getChannelFromOffsetY(e.offsetY);
            if (style) {
                if (Source.subs.view.timelineActiveChannel?.deref() === style)
                    Source.subs.view.timelineActiveChannel = null;
                else
                    Source.subs.view.timelineActiveChannel = new WeakRef(style);
                this.manager.requestRender();
            }
            return;
        }

        if (this.currentAction?.onMouseDown(e))
            return;
    }

    #canBeginDrag(e0: MouseEvent): boolean {
        const h = this.#hitTest(e0);

        if (h.inLeftColumn)
            return false;

        if (this.currentAction !== undefined)
            return this.currentAction.canBeginDrag(e0);

        if (h.inHeader) {
            this.currentAction = new MoveCursor(this, this.layout, e0);
            void this.#onDrag(e0.offsetX, e0.offsetY, e0);
            return true;
        }

        if (e0.button == 1) {
            this.currentAction = new Scale(this, this.layout, e0);
            return true;
        }

        if (e0.button == 2) {
            void (async () => {
                if (h.hover
                 && !h.hover.underMouse.some((x) => this.selection.has(x)))
                {
                    await Editing.clearSelection(ChangeCause.Timeline);
                    await Editing.selectEntry(h.hover.underMouse[0],
                        SelectMode.Single, ChangeCause.Action);
                }
                await contextMenu();
            })();
            return false;
        }

        if (e0.button != 0)
            Debug.assert(false);

        if (!h.hover) {
            if (!e0.getModifierState(Basic.ctrlKey)) {
                void Editing.clearSelection(ChangeCause.Timeline);
                this.selection.clear();
                this.manager.requestRender();
            }
            if (TimelineHandle.currentMode.get() == 'create') {
                const style = this.layout.getChannelFromOffsetY(e0.offsetY);
                if (!style) return false;
                this.currentAction = new CreateEntry(this, this.layout, e0, style);
            } else {
                this.currentAction = new BoxSelect(this, this.layout, e0);
            }
            return true;
        }

        const target = h.hover.targetEntry;

        if (h.ctrlHeld) {
            if (!this.selection.has(target))
                this.selection.add(target);
            else
                this.selection.delete(target);
            void this.dispatchSelectionChanged();
            this.manager.requestRender();
            return false;
        }

        if (!h.hover.isOverSelected) {
            this.selection.clear();
            this.selection.add(target);
            void Editing.selectEntry(target,
                SelectMode.Single, ChangeCause.Timeline);
        }

        if (TimelineHandle.currentMode.get() == 'split') {
            const split = SplitEntry.create(this, this.layout, e0, target);
            if (!split) return false;
            this.currentAction = split;
            return true;
        }

        this.manager.requestRender();

        // Currently we don't have any drag-end logic. There used to be a feature where,
        // when there are multiple overlapping entries under the mouse position, clicking
        // would cycle through them when single-selecting (this happens at drag-end if no
        // other action such as dragging has happened). We removed it because it's tricky
        // to make it coherent with other actions.

        const sels = [...this.selection];
        if (sels.length == 0) return false;

        const origPositions = new Map(
            sels.map((x) => [x, { start: x.start, end: x.end }]));
        const afterEnd = async () => {};

        if ((target.end - target.start) * this.layout.scale
         < TimelineConfig.data.dragResizeArea * 2)
        {
            this.currentAction = new DragMove(this, this.layout, e0,
                origPositions, afterEnd, h.hover.underMouse);
            return true;
        }

        if (h.hover.seam) {
            // manually set selection, avoiding the async Editing.setSelection
            this.selection = new SvelteSet(h.hover.seam);
            Editing.selection.submitted = new Set(h.hover.seam);
            Editing.selection.focused = h.hover.seam[0];
            Editing.selection.currentGroup = new Set([h.hover.seam[0]]);
            Editing.onSelectionChanged.dispatch(ChangeCause.Timeline);
            this.currentAction = new DragSeam(this, this.layout, e0,
                h.hover.seam[0], h.hover.seam[1], afterEnd);
            return true;
        }

        if (h.hover.selDistL > TimelineConfig.data.dragResizeArea
            && h.hover.selDistR > TimelineConfig.data.dragResizeArea)
        {
            this.currentAction = new DragMove(this, this.layout, e0,
                origPositions, afterEnd, h.hover.underMouse);
        } else {
            this.currentAction = new DragResize(this, this.layout, e0,
                origPositions, afterEnd,
                h.hover.selDistL <= TimelineConfig.data.dragResizeArea ? 'start' : 'end');
        }
        return true;
    }

    async #onDrag(offsetX: number, offsetY: number, ev: MouseEvent) {
        if (!this.currentAction) return;
        await this.currentAction.onDrag(offsetX, offsetY, ev);
    }

    registerInterruptKey() {
        // TODO: maybe make it a command ('interrupt timeline operation') instead?
        const f = async (ev: KeyboardEvent) => {
            if (ev.key == 'Escape') {
                if (this.manager.dragType == 'custom')
                    await this.manager.interruptDrag();
                else
                    await TimelineHandle.interruptAction();
                this.manager.requestRender();
            }
        };

        // eslint-disable-next-line @typescript-eslint/no-misused-promises
        document.addEventListener('keydown', f, { once: true });

        // eslint-disable-next-line @typescript-eslint/no-misused-promises
        return () => document.removeEventListener('keydown', f);
    };

    async #onDragEnd(offsetX: number, _offsetY: number, ev: MouseEvent) {
        if (!this.currentAction) return Debug.early();
        await this.currentAction.onDragEnd(offsetX, offsetX, ev);
    }

    async #onDragInterrupted() {
        if (!this.currentAction) return Debug.early();
        await this.currentAction.onDragInterrupted();
    }
}
