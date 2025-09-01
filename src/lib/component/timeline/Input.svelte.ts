import { SvelteSet } from "svelte/reactivity";
import type { CanvasManager } from "../../CanvasManager";
import { Editing, SelectMode } from "../../frontend/Editing";
import { Source, ChangeType, ChangeCause } from "../../frontend/Source";
import { TimelineLayout, type Box } from "./Layout";
import { SubtitleEntry, type SubtitleStyle } from "../../core/Subtitles.svelte";
import { Basic } from "../../Basic";
import { Debug } from "../../Debug";
import { Playback } from "../../frontend/Playback";
import type { TranslatedWheelEvent } from "../../frontend/Frontend";
import { TimelineConfig } from "./Config";
import { Memorized } from "../../config/MemorizedValue.svelte";
import { SubtitleTableHandle } from "../subtitleTable/Input.svelte";
import * as z from "zod/v4-mini";
import { contextMenu } from "./Menu";
import { get } from "svelte/store";
import { _ } from "svelte-i18n";

export const TimelineHandle = {
  lockCursor: Memorized.$('lockCursor', z.boolean(), false),
  snapToFrame: Memorized.$('snapToFrame', z.boolean(), false),
  useSnap: Memorized.$overridable('useSnap', z.boolean(), true),
  currentMode: Memorized.$('currentMode', 
    z.union([z.literal('select'), z.literal('create'), z.literal('split')]), 'select'),
}

abstract class TimelineAction {
  readonly origPos: number;
  
  constructor(public self: TimelineInput, public layout: TimelineLayout, public e0: MouseEvent) {
    this.origPos = this.self.convertX(e0.offsetX);
  }

  onMouseMove(e: MouseEvent): boolean { return false; }
  onMouseDown(e: MouseEvent): boolean { return false; }

  canBeginDrag(e0: MouseEvent): boolean {
    return false;
  }

  onDrag(offsetX: number, offsetY: number, ev: MouseEvent) {}

  onDragEnd(offsetX: number, offsetY: number, ev: MouseEvent) {
    this.self.currentAction = undefined;
  }
  onDragInterrupted() {
    this.self.currentAction = undefined;
  }
}

class Scale extends TimelineAction {
  private origScale: number;

  constructor(self: TimelineInput, layout: TimelineLayout, e0: MouseEvent) {
    super(self, layout, e0);
    this.origScale = this.layout.scale;
  }

  onDrag(offsetX: number, offsetY: number, ev: MouseEvent): void {
    this.layout.setScale(this.origScale / 
      Math.pow(1.03, (this.e0.clientX - ev.clientX)));
    this.layout.setOffset(this.origPos - this.e0.offsetX / this.layout.scale);
  }
}

class MoveCursor extends TimelineAction {
  constructor(self: TimelineInput, layout: TimelineLayout, e0: MouseEvent) {
    super(self, layout, e0);
  }

  onDrag(offsetX: number, offsetY: number, ev: MouseEvent): void {
    let curPos = 
      (offsetX - this.layout.leftColumnWidth) / this.layout.scale + this.layout.offset;
    // always snap to frame, it's only valid that way with video loaded
    curPos = Playback.snapPositionToFrame(curPos, 'round');
    if (curPos == Playback.position) return;
    Playback.setPosition(curPos);
  }
}

class BoxSelect extends TimelineAction {
  origSelection: SubtitleEntry[];
  thisGroup: SubtitleEntry[] = [];
  x1: number;
  y1: number;

  constructor(self: TimelineInput, layout: TimelineLayout, e0: MouseEvent) {
    super(self, layout, e0);
    this.origSelection = Editing.getSelection();
    this.x1 = e0.offsetX + this.layout.manager.scroll[0],
    this.y1 = e0.offsetY + this.layout.manager.scroll[1];
  }

  onDrag(offsetX: number, offsetY: number, ev: MouseEvent): void {
    let x2 = offsetX + this.layout.manager.scroll[0],
        y2 = offsetY + this.layout.manager.scroll[1];
    let b: Box = {
      x: Math.min(this.x1, x2), y: Math.min(this.y1, y2), 
      w: Math.abs(this.x1 - x2), h: Math.abs(this.y1 - y2)};
    this.self.selectBox = b;
    let newGroup = this.layout.findEntriesByPosition(b.x, b.y, b.w, b.h);
    if (newGroup.length != this.thisGroup.length) {
      this.self.selection = new SvelteSet(
        [...this.origSelection, ...newGroup]);
      this.thisGroup = newGroup;
      this.self.dispatchSelectionChanged();
    }
    this.layout.keepPosInSafeArea((x2 - this.layout.leftColumnWidth) / this.layout.scale);
    this.layout.manager.requestRender();
  }

