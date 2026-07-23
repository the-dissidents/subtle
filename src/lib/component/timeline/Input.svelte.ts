import type { CanvasManager } from "../../CanvasManager";
import { Basic } from "../../Basic";
import { Debug } from "../../Debug";

import { SubtitleEntry, type SubtitleStyle } from "../../core/Subtitles.svelte";
import { InputConfig } from "../../config/Groups";

import type { TranslatedWheelEvent } from "../../frontend/Frontend";
import { Source, ChangeCause } from "../../frontend/Source";
import { Playback } from "../../frontend/Playback";
import { Editing, SelectMode } from "../../frontend/Editing";
import { Memorized } from "../../config/MemorizedValue.svelte";

import { SubtitleTableHandle } from "../subtitleTable/Input.svelte";
import { TimelineConfig } from "./Config";
import { contextMenu } from "./Menu";
import { TimelineLayout, type Box } from "./Layout";

import { SvelteSet } from "svelte/reactivity";
import { _ } from "svelte-i18n";
import * as z from "zod/v4-mini";

import { MoveCursor } from "./actions/MoveCursor";
import { BoxSelect } from "./actions/BoxSelect";
import { Scale } from "./actions/Scale";
import { DragMove } from "./actions/DragMove";
import { DragSeam } from "./actions/DragSeam";
import { DragResize } from "./actions/DragResize";
import { CreateEntry } from "./actions/CreateEntry";
import { SplitEntry } from "./actions/SplitEntry";

export const TimelineHandle = {
    lockCursor: Memorized.$('lockCursor', z.boolean(), false),
    snapToFrame: Memorized.$('snapToFrame', z.boolean(), false),
    useSnap: Memorized.$overridable('useSnap', z.boolean(), true),
    currentMode: Memorized.$('currentMode',
        z.union([z.literal('select'), z.literal('create'), z.literal('split')]), 'select'),
    isDuringAction: () => false,
    interruptAction: async (): Promise<void> => {},
}

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
