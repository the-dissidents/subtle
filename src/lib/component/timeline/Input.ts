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

type DragContext = null | {
  type: 'scale', 
  readonly origPos: number, 
  readonly origScale: number,
  readonly e0: MouseEvent
} | {
  type: 'moveCursor',
} | {
  type: 'boxSelect',
  readonly x1: number,
  readonly y1: number,
  readonly originalSelection: SubtitleEntry[],
  thisGroup: SubtitleEntry[],
} | {
  type: 'dragMove',
  readonly origPos: number,
  readonly points: number[],
  readonly start: number,
  readonly origPositions: Map<SubtitleEntry, {
    start: number;
    end: number;
  }>,
  readonly afterEnd: () => void,
  changed: boolean
} | {
  type: 'dragResize',
  readonly origPos: number,
  readonly origVal: number,
  readonly isStart: boolean,
  readonly start: number,
  readonly end: number,
  readonly origPositions: Map<SubtitleEntry, {
    start: number;
    end: number;
  }>,
  readonly afterEnd: () => void,
  changed: boolean
};

function getEachStyleReferencePoints(sels: SubtitleEntry[]) {
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

export class TimelineInput {
  private readonly manager: CanvasManager;

  selectBox: Box | null = null;
  selection = new SvelteSet<SubtitleEntry>;
  alignmentLine: {x: number, y1: number, y2: number} | null = null;
  dragContext: DragContext = null;

  constructor(private layout: TimelineLayout) {
    this.manager = layout.manager;

    this.manager.canvas.oncontextmenu = (e) => e.preventDefault();
    this.manager.canvas.ondblclick = () => this.#onDoubleClick();
    this.manager.onMouseMove.bind(this, this.#onMouseMove.bind(this));
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

  #dispatchSelectionChanged() {
    Editing.clearFocus();
    Editing.selection.submitted = new Set(this.selection);
    if (this.selection.size == 1) {
      let array = [...this.selection.values()];
      Editing.selection.currentGroup = array;
      Editing.selection.focused = array[0];
    } else {
      Editing.selection.currentGroup = [];
      Editing.selection.focused = null;
    }
    Editing.onSelectionChanged.dispatch(ChangeCause.Timeline);
  }

  #selectionFirstLast() {
    const sels = [...this.selection];
    return sels.reduce<[SubtitleEntry, SubtitleEntry]>(
      ([pf, pl], current) => [
        current.start < pf.start ? current : pf,
        current.end > pl.end ? current : pf], 
      [sels[0], sels[0]]);
  }

  #snapMove(points: number[], origStart: number, desiredStart: number) {
    const snap = (x: number, y1: number, y2: number) => {
      for (const point of points) {
        const d = Math.abs(desiredStart - x + point - origStart);
        if (d < minDist) {
          this.alignmentLine = {x: x * this.layout.scale, y1, y2};
          snapped = x - point + origStart;
          minDist = d;
        }
      }
    };
    let minDist = TimelineConfig.data.snapDistance / this.layout.scale;
    let snapped = desiredStart; 
    this.alignmentLine = null;
    snap(Playback.position, 0, this.layout.height);
    for (const e of this.layout.getVisibleEntries()) {
      if (this.selection.has(e)) continue;
      const positions = this.layout.getEntryPositions(e);
      const y1 = Math.min(...positions.map((x) => x.y));
      const y2 = Math.max(...positions.map((x) => x.y + x.h));
      snap(e.start, y1, y2);
      snap(e.end, y1, y2);
    }
    return snapped;
  }
  
  #snapEnds(start: number, end: number, desired: number, isStart: boolean) {
    const ok = isStart 
      ? (x: number) => x < end 
      : (x: number) => x > start;
    const snap = (x: number, y1: number, y2: number) => {
      if (!ok(x)) return;
      let d = Math.abs(desired - x);
      if (d < minDist) {
        minDist = d;
        this.alignmentLine = {x: x * this.layout.scale, y1, y2};
        snapped = x;
      }
    };
    let minDist = TimelineConfig.data.snapDistance / this.layout.scale;
    let snapped = desired;
    this.alignmentLine = null;
    snap(Playback.position, 0, this.layout.height);
    for (const e of this.layout.getVisibleEntries()) {
      if (this.selection.has(e)) continue;
      const positions = this.layout.getEntryPositions(e);
      const y1 = Math.min(...positions.map((x) => x.y));
      const y2 = Math.max(...positions.map((x) => x.y + x.h));
      snap(e.start, y1, y2);
      snap(e.end, y1, y2);
    }
    return snapped;
  }

  async #moveCursor(pos: number) {
    if (pos == Playback.position) return;
    Playback.setPosition(pos);
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
        let [first, last] = this.#selectionFirstLast();
        const x1 = (first.start - this.layout.offset) * this.layout.scale,
              w2 = (last.end - last.start) * this.layout.scale,
              x2 = (last.start - this.layout.offset) * this.layout.scale;
        if (under.includes(first) 
         && e.offsetX - x1 < resizeArea)
        {
          canvas.style.cursor = 'e-resize';
        } else if (under.includes(last)
                && x2 + w2 - e.offsetX < resizeArea)
        {
          canvas.style.cursor = 'w-resize';
        }
      }
    } else {
      let ent = under.find((x) => this.selection.has(x)) ?? under[0];
      const w = (ent.end - ent.start) * this.layout.scale,
            x = (ent.start - this.layout.offset) * this.layout.scale;
      if (e.offsetX - x < resizeArea)
        canvas.style.cursor = 'e-resize';
      else if (x + w - e.offsetX < resizeArea)
        canvas.style.cursor = 'w-resize';
    }
  }

  #canBeginDrag(e0: MouseEvent): boolean {
    e0.preventDefault();
    const origPos = this.layout.offset + e0.offsetX / this.layout.scale;
    const scrollX = this.manager.scroll[0];
    document.addEventListener('keydown', this.#onDocumentKeyWhenDragging);
    if (e0.button == 1) {
      // scale
      this.dragContext = { type: 'scale', origScale: this.layout.scale, origPos, e0 };
      return true;
    } else {
      if (e0.offsetY < TimelineLayout.HEADER_HEIGHT) {
        // move cursor
        this.dragContext = { type: 'moveCursor' };
        this.#onDrag(e0.offsetX, e0.offsetY, e0);
        return true;
      } else {
        let underMouse = this.layout.findEntriesByPosition(
          e0.offsetX + scrollX, e0.offsetY);
        if (underMouse.length == 0) {
          // clicked on nothing
          if (Basic.ctrlKey() == 'Meta' ? !e0.metaKey : !e0.ctrlKey) {
            // clear selection
            Editing.clearSelection(ChangeCause.Timeline);
            this.selection.clear();
            this.manager.requestRender();
          }
          // initiate box select
          this.dragContext = {
            type: 'boxSelect', 
            x1: origPos * this.layout.scale,
            y1: e0.offsetY,
            originalSelection: [...this.selection], 
            thisGroup: []
          };
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
              this.#dispatchSelectionChanged();
              this.manager.requestRender();
            } else afterEnd = () => {
              // if hasn't dragged
              this.selection.delete(underMouse[0]);
              this.#dispatchSelectionChanged();
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
  
          const [first, last] = this.#selectionFirstLast();
          const distL = (origPos - first.start) * this.layout.scale, 
                distR = (last.end - origPos) * this.layout.scale;
          if (distL > TimelineConfig.data.dragResizeArea 
           && distR > TimelineConfig.data.dragResizeArea)
          {
            // drag-move
            const one = underMouse.find((x) => this.selection.has(x))!;
            const ref = TimelineConfig.data.multiselectDragReference;
            const points = 
                ref == 'eachStyleofWhole' 
                  ? getEachStyleReferencePoints(sels)
              : ref == 'whole' 
                  ? [first.start, last.end]
              : ref == 'one'
                  ? [one.start, one.end] 
              : Debug.never(ref as never);
            this.dragContext = {
              type: 'dragMove', 
              origPos, origPositions, points, 
              start: first.start,
              changed: false,
              afterEnd
            };
            return true;
          } else {
            // drag-resize
            const isStart = distL <= TimelineConfig.data.dragResizeArea;
            this.dragContext = {
              type: 'dragResize', 
              origPos, origPositions, isStart,
              origVal: isStart ? first.start : last.end,
              start: first.start,
              end: last.end,
              changed: false,
              afterEnd
            };
            return true;
          }
        }
      }
    };
  }
  
  #onDrag(offsetX: number, offsetY: number, ev: MouseEvent) {
    const dragContext = this.dragContext;
    Debug.assert(dragContext !== null);
    switch (dragContext.type) {
      case 'scale':
        this.layout.setScale(dragContext.origScale / 
          Math.pow(1.03, (dragContext.e0.clientX - ev.clientX)));
        this.layout.setOffset(dragContext.origPos - dragContext.e0.offsetX / this.layout.scale);
        break;
      case 'moveCursor':
        this.#moveCursor((offsetX + this.manager.scroll[0]) / this.layout.scale);
        break;
      case 'boxSelect':
        let x2 = offsetX + this.manager.scroll[0],
            y2 = offsetY;
        let b: Box = {
          x: Math.min(dragContext.x1, x2), y: Math.min(dragContext.y1, y2), 
          w: Math.abs(dragContext.x1 - x2), h: Math.abs(dragContext.y1 - y2)};
        this.selectBox = b;
        let newGroup = this.layout.findEntriesByPosition(b.x, b.y, b.w, b.h);
        if (newGroup.length != dragContext.thisGroup.length) {
          this.selection = new SvelteSet(
            [...dragContext.originalSelection, ...newGroup]);
          dragContext.thisGroup = newGroup;
          this.#dispatchSelectionChanged();
        }
        this.layout.keepPosInSafeArea(x2 / this.layout.scale);
        this.manager.requestRender();
        break;
      case 'dragMove':
        let dval = offsetX / this.layout.scale + this.layout.offset - dragContext.origPos;
        if (ev.altKey !== TimelineConfig.data.enableSnap)
          dval = this.#snapMove(
            dragContext.points,
            Math.min(...dragContext.points), 
            dragContext.start + dval
          ) - dragContext.start;
        dragContext.changed = dval != 0;
        for (const [ent, pos] of dragContext.origPositions.entries()) {
          ent.start = pos.start + dval;
          ent.end = pos.end + dval;
        }
        this.manager.requestRender();
        break;
      case 'dragResize':
        let val = dragContext.origVal 
          + offsetX / this.layout.scale + this.layout.offset - dragContext.origPos;
        if (ev.altKey !== TimelineConfig.data.enableSnap)
          val = this.#snapEnds(
            dragContext.start, 
            dragContext.end, 
            val, 
            dragContext.isStart);
        let newStart: number, newEnd: number;
        if (dragContext.isStart) {
          newStart = Math.min(dragContext.end, val);
          newEnd = dragContext.end;
        } else {
          newStart = dragContext.start;
          newEnd = Math.max(dragContext.start, val);
        }
        // transform selection
        const factor = (newEnd - newStart) / (dragContext.end - dragContext.start);
        for (const [ent, pos] of dragContext.origPositions.entries()) {
          ent.start = (pos.start - dragContext.start) * factor + newStart;
          ent.end = (pos.end - dragContext.start) * factor + newStart;
        }
        dragContext.changed = val != dragContext.origVal;
        this.layout.keepPosInSafeArea(val);
        this.manager.requestRender();
        break;
      default:
        Debug.never(dragContext);
    }
  }

  #onDocumentKeyWhenDragging(ev: KeyboardEvent) {
    if (ev.key == 'Escape') {
      document.removeEventListener('keydown', this.#onDocumentKeyWhenDragging);
      this.manager.interruptDrag();
    }
  };

  #onDragEnd() {
    const dragContext = this.dragContext;
    Debug.assert(dragContext !== null);
    document.removeEventListener('keydown', this.#onDocumentKeyWhenDragging);
    switch (dragContext.type) {
      case 'dragMove':
      case 'dragResize':
        this.alignmentLine = null;
        this.manager.requestRender();
        if (dragContext.changed)
          Source.markChanged(ChangeType.Times);
        else
          dragContext.afterEnd();
        break;
      case 'scale':
      case 'moveCursor':
        break;
      case 'boxSelect':
        this.selectBox = null;
        this.manager.requestRender();
        break;
      default:
        Debug.never(dragContext);
    }
  }

  #onDragInterrupted() {
    const dragContext = this.dragContext;
    Debug.assert(dragContext !== null);
    switch (dragContext.type) {
      case 'dragMove':
      case 'dragResize':
        this.alignmentLine = null;
        for (const [ent, pos] of dragContext.origPositions.entries()) {
          ent.start = pos.start;
          ent.end = pos.end;
        }
        this.manager.requestRender();
      case 'scale':
      case 'moveCursor':
        break;
      case 'boxSelect':
        this.selectBox = null;
        this.selection = new SvelteSet(dragContext.originalSelection);
        this.#dispatchSelectionChanged();
        this.manager.requestRender();
        break;
      default:
        Debug.never(dragContext);
    }
  }

  #onMouseWheel(tr: TranslatedWheelEvent, e: WheelEvent) {
    if (tr.isZoom) {
      const origPos = this.layout.offset + e.offsetX / this.layout.scale;
      this.layout.setScale(this.layout.scale / Math.pow(1.03, tr.amount));
      this.layout.setOffset(origPos - e.offsetX / this.layout.scale);
    } else {
      const amount = 
        tr.isTrackpad ? tr.amountX :
        tr.amountX == 0 ? tr.amountY : tr.amountX;
      this.layout.setOffset(this.layout.offset + amount * 0.5 / this.layout.scale);
    }
  }
}