  onDragEnd(): void {
    this.self.currentAction = undefined;
    this.self.selectBox = null;
    this.layout.manager.requestRender();
  }

  onDragInterrupted(): void {
    this.self.currentAction = undefined;
    this.self.selectBox = null;
    this.self.selection = new SvelteSet(this.origSelection);
    this.self.dispatchSelectionChanged();
    this.layout.manager.requestRender();
  }
}

abstract class MoveResizeBase extends TimelineAction {
  changed = false;

  constructor(
    self: TimelineInput, layout: TimelineLayout, e0: MouseEvent, 
    protected origPositions: Map<SubtitleEntry, { start: number; end: number; }>,
    private afterEnd: () => void
  ) {
    super(self, layout, e0);
  }

  onDragEnd(): void {
    this.self.currentAction = undefined;
    this.self.alignmentLine = null;
    this.layout.manager.requestRender();
    if (this.changed)
      Source.markChanged(ChangeType.Times, get(_)('c.drag-to-move-resize'));
    else
      this.afterEnd();
  }

  onDragInterrupted(): void {
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
    afterEnd: () => void,
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

  onDrag(offsetX: number, offsetY: number, ev: MouseEvent): void {
    const dval = this.self.convertX(offsetX) - this.origPos;
    let newDval = dval;
    if (TimelineHandle.useSnap.get())
      newDval = this.self.snapVisible(this.points, this.start + dval) - this.start;
    if (Basic.approx(newDval, dval) && TimelineHandle.snapToFrame.get())
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
    afterEnd: () => void)
  {
    super(self, layout, e0, new Map([
      [first, {start: first.start, end: first.end}],
      [second, {start: second.start, end: second.end}]
    ]), afterEnd);
    Debug.assert(Basic.approx(first.end, second.start));
    this.origVal = first.end;
  }

  onDrag(offsetX: number, offsetY: number, ev: MouseEvent): void {
    const val = this.origVal + this.self.convertX(offsetX) - this.origPos;
    let newVal = val;
    if (TimelineHandle.useSnap.get())
      newVal = this.self.snapVisible([val]);
    if (Basic.approx(newVal, val) && TimelineHandle.snapToFrame.get())
      newVal = Playback.snapPositionToFrame(val, 'round');
    newVal = Math.max(this.first.start, Math.min(this.second.end, newVal));
    this.first.end = newVal;
    this.second.start = newVal;

    this.changed = newVal != this.origVal;
    this.layout.keepPosInSafeArea(newVal);
    this.layout.manager.requestRender();
  }
}

class DragResize extends MoveResizeBase {
  origVal: number;
  start: number;
  end: number;

  constructor(self: TimelineInput, layout: TimelineLayout, e0: MouseEvent,
    origPositions: Map<SubtitleEntry, { start: number; end: number; }>,
    afterEnd: () => void,
    private where: 'start' | 'end',
  ) {
    super(self, layout, e0, origPositions, afterEnd);
    const [first, last] = this.self.selectionFirstLast();
    this.origVal = where == 'start' ? first.start : last.end,
    this.start = first.start;
    this.end = last.end;
  }

  onDrag(offsetX: number, offsetY: number, ev: MouseEvent): void {
    const val = this.origVal + this.self.convertX(offsetX) - this.origPos;
    let newVal = val;
    if (TimelineHandle.useSnap.get())
      newVal = this.self.snapVisible([val]);
    if (Basic.approx(newVal, val) && TimelineHandle.snapToFrame.get())
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
    this.layout.keepPosInSafeArea(newVal);
    this.layout.manager.requestRender();
  }
}

class CreateEntry extends TimelineAction {
  entry: SubtitleEntry;
  style: SubtitleStyle;

