import { SvelteSet } from "svelte/reactivity";
import type { CanvasManager } from "../../CanvasManager";
import { Editing, SelectMode } from "../../frontend/Editing";
import { Source, ChangeType, ChangeCause } from "../../frontend/Source";
import { TimelineLayout, type Box } from "./Layout";
import { SubtitleEntry } from "../../core/Subtitles.svelte";
import { Basic } from "../../Basic";
import { Debug } from "../../Debug";
import { Playback } from "../../frontend/Playback";
import type { TranslatedWheelEvent } from "../../frontend/Frontend";
import { TimelineConfig } from "./Config";

abstract class TimelineAction {
  readonly origPos: number;
  
  constructor(public self: TimelineInput, public layout: TimelineLayout, public e0: MouseEvent) {
    this.origPos = this.layout.offset + 
      (e0.offsetX - this.layout.leftColumnWidth) / this.layout.scale;
  }

  onMouseMove(e: MouseEvent) {}
  onDrag(offsetX: number, offsetY: number, ev: MouseEvent) {}
  onDragEnd() {}
  onDragInterrupted() {}
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
    const curPos = 
      (offsetX - this.layout.leftColumnWidth) / this.layout.scale + this.layout.offset;
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
    this.y1 = e0.offsetY;
  }

  onDrag(offsetX: number, offsetY: number, ev: MouseEvent): void {
    let x2 = offsetX + this.layout.manager.scroll[0],
        y2 = offsetY;
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
    this.self.selectBox = null;
    this.layout.manager.requestRender();
  }

  onDragInterrupted(): void {
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
    this.self.alignmentLine = null;
    this.layout.manager.requestRender();
    if (this.changed)
      Source.markChanged(ChangeType.Times);
    else
      this.afterEnd();
  }

  onDragInterrupted(): void {
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

  #snapMove(points: number[], origStart: number, desiredStart: number) {
    const snap = (x: number, y1: number, y2: number) => {
      for (const point of points) {
        const d = Math.abs(desiredStart - x + point - origStart);
        if (d < minDist) {
          this.self.alignmentLine = {
            x: x * this.layout.scale + this.layout.leftColumnWidth, 
            y1, y2
          };
          snapped = x - point + origStart;
          minDist = d;
        }
      }
    };
    let minDist = TimelineConfig.data.snapDistance / this.layout.scale;
    let snapped = desiredStart; 
    this.self.alignmentLine = null;
    snap(Playback.position, 0, this.layout.height);
    for (const e of this.layout.getVisibleEntries()) {
      if (this.self.selection.has(e)) continue;
      const positions = this.layout.getEntryPositions(e);
      const y1 = Math.min(...positions.map((x) => x.y));
      const y2 = Math.max(...positions.map((x) => x.y + x.h));
      snap(e.start, y1, y2);
      snap(e.end, y1, y2);
    }
    return snapped;
  }

  getEachStyleReferencePoints(sels: SubtitleEntry[]) {
    const map = sels.reduce(
      (prev, current) => {
        const start = current.start;
        const end = current.end;
        for (const style of current.texts.keys()) {
          if (Source.subs.view.timelineExcludeStyles.has(style))
            continue;
          let tuple = prev.get(style.name);
          if (tuple) {
            if (start < tuple[0]) tuple[0] = start;
            if (end > tuple[1]) tuple[1] = end;
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
          ? this.getEachStyleReferencePoints([...this.self.selection])
      : ref == 'whole' 
          ? [first.start, last.end]
      : ref == 'one'
          ? [one.start, one.end] 
      : Debug.never(ref as never);
    this.start = first.start;
}

  onDrag(offsetX: number, offsetY: number, ev: MouseEvent): void {
    const curPos = 
      (offsetX - this.layout.leftColumnWidth) / this.layout.scale + this.layout.offset;
    let dval = curPos - this.origPos;
    if (ev.altKey !== TimelineConfig.data.enableSnap)
      dval = this.#snapMove(
        this.points,
        Math.min(...this.points), 
        this.start + dval
      ) - this.start;
    this.changed = dval != 0;
    for (const [ent, pos] of this.origPositions.entries()) {
      ent.start = pos.start + dval;
      ent.end = pos.end + dval;
    }
    this.layout.manager.requestRender();
  }
}

class DragResize extends MoveResizeBase {
  origVal: number;
  start: number;
  end: number;
  
  #snapEnds(start: number, end: number, desired: number, isStart: boolean) {
    const ok = isStart 
      ? (x: number) => x < end 
      : (x: number) => x > start;
    const snap = (x: number, y1: number, y2: number) => {
      if (!ok(x)) return;
      let d = Math.abs(desired - x);
      if (d < minDist) {
        minDist = d;
        this.self.alignmentLine = {
          x: x * this.layout.scale + this.layout.leftColumnWidth, 
          y1, y2
        };
        snapped = x;
      }
    };
    let minDist = TimelineConfig.data.snapDistance / this.layout.scale;
    let snapped = desired;
    this.self.alignmentLine = null;
    snap(Playback.position, 0, this.layout.height);
    for (const e of this.layout.getVisibleEntries()) {
      if (this.self.selection.has(e)) continue;
      const positions = this.layout.getEntryPositions(e);
      const y1 = Math.min(...positions.map((x) => x.y));
      const y2 = Math.max(...positions.map((x) => x.y + x.h));
      snap(e.start, y1, y2);
      snap(e.end, y1, y2);
    }
    return snapped;
  }

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
    const curPos = 
      (offsetX - this.layout.leftColumnWidth) / this.layout.scale + this.layout.offset;
    let val = this.origVal + curPos - this.origPos;
    if (ev.altKey !== TimelineConfig.data.enableSnap)
      val = this.#snapEnds(
        this.start, 
        this.end, 
        val, 
        this.where == 'start');
    let newStart: number, newEnd: number;
    if (this.where == 'start') {
      newStart = Math.min(this.end, val);
      newEnd = this.end;
    } else {
      newStart = this.start;
      newEnd = Math.max(this.start, val);
    }
    // transform selection
    const factor = (newEnd - newStart) / (this.end - this.start);
    for (const [ent, pos] of this.origPositions.entries()) {
      ent.start = (pos.start - this.start) * factor + newStart;
      ent.end = (pos.end - this.start) * factor + newStart;
    }
    this.changed = val != this.origVal;
    this.layout.keepPosInSafeArea(val);
    this.layout.manager.requestRender();
  }
}

export class TimelineInput {
  private readonly manager: CanvasManager;

  selectBox: Box | null = null;
  selection = new SvelteSet<SubtitleEntry>;
  alignmentLine: {x: number, y1: number, y2: number} | null = null;

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
    const sels = [...this.selection];
    return sels.reduce<[SubtitleEntry, SubtitleEntry]>(
      ([pf, pl], current) => [
        current.start < pf.start ? current : pf,
        current.end > pl.end ? current : pf], 
      [sels[0], sels[0]]);
  }

  #onMouseDown(e: MouseEvent) {
    if (e.offsetX < this.layout.leftColumnWidth) {
      const i = Math.floor((e.offsetY + this.manager.scroll[1] 
        - TimelineLayout.HEADER_HEIGHT - TimelineLayout.TRACKS_PADDING) / this.layout.entryHeight);
      if (i >= 0 && i < this.layout.shownStyles.length) {
        const style = this.layout.shownStyles[i];
        if (Editing.activeChannel == style)
          Editing.activeChannel = null;
        else 
          Editing.activeChannel = style;
        this.manager.requestRender();
      }
    }
  }

  #onDoubleClick() {
    if (this.selection.size == 1) {
      let one = [...this.selection][0];
      if (Editing.getFocusedEntry() == one)
        Editing.startEditingFocusedEntry();
    }
  }

  #onMouseMove(e: MouseEvent) {
    const canvas = this.manager.canvas;
    canvas.style.cursor = 'default';
    if (e.offsetX < this.layout.leftColumnWidth)
      return;

    if (e.offsetY < TimelineLayout.HEADER_HEIGHT) {
      canvas.style.cursor = 'col-resize';
      return;
    }
  
    const under = this.layout.findEntriesByPosition(
      e.offsetX + this.manager.scroll[0], e.offsetY);
    if (under.length == 0) return;
    canvas.style.cursor = 'move';
  
    const ctrlKey = Basic.ctrlKey() == 'Meta' ? e.metaKey : e.ctrlKey;
    const resizeArea = TimelineConfig.data.dragResizeArea;
    if ((this.selection.size > 1 || ctrlKey)
     && under.some((x) => this.selection.has(x)))
    {
      if (!ctrlKey) {
        let [first, last] = this.selectionFirstLast();
        const [ _, x1] = this.layout.getHorizontalPos(first, {local: true});
        const [w2, x2] = this.layout.getHorizontalPos(last, {local: true});
        if (under.includes(first) && e.offsetX - x1 < resizeArea)
          canvas.style.cursor = 'e-resize';
        else if (under.includes(last) && x2 + w2 - e.offsetX < resizeArea)
          canvas.style.cursor = 'w-resize';
      }
    } else {
      let ent = under.find((x) => this.selection.has(x)) ?? under[0];
      const [w, x] = this.layout.getHorizontalPos(ent, {local: true});
      if (e.offsetX - x < resizeArea)
        canvas.style.cursor = 'e-resize';
      else if (x + w - e.offsetX < resizeArea)
        canvas.style.cursor = 'w-resize';
    }
  }

  #canBeginDrag(e0: MouseEvent): boolean {
    if (e0.offsetX < this.layout.leftColumnWidth)
      return false;
    
    // e0.preventDefault();
    const origPos = this.layout.offset + 
      (e0.offsetX - this.layout.leftColumnWidth) / this.layout.scale;
    const scrollX = this.manager.scroll[0];
    this.#registerInterruptKey();
    if (e0.button == 1) {
      this.currentAction = new Scale(this, this.layout, e0);
      return true;
    } else {
      if (e0.offsetY < TimelineLayout.HEADER_HEIGHT) {
        this.currentAction = new MoveCursor(this, this.layout, e0);
        this.#onDrag(e0.offsetX, e0.offsetY, e0);
        return true;
      } else {
        const underMouse = this.layout.findEntriesByPosition(
          e0.offsetX + scrollX, e0.offsetY);
        if (underMouse.length == 0) {
          // clicked on nothing
          if (Basic.ctrlKey() == 'Meta' ? !e0.metaKey : !e0.ctrlKey) {
            // clear selection
            Editing.clearSelection(ChangeCause.Timeline);
            this.selection.clear();
            this.manager.requestRender();
          }
          this.currentAction = new BoxSelect(this, this.layout, e0);
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
        } else {
          // left-clicked on something
          // renew selection
          let afterEnd = () => {};
          if (Basic.ctrlKey() == 'Meta' ? e0.metaKey : e0.ctrlKey) {
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
          } else {
            // single select
            if (this.selection.size > 1) {
              afterEnd = () => {
                this.selection.clear();
                this.selection.add(underMouse[0]);
                Editing.selectEntry(underMouse[0], 
                  SelectMode.Single, ChangeCause.Timeline);
              };
            } else {
              // cycle through the overlapping entries under the cursor
              let one = [...this.selection][0];
              let index = (underMouse.indexOf(one) + 1) % underMouse.length;
              this.selection.clear();
              this.selection.add(underMouse[index]);
              Editing.selectEntry(underMouse[index], 
                SelectMode.Single, ChangeCause.Timeline);
            }
            this.manager.requestRender();
          }
          // drag if necessary
          const sels = [...this.selection];
          if (sels.length == 0) return false;
  
          // save original positions
          const origPositions = new Map(
            sels.map((x) => [x, { start: x.start, end: x.end }]));
  
          const [first, last] = this.selectionFirstLast();
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
      }
    };
  }
  
  #onDrag(offsetX: number, offsetY: number, ev: MouseEvent) {
    if (!this.currentAction) return;
    this.currentAction.onDrag(offsetX, offsetY, ev);
  }

  #registerInterruptKey() {
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

  #onDragEnd() {
    if (!this.currentAction) return Debug.early('no action for onDragEnd');
    this.currentAction.onDragEnd();
  }

  #onDragInterrupted() {
    if (!this.currentAction) return Debug.early('no action for onDragInterrupted');
    this.currentAction.onDragInterrupted();
  }

  #onMouseWheel(tr: TranslatedWheelEvent, e: WheelEvent) {
    if (tr.isZoom) {
      const origPos = this.layout.offset 
        + (e.offsetX - this.layout.leftColumnWidth) / this.layout.scale;
      this.layout.setScale(this.layout.scale / Math.pow(1.03, tr.amount));
      this.layout.setOffset(origPos 
        - (e.offsetX - this.layout.leftColumnWidth) / this.layout.scale);
    } else {
      const amount = 
        tr.isTrackpad ? tr.amountX :
        tr.amountX == 0 ? tr.amountY : tr.amountX;
      this.layout.setOffset(this.layout.offset + amount * 0.5 / this.layout.scale);
    }
  }
}