  constructor(self: TimelineInput, layout: TimelineLayout, e0: MouseEvent, style_: SubtitleStyle) {
    super(self, layout, e0);
    const startPos = this.self.alignmentLine?.pos ?? this.origPos;
    this.entry = Editing.insertAtTime(startPos, startPos, style_);
    this.style = style_;
  }

  onDrag(offsetX: number, offsetY: number, ev: MouseEvent): void {
    const curPos = this.self.makeAlignmentLine(offsetX, {always: true});
    if (curPos >= this.entry.start)
      this.entry.end = curPos;
    this.layout.manager.requestRender();
  }

  async onDragEnd() {
    this.self.currentAction = undefined;
    if (this.entry.end == this.entry.start) {
      this.onDragInterrupted();
    } else {
      if (get(Editing.useUntimedForNewEntires)) {
        Editing.fillWithFirstLineOfUntimed(this.entry, this.style);
      }
      Source.markChanged(ChangeType.Times, get(_)('c.drag-to-create'));
      // TODO: start editing?
    }
  }

  onDragInterrupted(): void {
    this.self.currentAction = undefined;
    const i = Source.subs.entries.indexOf(this.entry);
    Debug.assert(i >= 0);
    Source.subs.entries.splice(i, 1);
  }
}

class SplitEntry extends TimelineAction {
  styles: SubtitleStyle[];
  baseProportion: number;

  constructor(self: TimelineInput, layout: TimelineLayout, e0: MouseEvent, target: SubtitleEntry) {
    super(self, layout, e0);

    const pos = self.alignmentLine?.pos ?? this.origPos;
    Debug.assert(target.end > target.start);
    this.baseProportion = (pos - target.start) / (target.end - target.start);
    Debug.assert(this.baseProportion > 0 && this.baseProportion < 1);
    this.styles = Source.subs.styles.filter((x) => target.texts.has(x));
    self.splitting = {
      target, 
      breakPosition: pos,
      positions: new Map(),
      current: this.styles[0]
    };
    this.onDrag(e0.offsetX);
  }

  override onMouseMove(e: MouseEvent): boolean {
    // keep alignment line at same position
    return true;
  }

  override canBeginDrag(e0: MouseEvent): boolean {
    this.onDrag(e0.offsetX);
    return true;
  }
  
  override onDrag(offsetX: number) {
    const split = this.self.splitting!;
    const target = split.target;
    const currentPos = this.self.convertX(offsetX);
    const x = (split.breakPosition - currentPos) / (target.end - target.start) 
      + this.baseProportion;
    const style = this.styles[0];
    const text = target.texts.get(style)!;
    const pos = Math.max(1, Math.min(text.length - 1, Math.floor(x * text.length)));
    split.positions.set(style, pos);
    this.layout.manager.requestRender();
    return true;
  }

  override onDragInterrupted(): void {
    this.self.splitting = null;
    this.self.currentAction = undefined;
    this.layout.manager.requestRender();
  }

  override onDragEnd(offsetX: number) {
    this.styles.shift();

    if (this.styles.length == 0) {
      // all done, do split
      const target = this.self.splitting!.target;
      const index = Source.subs.entries.indexOf(target);
      Debug.assert(index >= 0);

      const newEntry = new SubtitleEntry(target.start, this.origPos);
      Source.subs.entries.splice(index, 0, newEntry);
      newEntry.label = target.label;
      target.start = this.origPos;
      for (const [style, text] of [...target.texts]) {
        const pos = this.self.splitting!.positions.get(style)!;
        newEntry.texts.set(style, text.substring(0, pos));
        target.texts.set(style, text.substring(pos));
      }
      Source.markChanged(ChangeType.Times, get(_)('c.split-entry-timeline'));

      this.self.splitting = null;
      this.self.currentAction = undefined;
    } else {
      this.self.splitting!.current = this.styles[0];
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
  splitting: null | { 
    target: SubtitleEntry, 
    breakPosition: number,
    positions: Map<SubtitleStyle, number>, 
    current: SubtitleStyle 
  } = null;
  currentAction: TimelineAction | undefined;

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

    Editing.onSelectionChanged.bind(this, (cause) => {
      if (cause != ChangeCause.Timeline) {
        this.selection = new SvelteSet(Editing.getSelection());
        let focused = Editing.getFocusedEntry();
        if (focused instanceof SubtitleEntry)
          this.layout.keepEntryInView(focused);
        this.manager.requestRender();
      }
    });

    this.layout.onLayout.bind(this, () => {
      const active = Source.subs.view.timelineActiveChannel;
      if (active && !this.layout.shownStyles.includes(active))
        Source.subs.view.timelineActiveChannel = null;
    });
  }

  /**
   * Suppose there is a ruler on the number axis, which has a set of `points` on it and can be 
   * moved around by dragging a point at the `reference` location. The goal is to move the reference
   * point slightly (no further than `minDist`) so that one of the `points` aligns with the 
   * `target`. If this can't be done, keep the reference point at its original location. Returns the
   * modified reference point and the minimal distance required to move it.
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

  dispatchSelectionChanged() {
    Editing.clearFocus();
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
        current.end > pl.end ? current : pf], 
      [sels[0], sels[0]]);
  }

  #onMouseWheel(tr: TranslatedWheelEvent, e: WheelEvent) {
    if (tr.isZoom) {
      const origPos = this.convertX(e.offsetX);
      this.layout.setScale(this.layout.scale / Math.pow(1.03, tr.amount));
      this.layout.setOffset(
        origPos - (e.offsetX - this.layout.leftColumnWidth) / this.layout.scale);
    } else {
      const amount = 
        tr.isTrackpad ? tr.amountX :
        tr.amountX == 0 ? tr.amountY : tr.amountX;
      this.layout.setOffset(this.layout.offset + amount * 0.5 / this.layout.scale);
    }
  }

  #onMouseDown(e: MouseEvent) {
    if (e.offsetX < this.layout.leftColumnWidth) {
      const style = this.layout.getChannelFromOffsetY(e.offsetY);
      if (style) {
        if (Source.subs.view.timelineActiveChannel == style)
          Source.subs.view.timelineActiveChannel = null;
        else 
          Source.subs.view.timelineActiveChannel = style;
        this.manager.requestRender();
      }
      return;
    }

    if (this.currentAction?.onMouseDown(e))
      return;

    if (e.button == 2) {
      e.preventDefault();
      contextMenu();
    }
  }

  #onDoubleClick() {
    if (this.selection.size == 1) {
      let one = [...this.selection][0];
      if (Editing.getFocusedEntry() == one) {
        SubtitleTableHandle.processDoubleClick?.();
      }
    }
  }

  makeAlignmentLine(x: number, {always = false, includeSelection = false}) {
    const pos = this.convertX(x);
    const old = this.alignmentLine?.pos;
    const snap = TimelineHandle.useSnap.get();
    let newPos = pos;
    if (snap)
      newPos = this.snapVisible([pos], pos, includeSelection);
    if (Basic.approx(newPos, pos) && TimelineHandle.snapToFrame.get())
      newPos = Playback.snapPositionToFrame(newPos, 'round');
    
    if (!snap || (always && this.alignmentLine === null))
      this.alignmentLine = { pos: newPos, rows: new Set() };
    if (this.alignmentLine?.pos !== old)
      this.manager.requestRender();
    return this.alignmentLine?.pos ?? newPos;
  }

  #onMouseMove(e: MouseEvent) {
    const canvas = this.manager.canvas;
    canvas.style.cursor = 'default';

    if (e.offsetX < this.layout.leftColumnWidth)
      return;

    if (this.currentAction?.onMouseMove(e))
      return;

    if (e.offsetY < TimelineLayout.HEADER_HEIGHT) {
      canvas.style.cursor = 'col-resize';
      return;
    }
  
    const under = this.layout.findEntriesByPosition(
      e.offsetX + this.manager.scroll[0], e.offsetY + this.manager.scroll[1]);

    if (TimelineHandle.currentMode.get() == 'split') {
      this.makeAlignmentLine(e.offsetX, {always: true});
      return;
    }
    if (TimelineHandle.currentMode.get() == 'create' && under.length == 0) {
      this.makeAlignmentLine(e.offsetX, {always: true, includeSelection: true});
      return;
    }

    if (this.alignmentLine !== null) {
      this.alignmentLine = null;
      this.manager.requestRender();
    }

    if (under.length == 0)
      return;
    canvas.style.cursor = 'move';
  
    const multiselecting = Basic.ctrlKey == 'Meta' ? e.metaKey : e.ctrlKey;
    const resizeArea = TimelineConfig.data.dragResizeArea;
    const seamArea = TimelineConfig.data.dragSeamArea;

    const ent = under.find((x) => this.selection.has(x)) ?? under[0];
    if ((ent.end - ent.start) * this.layout.scale < resizeArea * 2)
      return; // use move when entry is too small
    
    let distL: number, distR: number;
    if ((this.selection.size > 1 || multiselecting)
     && under.some((x) => this.selection.has(x)))
    {
      if (multiselecting) {
        // only show move cursor
        return;
      } else {
        let [first, last] = this.selectionFirstLast();
        const [ _, x1] = this.layout.getHorizontalPos(first, {local: true});
        const [w2, x2] = this.layout.getHorizontalPos(last, {local: true});
        distL = under.includes(first) ? e.offsetX - x1 : Infinity;
        distR = under.includes(last) ? x2 + w2 - e.offsetX : Infinity;
      }
    } else {
      const [w, x] = this.layout.getHorizontalPos(ent, {local: true});
      distL = e.offsetX - x;
      distR = x + w - e.offsetX;
      const seam =
          distL < seamArea ? this.#getConnected(e, ent, 'start')
        : distR < seamArea ? this.#getConnected(e, ent, 'end')
        : undefined;
      if (seam) {
        canvas.style.cursor = 'col-resize';
        return;
      }
    }

    if (distL < resizeArea)
      canvas.style.cursor = 'e-resize';
    else if (distR < resizeArea)
      canvas.style.cursor = 'w-resize';
  }

  #getConnected(e0: MouseEvent, current: SubtitleEntry, pos: 'start' | 'end') {
      // check seams
      const channel = this.layout.getChannelFromOffsetY(e0.offsetY);
      if (!channel) return undefined;
      for (const ent of Source.subs.entries) {
        if (ent == current || !ent.texts.has(channel)) continue;
        if (pos == 'start' && Basic.approx(ent.end, current.start))
          return [ent, current] as const;
        else if (pos == 'end' && Basic.approx(ent.start, current.end))
          return [current, ent] as const;
      }
      return undefined;
  }

  #initializeDrag(e0: MouseEvent, afterEnd: () => void, underMouse: SubtitleEntry[]) {
    const sels = [...this.selection];
    if (sels.length == 0) return false;

    // save original positions
    const origPositions = new Map(
      sels.map((x) => [x, { start: x.start, end: x.end }]));
    const [first, last] = this.selectionFirstLast();
    const origPos = this.convertX(e0.offsetX);

    const ent = underMouse.find((x) => this.selection.has(x)) ?? underMouse[0];
    if ((ent.end - ent.start) * this.layout.scale < TimelineConfig.data.dragResizeArea * 2) {
      // use move when entry is too small
      this.currentAction = new DragMove(this, this.layout, e0, 
        origPositions, afterEnd, underMouse);
      return true;
    }

    // drag seam
    if (sels.length <= 2 || !this.selection.has(ent)) {
      const distL = (origPos - ent.start) * this.layout.scale, 
            distR = (ent.end - origPos) * this.layout.scale;
      const seams = 
          distL <= TimelineConfig.data.dragSeamArea ? this.#getConnected(e0, ent, 'start')
        : distR <= TimelineConfig.data.dragSeamArea ? this.#getConnected(e0, ent, 'end')
        : undefined;
      if (seams) {
        // drag seam
        Editing.setSelection(seams);
        this.currentAction = new DragSeam(this, this.layout, e0, seams[0], seams[1], afterEnd);
        return true;
      }
    }

    const distL = (origPos - first.start) * this.layout.scale, 
          distR = (last.end - origPos) * this.layout.scale;
    if (distL > TimelineConfig.data.dragResizeArea 
      && distR > TimelineConfig.data.dragResizeArea)
    {
      // drag-move
      this.currentAction = new DragMove(this, this.layout, e0, 
        origPositions, afterEnd, underMouse);
      return true;
    } else {
      // drag-resize
      this.currentAction = new DragResize(this, this.layout, e0, 
        origPositions, afterEnd,
        distL <= TimelineConfig.data.dragResizeArea ? 'start' : 'end');
      return true;
    }
  }

  #canBeginDrag(e0: MouseEvent): boolean {
    if (e0.offsetX < this.layout.leftColumnWidth)
      return false;

    if (this.currentAction !== undefined)
      return this.currentAction.canBeginDrag(e0);

    this.#registerInterruptKey();

    // select
    if (e0.offsetY < TimelineLayout.HEADER_HEIGHT) {
      this.currentAction = new MoveCursor(this, this.layout, e0);
      this.#onDrag(e0.offsetX, e0.offsetY, e0);
      return true;
    } else {
      const underMouse = this.layout.findEntriesByPosition(
        e0.offsetX + this.manager.scroll[0], e0.offsetY + this.manager.scroll[1]);
      if (e0.button == 1) {
        this.currentAction = new Scale(this, this.layout, e0);
        return true;
      } else if (e0.button == 2) {
        // right-clicked on something
        // clear selection and re-select only if it's not selected
        if (!underMouse.some((x) => this.selection.has(x))) {
          Editing.clearSelection(ChangeCause.Timeline);
          Editing.selectEntry(underMouse[0], 
            SelectMode.Single, ChangeCause.Action);
        }
        // TODO: context menu?
        return false;
      } else if (e0.button == 0) {
        // left-clicked on nothing
        if (underMouse.length == 0) {
          if (!e0.getModifierState(Basic.ctrlKey)) {
            // clear selection
            Editing.clearSelection(ChangeCause.Timeline);
            this.selection.clear();
            this.manager.requestRender();
          }
          if (TimelineHandle.currentMode.get() == 'create') {
            // create entry
            const style = this.layout.getChannelFromOffsetY(e0.offsetY);
            if (!style) return false;
            this.currentAction = new CreateEntry(this, this.layout, e0, style);
            return true;
          } else {
            this.currentAction = new BoxSelect(this, this.layout, e0);
          }
          return true;
        }
        
        let afterEnd = () => {};
        // left-clicked on something
        // renew selection
        if (e0.getModifierState(Basic.ctrlKey)) {
          // multiple select. Only the first entry counts
          if (!this.selection.has(underMouse[0])) {
            this.selection.add(underMouse[0]);
            this.dispatchSelectionChanged();
            this.manager.requestRender();
          } else afterEnd = () => {
            // if hasn't dragged
            this.selection.delete(underMouse[0]);
            this.dispatchSelectionChanged();
            this.manager.requestRender();
          }
          return false;
        } else {
          // single select
          let selected = underMouse[0];
          if (this.selection.size > 1) {
            afterEnd = () => {
              this.selection.clear();
              this.selection.add(selected);
              Editing.selectEntry(selected, 
                SelectMode.Single, ChangeCause.Timeline);
            };
          } else {
            // cycle through the overlapping entries under the cursor
            let one = [...this.selection][0];
            selected = underMouse[(underMouse.indexOf(one) + 1) % underMouse.length];
            this.selection.clear();
            this.selection.add(selected);
            Editing.selectEntry(selected, 
              SelectMode.Single, ChangeCause.Timeline);
          }
          this.manager.requestRender();

          if (TimelineHandle.currentMode.get() == 'split') {
            this.currentAction = new SplitEntry(this, this.layout, e0, selected);
            return true;
          }
          return this.#initializeDrag(e0, afterEnd, underMouse);
        }
      }
    }

    Debug.assert(false);
  }
  
  #onDrag(offsetX: number, offsetY: number, ev: MouseEvent) {
    if (!this.currentAction) return;
    this.currentAction.onDrag(offsetX, offsetY, ev);
  }

  #registerInterruptKey() {
    // TODO: maybe make it a command ('interrupt timeline operation') instead?
    const f = (ev: KeyboardEvent) => {
      if (ev.key == 'Escape') {
        document.removeEventListener('keydown', f);
        this.manager.interruptDrag();
      }
    };

    this.manager.onDragEnd.bind(this, () => {
      document.removeEventListener('keydown', f);
    }, { once: true });

    document.addEventListener('keydown', f);
  };

  #onDragEnd(offsetX: number, offsetY: number, ev: MouseEvent) {
    if (!this.currentAction) return Debug.early('no action for onDragEnd');
    this.currentAction.onDragEnd(offsetX, offsetX, ev);
  }

  #onDragInterrupted() {
    if (!this.currentAction) return Debug.early('no action for onDragInterrupted');
    this.currentAction.onDragInterrupted();
  }
}