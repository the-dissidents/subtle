<script lang="ts" module>
import { _ } from 'svelte-i18n';
import { get } from "svelte/store";
import { PublicConfigGroup } from "./config/PublicConfig.svelte";

export const TimelineConfig = new PublicConfigGroup(
  () => get(_)('config.timeline'),
  null, 1,
{
  fontSize: {
    localizedName: () => get(_)('config.font-size'),
    type: 'number',
    bounds: [5, null],
    default: 12
  },
  waveformResolution: {
    localizedName: () => get(_)('config.waveform-resolution'),
    description: () => get(_)('config.waveform-resolution-d'),
    type: 'number',
    bounds: [50, 800],
    default: 700
  },
  dragResizeArea: {
    localizedName: () => get(_)('config.resize-area-size'),
    type: 'number',
    description: () => get(_)('config.resize-area-size-d'),
    bounds: [1, 10],
    default: 5
  },
  enableSnap: {
    localizedName: () => get(_)('config.snapping'),
    type: 'boolean',
    description: () => get(_)('config.snapping-d'),
    default: true
  },
  snapDistance: {
    localizedName: () => get(_)('config.snap-distance'),
    type: 'number',
    description: () => get(_)('config.snap-distance-d'),
    bounds: [1, 10],
    default: 5
  },
  multiselectDragReference: {
    localizedName: () => get(_)('config.multiselect-drag-reference'),
    type: 'dropdown',
    options: {
      whole: { localizedName: () => get(_)('config.whole-of-selection') },
      eachStyleofWhole: { localizedName: () => get(_)('config.each-style-of-selection') },
      one: { localizedName: () => get(_)('config.the-entry-under-the-mouse') }
    },
    default: 'eachStyleofWhole'
  },
  showDebug: {
    localizedName: () => get(_)('config.show-debug-info'),
    type: 'boolean',
    default: true
  },
});
</script>

<script lang="ts">
import { MMedia } from "./API";
import { AudioSampler } from "./AudioSampler";
import { Basic } from "./Basic";
import { CanvasManager } from "./CanvasManager";
import { DebugConfig, InterfaceConfig, MainConfig } from "./config/Groups";
import { LabelColor, theme } from "./Theming.svelte";
import { SubtitleEntry, type SubtitleStyle } from "./core/Subtitles.svelte";
import { Actions } from "./frontend/Actions";
import { Editing, SelectMode } from "./frontend/Editing";
import { type TranslatedWheelEvent } from "./frontend/Frontend";
import { Playback } from "./frontend/Playback";
import { ChangeCause, ChangeType, Source } from "./frontend/Source";
import { Debug } from "./Debug";
import { Interface } from './frontend/Interface';
import Popup, { type PopupHandler } from './ui/Popup.svelte';

let timelineCanvas: HTMLCanvasElement | undefined = $state();
let rowPopup: PopupHandler = $state({});
let styleRefreshCounter = $state(0);
let uiFocus = Interface.uiFocus;

// Private fields (were prefixed with # in the class)
let requestedSampler = false;
let sampler: AudioSampler | null = null;
let samplerMedia: MMedia | undefined;
/** pixels per second */
let scale = 1;

let width = 100, height = 100;
let entryHeight = 0;
let stylesMap = new Map<SubtitleStyle, number>();

let selectBox: Box | null = null;
let selection = new Set<SubtitleEntry>;
let alignmentLine: {x: number, y1: number, y2: number} | null = null;

let manager: CanvasManager;

// Constants from the original class
const HEADER_HEIGHT = 15;
const HEADER_BACK       = $derived(theme.isDark ? 'hsl(0deg 0% 20%)' : 'hsl(0deg 0% 85%)');
const TICK_COLOR        = $derived(theme.isDark ? 'white' : 'gray');
const LINE_BIG_COLOR    = $derived(theme.isDark ? 'hsl(0deg 0% 60%)' : 'hsl(0deg 0% 40%)');
const LINE_MED_COLOR    = $derived(theme.isDark ? 'hsl(0deg 0% 30%)' : 'hsl(0deg 0% 70%)');
const RULER_TEXT        = $derived(theme.isDark ? 'white' : 'hsl(0deg 0% 20%)');

const PRELOAD_MARGIN = 3;
const PRELOAD_MARGIN_FACTOR = 0.1;
const CURSOR_AREA_MARGIN = 50;
const TRACK_AREA_MARGIN = 20;

const ENTRY_WIDTH = 1;
const ENTRY_WIDTH_FOCUS = 2;
const ENTRY_BACK_OPACITY = 0.4;
const ENTRY_BACK = 
  $derived(theme.isDark ? 'hsl(0deg 0% 20%/40%)' : 'hsl(0deg 0% 80%/40%)');
const ENTRY_BORDER       = $derived(theme.isDark ? 'hsl(0deg 0% 60%)' : 'hsl(0deg 0% 80%)');
const ENTRY_BORDER_FOCUS = $derived(theme.isDark ? 'goldenrod' : 'oklch(70.94% 0.136 258.06)');
const ENTRY_TEXT         = $derived(theme.isDark ? 'hsl(0deg 0% 90%)' : 'hsl(0deg 0% 20%)');
const INOUT_TEXT         = $derived(theme.isDark ? 'lightgreen' : 'oklch(52.77% 0.138 145.41)');

const CURSOR_COLOR = 
  $derived(theme.isDark ? 'pink' : 'oklch(62.73% 0.209 12.37)');
const PENDING_WAVEFORM_COLOR = 
  $derived(theme.isDark ? `rgb(100% 10% 10% / 30%)` : `rgb(100% 40% 40% / 40%)`);
const WAVEFORM_COLOR = 
  $derived(theme.isDark ? `rgb(100 255 255)` : 'oklch(76.37% 0.101 355.37)');
const INOUT_AREA_OUTSIDE = 
  $derived(theme.isDark ? 'hsl(0deg 0% 80% / 40%)' : 'hsl(0deg 0% 40% / 40%)');

const BOXSELECT_BACK = 'hsl(0deg 0% 80% / 40%)';
const BOXSELECT_BORDER = 'hsl(0deg 0% 80%)';
const BOXSELECT_WIDTH = 1.5;

const ALIGNLINE_COLOR = 
  $derived(theme.isDark ? 'hsl(0deg 0% 80%)' : 'oklch(70.23% 0.092 354.96)');
const ALIGNLINE_WIDTH = 1.5;

type Box = {
  x: number, y: number,
  w: number, h: number
};

const me = {};

// Setup function for the canvas
function setupTimelineCanvas(canvas: HTMLCanvasElement) {
  manager = new CanvasManager(canvas);
  manager.onDisplaySizeChanged.bind(me, 
    (w, h) => processDisplaySizeChanged(w, h));
  manager.renderer = (ctx) => render(ctx);

  canvas.oncontextmenu = (e) => e.preventDefault();
  canvas.ondblclick = () => precessDoubleClick();
  manager.onMouseMove.bind(me, (ev) => processMouseMove(ev));
  manager.onMouseDown.bind(me, (ev) => processMouseDown(ev));
  manager.onMouseWheel.bind(me, (tr, e) => processWheel(tr, e));
  manager.onUserScroll.bind(me, () => {requestedSampler = true});

  setViewScale(10);

  MainConfig.hook(
    () => InterfaceConfig.data.theme, 
    () => manager.requestRender());

  Playback.playArea.subscribe(() => manager.requestRender());

  Editing.onSelectionChanged.bind(me, (cause) => {
    if (cause != ChangeCause.Timeline) {
      selection = new Set(Editing.getSelection());
      let focused = Editing.getFocusedEntry();
      if (focused instanceof SubtitleEntry) keepEntryInView(focused);
      manager.requestRender();
    }
  });
  Source.onSubtitlesChanged.bind(me, (type) => {
    if (type == ChangeType.StyleDefinitions || type == ChangeType.General)
      preprocessStyles();
    if (type == ChangeType.Times || type == ChangeType.General)
      updateContentArea();
    if (type != ChangeType.Metadata)
      manager.requestRender();
  });
  Source.onSubtitleObjectReload.bind(me, () => {
    preprocessStyles();
    updateContentArea();
    manager.requestRender();
  });

  return {
    destroy() {
      // Cleanup if needed
    }
  };
}

// Helpers
function getTick(scale: number): [small: number, nMed: number, nBig: number] {
  const UNITS = [0.001, 0.01, 0.1, 1, 10, 60, 600, 3600];
  // const UNITS = [1/60, 1/24, 1, 10, 60, 600, 3600];
  for (let i = 0; i < UNITS.length - 3; i++)
    if (scale * UNITS[i] > 2 / devicePixelRatio) return [
      UNITS[i], 
      UNITS[i+1] / UNITS[i], 
      UNITS[i+2] / UNITS[i]];
  return [60, 10, 60];
}

let ellipsisWidth = -1;

function ellipsisText(cxt: CanvasRenderingContext2D, str: string, max: number) {
  const ellipsis = '…';
  const binarySearch = 
    (max: number, match: number, getValue: (guess: number) => number) => 
  {
    let min = 0;
    while (min <= max) {
      let guess = Math.floor((min + max) / 2);
      const compareVal = getValue(guess);
      if (compareVal === match) return guess;
      if (compareVal < match) min = guess + 1;
      else max = guess - 1;
    }
    return max;
  };

  const width = cxt.measureText(str).width;
  if (ellipsisWidth < 0) ellipsisWidth = cxt.measureText(ellipsis).width;
  if (width <= max || width <= ellipsisWidth) return str;
  
  const index = binarySearch(
    str.length,
    max - ellipsisWidth,
    guess => cxt.measureText(str.substring(0, guess)).width);
  return str.substring(0, index) + ellipsis;
}

function font(size: number) {
  return `${size}px ${InterfaceConfig.data.fontFamily}`;
}

// Display methods
function processDisplaySizeChanged(w: number, h: number): void {
  width = w;
  height = h;
  preprocessStyles();
  updateContentArea();
  setViewOffset(getOffset());
  manager.requestRender();
}

function preprocessStyles() {
  const subs = Source.subs;
  const exclude = subs.view.timelineExcludeStyles;
  for (const s of [...exclude])
    if (!subs.styles.includes(s))
      exclude.delete(s);
  if (exclude.size == subs.styles.length)
    exclude.clear();
  styleRefreshCounter++;

  const include = subs.styles.filter((x) => !exclude.has(x));
  entryHeight = (height - HEADER_HEIGHT - TRACK_AREA_MARGIN * 2) 
    / include.length;
  stylesMap = new Map([...include].map((x, i) => [x, i]));
  manager.requestRender();
}

// Offset getter
function getOffset() {
  return manager.scroll[0] / scale;
}

// Helper methods
function getVisibleEntries(): SubtitleEntry[] {
  const end = getOffset() + width / scale;
  return Source.subs.entries.filter(
    (ent) => ent.end > getOffset() && ent.start < end);
}

function getEntryPositions(ent: SubtitleEntry): (Box & {text: string})[] {
  const w = (ent.end - ent.start) * scale,
      x = ent.start * scale;
  
  return [...ent.texts.entries()].flatMap(([style, text]) => {
    if (Source.subs.view.timelineExcludeStyles.has(style)) return [];

    let i = stylesMap.get(style) ?? 0;
    let y = entryHeight * i + HEADER_HEIGHT + TRACK_AREA_MARGIN;
    return [{x: x, y: y, w: w, h: entryHeight, text}];
  });
}

// coordinates are offset but not scaled
function findEntriesByPosition(
  x: number, y: number, w = 0, h = 0): SubtitleEntry[] 
{
  let result = [];
  const start = x / scale;
  const end = (x + w) / scale;
  for (let ent of Source.subs.entries) {
    if (ent.end < start || ent.start > end) continue;
    if (getEntryPositions(ent)
      .some((b) => b.x <= x + w && b.x + b.w >= x 
            && b.y <= y + h && b.y + b.h >= y)) result.push(ent);
  }
  return result;
}

function snapMove(points: number[], origStart: number, desiredStart: number) {
  const snap = (x: number, y1: number, y2: number) => {
    for (const point of points) {
      let d = Math.abs(desiredStart - x + point - origStart);
      if (d < minDist) {
        alignmentLine = {x: x * scale, y1, y2};
        snapped = x - point + origStart;
        minDist = d;
      }
    }
  };
  let minDist = TimelineConfig.data.snapDistance / scale;
  let snapped = desiredStart; 
  alignmentLine = null;
  snap(Playback.cursorPosition, 0, height);
  for (const e of getVisibleEntries()) {
    if (selection.has(e)) continue;
    let positions = getEntryPositions(e);
    let y1 = Math.min(...positions.map((x) => x.y));
    let y2 = Math.max(...positions.map((x) => x.y + x.h));
    snap(e.start, y1, y2);
    snap(e.end, y1, y2);
  }
  return snapped;
}

function snapEnds(start: number, end: number, desired: number, isStart: boolean) {
  const ok = isStart 
    ? (x: number) => x < end 
    : (x: number) => x > start;
  const snap = (x: number, y1: number, y2: number) => {
    if (!ok(x)) return;
    let d = Math.abs(desired - x);
    if (d < minDist) {
      minDist = d;
      alignmentLine = {x: x * scale, y1, y2};
      snapped = x;
    }
  };
  let minDist = TimelineConfig.data.snapDistance / scale;
  let snapped = desired;
  alignmentLine = null;
  snap(Playback.cursorPosition, 0, height);
  for (const e of getVisibleEntries()) {
    if (selection.has(e)) continue;
    let positions = getEntryPositions(e);
    let y1 = Math.min(...positions.map((x) => x.y));
    let y2 = Math.max(...positions.map((x) => x.y + x.h));
    snap(e.start, y1, y2);
    snap(e.end, y1, y2);
  }
  return snapped;
}

function keepEntryInView(ent: SubtitleEntry) {
  const w = (ent.end - ent.start) * scale,
      x = (ent.start - getOffset()) * scale;
  const dxStart = x;
  const dxEnd = (x + w) - width;
  if (dxStart >= 0 && dxEnd <= 0) return;
  if (Math.abs(dxStart) < Math.abs(dxEnd))
    setViewOffset(getOffset() + dxStart / scale);
  else
    setViewOffset(getOffset() + dxEnd / scale);
}

function keepPosInSafeArea(pos: number) {
  const margin = CURSOR_AREA_MARGIN / scale;
  const left = getOffset() + margin,
      right = getOffset() + width / scale - margin;
  if (pos < left) setViewOffset(getOffset() + pos - left);
  if (pos > right) setViewOffset(getOffset() + pos - right);
}

// UI events
function processMouseMove(e: MouseEvent) {
  const canvas = manager.canvas;
  canvas.style.cursor = 'default';
  if (e.offsetY < HEADER_HEIGHT) {
    canvas.style.cursor = 'col-resize';
    return;
  }

  const under = findEntriesByPosition(
    e.offsetX + manager.scroll[0], e.offsetY);
  if (under.length == 0) return;
  if ((selection.size > 1 
     || (Basic.ctrlKey() == 'Meta' ? e.metaKey : e.ctrlKey)) 
    && under.some((x) => selection.has(x)))
  {
    canvas.style.cursor = 'move';
  } else {
    let ent = under.find((x) => selection.has(x)) ?? under[0];
    const w = (ent.end - ent.start) * scale,
        x = (ent.start - getOffset()) * scale;
    if (e.offsetX - x < TimelineConfig.data.dragResizeArea)
      canvas.style.cursor = 'e-resize';
    else if (x + w - e.offsetX < TimelineConfig.data.dragResizeArea)
      canvas.style.cursor = 'w-resize';
    // else
    //     canvas.style.cursor = 'move';
  }
}

function processMouseDown(e0: MouseEvent) {
  e0.preventDefault();
  let onMove = (_: MouseEvent, offsetX: number, offsetY: number) => {};
  let onUp = (_: MouseEvent, offsetX: number, offsetY: number) => {};
  let onReset = () => {};
  const origPos = getOffset() + e0.offsetX / scale;
  const scrollX = manager.scroll[0];
  if (e0.button == 1) {
    // scale
    const orig = scale;
    onMove = (e1) => {
      setViewScale(orig / Math.pow(1.03, (e0.clientX - e1.clientX)));
      setViewOffset(origPos - e0.offsetX / scale);
    };
  } else {
    if (e0.offsetY < HEADER_HEIGHT) {
      // move cursor
      onMove = async (_, offsetX: number, offsetY: number) => 
        await moveCursor((offsetX + scrollX) / scale);
      onMove(e0, e0.offsetX, e0.offsetY);
    } else {
      let underMouse = findEntriesByPosition(
        e0.offsetX + scrollX, e0.offsetY);
      if (underMouse.length == 0) {
        // clicked on nothing
        if (Basic.ctrlKey() == 'Meta' ? !e0.metaKey : !e0.ctrlKey) {
          // clear selection
          Editing.clearSelection(ChangeCause.Timeline);
          selection.clear();
          manager.requestRender();
        }
        // initiate box select
        selectBox = null;
        const originalSelection = [...selection];
        let thisGroup = [];
        onMove = (_, offsetX: number, offsetY: number) => {
          let x1 = origPos * scale,
            x2 = offsetX + scrollX,
            y1 = e0.offsetY,
            y2 = offsetY;
          let b: Box = {
            x: Math.min(x1, x2), y: Math.min(y1, y2), 
            w: Math.abs(x1 - x2), h: Math.abs(y1 - y2)};
          selectBox = b;
          let newGroup =
            findEntriesByPosition(b.x, b.y, b.w, b.h);
          if (newGroup.length != thisGroup.length) {
            selection = new Set(
              [...originalSelection, ...newGroup]);
            thisGroup = newGroup;
            dispatchSelectionChanged();
          }
          keepPosInSafeArea(x2 / scale);
          manager.requestRender();
        };
        // reset box select
        onReset = () => {
          selectBox = null;
          selection = new Set(originalSelection);
          dispatchSelectionChanged();
          manager.requestRender();
        };
        // stop box select
        onUp = () => {
          selectBox = null;
          manager.requestRender();
        };
      } else if (e0.button == 2) {
        // right-clicked on something
        // clear selection and re-select only if it's not selected
        if (!underMouse.some((x) => selection.has(x))) {
          Editing.clearSelection(ChangeCause.Timeline);
          Editing.selectEntry(underMouse[0], 
            SelectMode.Single, ChangeCause.Action);
        }
        // you can't drag in this case! no onMove.
        // start context menu on mouse up
        // note we do it here instead of in oncontextmenu
        onUp = () => Actions.contextMenu();
      } else {
        // left-clicked on something
        // renew selection
        let afterUp = () => {};
        if (Basic.ctrlKey() == 'Meta' ? e0.metaKey : e0.ctrlKey) {
          // multiple select. Only the first entry counts
          if (!selection.has(underMouse[0])) {
            selection.add(underMouse[0]);
            dispatchSelectionChanged();
            manager.requestRender();
          } else afterUp = () => {
            // if hasn't dragged
            selection.delete(underMouse[0]);
            dispatchSelectionChanged();
            manager.requestRender();
          }
        } else {
          // single select
          if (selection.size > 1) {
            afterUp = () => {
              selection.clear();
              selection.add(underMouse[0]);
              Editing.selectEntry(underMouse[0], 
                SelectMode.Single, ChangeCause.Timeline);
            };
          } else {
            // cycle through the overlapping entries under the cursor
            let one = [...selection][0];
            let index = (underMouse.indexOf(one) + 1) % underMouse.length;
            selection.clear();
            selection.add(underMouse[index]);
            Editing.selectEntry(underMouse[index], 
              SelectMode.Single, ChangeCause.Timeline);
          }
          manager.requestRender();
        }
        // drag if necessary
        const sels = [...selection];
        if (sels.length == 0) return;

        // save original positions
        const origPositions = new Map(sels.map((x) => [x, {
          start: x.start,
          end: x.end
        }]));

        onReset = () => {
          alignmentLine = null;
          for (const [ent, pos] of origPositions.entries()) {
            ent.start = pos.start;
            ent.end = pos.end;
          }
          manager.requestRender();
        }

        const [first, last] = sels.reduce<[SubtitleEntry, SubtitleEntry]>(
          ([pf, pl], current) => [
            current.start < pf.start ? current : pf,
            current.end > pl.end ? current : pf], 
          [sels[0], sels[0]]);
        const distL = (origPos - first.start) * scale, 
            distR = (last.end - origPos) * scale;
        if (distL > TimelineConfig.data.dragResizeArea 
         && distR > TimelineConfig.data.dragResizeArea)
        {
          // drag-move
          let dragged = false;
          const one = underMouse.find((x) => selection.has(x))!;
          const points = 
              TimelineConfig.data.multiselectDragReference == 'eachStyleofWhole' 
            ? [...new Set([...sels.reduce(
              (prev, current) => {
                const start = current.start;
                const end = current.end;
                for (const style of current.texts.keys()) {
                  if (!Source.subs.view.timelineExcludeStyles.has(style))
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
              new Map<string, [number, number]>()).values()].flat())]
            : TimelineConfig.data.multiselectDragReference == 'whole' 
            ? [first.start, last.end]
            : [one.start, one.end];

          const origStart = Math.min(...points);
          const firstStart = first.start;
          onMove = (e, offsetX: number, offsetY: number) => {
            const newPos = 
              offsetX / scale + getOffset();
            let dval = newPos - origPos;
            if (e.altKey !== TimelineConfig.data.enableSnap)
              dval = snapMove(
                points, origStart, firstStart + dval) - firstStart;
            dragged = newPos != origPos;
            for (const [ent, pos] of origPositions.entries()) {
              ent.start = pos.start + dval;
              ent.end = pos.end + dval;
            }
            manager.requestRender();
          };
          onUp = () => {
            alignmentLine = null;
            manager.requestRender();
            if (dragged) {
              Source.markChanged(ChangeType.Times);
            } else afterUp();
          };
        } else {
          // drag-resize
          const isStart = distL <= TimelineConfig.data.dragResizeArea;
          const origVal = isStart ? first.start : last.end;
          const firstStart = first.start;
          const lastEnd = last.end;
          let dragged = false;
          onMove = (e, offsetX: number, offsetY: number) => {
            const newPos = 
              offsetX / scale + getOffset();
            let val = origVal + newPos - origPos;
            if (e.altKey !== TimelineConfig.data.enableSnap)
              val = snapEnds(firstStart, lastEnd, val, isStart);
            let newStart: number, newEnd: number;
            if (isStart) {
              newStart = Math.min(lastEnd, val);
              newEnd = lastEnd;
            } else {
              newStart = firstStart;
              newEnd = Math.max(firstStart, val);
            }
            // transform selection
            const factor = (newEnd - newStart) / (lastEnd - firstStart);
            for (const [ent, pos] of origPositions.entries()) {
              ent.start = (pos.start - firstStart) * factor + newStart;
              ent.end = (pos.end - firstStart) * factor + newStart;
            }
            dragged = val != origVal;
            keepPosInSafeArea(val);
            manager.requestRender();
          };
          onUp = () => {
            alignmentLine = null;
            manager.requestRender();
            if (dragged) {
              Source.markChanged(ChangeType.Times);
            } else afterUp();
          };
        }
      }
    }
  };
  
  const onKey = (ev: KeyboardEvent) => {
    if (ev.key == 'Escape') {
      onReset();
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    }
  };
  const onMouseMove = (ev: MouseEvent) => {
    let rect = manager.canvas.getBoundingClientRect();
    const offsetX = ev.clientX - rect.left;
    const offsetY = ev.clientY - rect.top;
    onMove(ev, offsetX, offsetY);
  }
  const onMouseUp = (ev: MouseEvent) => {
    let rect = manager.canvas.getBoundingClientRect();
    const offsetX = ev.clientX - rect.left;
    const offsetY = ev.clientY - rect.top;
    onUp(ev, offsetX, offsetY);
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('mousemove', onMouseMove);
  };
  document.addEventListener('keydown', onKey);
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp, { once: true });
}

function precessDoubleClick() {
  if (selection.size == 1) {
    let one = [...selection][0];
    if (Editing.getFocusedEntry() == one)
      Editing.startEditingFocusedEntry();
  }
}

function processWheel(tr: TranslatedWheelEvent, e: WheelEvent) {
  if (tr.isZoom) {
    const origPos = getOffset() + e.offsetX / scale;
    setViewScale(scale / Math.pow(1.03, tr.amount));
    setViewOffset(origPos - e.offsetX / scale);
  } else {
    const amount = 
      tr.isTrackpad ? tr.amountX :
      tr.amountX == 0 ? tr.amountY : tr.amountX;
    setViewOffset(getOffset() + amount * 0.5 / scale);
  }
}

function dispatchSelectionChanged() {
  Editing.clearFocus();
  Editing.selection.submitted = new Set(selection);
  if (selection.size == 1) {
    let array = [...selection.values()];
    Editing.selection.currentGroup = array;
    Editing.selection.focused = array[0];
  } else {
    Editing.selection.currentGroup = [];
    Editing.selection.focused = null;
  }
  Editing.onSelectionChanged.dispatch(ChangeCause.Timeline);
}

Playback.onClose.bind(me, async () => {
  if (sampler == undefined)
    return Debug.early('already closed');
  Debug.assert(samplerMedia !== undefined && !samplerMedia.isClosed);
  await Debug.info('closing timeline');
  await sampler.close();
  samplerMedia = undefined;
  sampler = null;
  Playback.setCursorPosition(0);
  manager.requestRender();
  await Debug.info('closed timeline');
});

Playback.onLoad.bind(me, async (rawurl) => {
  if (samplerMedia !== undefined && !samplerMedia.isClosed) {
    await close();
  }
  if (DebugConfig.data.disableWaveform) return;

  samplerMedia = await MMedia.open(rawurl);
  sampler = await AudioSampler.open(
    samplerMedia, TimelineConfig.data.waveformResolution);
  sampler.onProgress = () => manager.requestRender();
  setViewScale(Math.max(width / sampler.duration, 10));
  setViewOffset(0);
  Playback.setCursorPosition(0);
  requestedSampler = true;
  manager.requestRender();
});

// View & sampling methods
function getMaxPosition() {
  return sampler 
    ? sampler.duration 
    : Math.max(...Source.subs.entries.map((x) => x.end)) + 20;
}

function processSampler() {
  if (!sampler) return;

  let start = getOffset();
  let end = getOffset() + width / scale;
  const preload = Math.min(PRELOAD_MARGIN, (end - start) * PRELOAD_MARGIN_FACTOR);
  if (sampler.isSampling) {
    if (sampler.sampleProgress + preload < getOffset() 
      || sampler.sampleProgress > end + preload) 
        sampler.tryCancelSampling();
    else if (sampler.sampleEnd < end + preload) {
      sampler.extendSampling(end + preload);
    }
  }
  if (sampler.isSampling)
    return;

  const resolution = sampler.resolution;
  const i = Math.floor(getOffset() * resolution),
      i_end = Math.ceil(end * resolution);
  const subarray = sampler.detail.subarray(i, i_end);
  const first0 = subarray.findIndex((x) => x == 0);
  if (Playback.isPlaying) {
    if (first0 < 0) {
      requestedSampler = false;
      return;
    }
  } else {
    requestedSampler = false;
    if (first0 < 0) {
      return;
    }
  }
  start = (first0 + i) / resolution;
  let end0 = subarray.findIndex((x, i) => i > first0 && x > 0);
  if (end0 > 0) end = (end0 + i) / resolution;

  end += preload;
  if (start < 0) start = 0;
  if (end > sampler.duration) end = sampler.duration;
  if (end <= start) {
    Debug.debug(start, '>=', end);
    return;
  }

  sampler.startSampling(start, end);
  manager.requestRender();
}

function setViewOffset(v: number) {
  if (v < 0) v = 0;
  v = Math.min(v, getMaxPosition() - width / scale);
  manager.setScroll({x: v * scale});
  manager.requestRender();
  requestedSampler = true;
}

Playback.onCursorPositionChanged.bind(me, (pos) => {
  const originalPos = pos;
  if (pos < 0) pos = 0;
  pos = Math.min(pos, getMaxPosition());
  if (pos == originalPos) {
    keepPosInSafeArea(pos);
    manager.requestRender();
  } else {
    Playback.setCursorPosition(pos);
  }
});

Playback.onPositionChanged.bind(me, (pos) => {
  Playback.setCursorPosition(pos);
})

async function moveCursor(pos: number) {
  if (pos == Playback.cursorPosition) return;
  Playback.setPosition(pos);
}

function updateContentArea() {
  manager.setContentRect({r: getMaxPosition() * scale});
}

function setViewScale(v: number) {
  Debug.assert(v > 0);
  v = Math.max(v, width / getMaxPosition(), 0.15);
  v = Math.min(v, 500);
  if (v == scale) return;
  scale = v;
  updateContentArea();
  manager.requestRender();
  requestedSampler = true;
}

// Rendering methods
function renderWaveform(ctx: CanvasRenderingContext2D) {
  if (!sampler) return;

  const resolution = sampler.resolution;
  const pointsPerPixel = Math.max(1, Math.floor(resolution / scale / devicePixelRatio));
  const step = 2 ** Math.floor(Math.log2(pointsPerPixel));
  const data = sampler.data.getLevel(step);
  
  const start = Math.max(0, Math.floor(getOffset() * resolution / step));
  const end = Math.min(
    Math.ceil((getOffset() + width / scale) * resolution / step),
    data.length - 1);
  const width_v = 1 / resolution * scale * step;
  const drawWidth = Math.max(1 / devicePixelRatio, width_v);

  let points: {x: number, y: number}[] = [];
  ctx.fillStyle = PENDING_WAVEFORM_COLOR;
  for (let i = start; i < end; i++) {
    const detail = sampler.detail[i * step];
    const x = i * width_v;

    if (detail == 0) {
      ctx.fillRect(x, 0, drawWidth, height);
      requestedSampler = true;
    }

    let value = detail == 0 
      ? 0 
      : data[i] * (height - HEADER_HEIGHT);
    const point = {x, y: value / 2};
    points.push(point);
  }
  const baseline = (height - HEADER_HEIGHT) / 2 + HEADER_HEIGHT;
  ctx.beginPath();
  ctx.moveTo(start * width_v, baseline);
  points.forEach(
    ({x, y}) => ctx.lineTo(x, baseline + 0.5 / devicePixelRatio + y));
  ctx.lineTo(end * width_v, baseline);
  points.reverse().forEach(
    ({x, y}) => ctx.lineTo(x, baseline - 0.5 / devicePixelRatio - y));
  ctx.closePath();
  ctx.fillStyle = WAVEFORM_COLOR;
  ctx.fill();

  if (TimelineConfig.data.showDebug) {
    ctx.font = `8px Courier, monospace`;
    ctx.fillText(`using step=${step}`, manager.scroll[0] + 120, 35);
  }

  if (requestedSampler) processSampler();
}

function renderRuler(ctx: CanvasRenderingContext2D) {
  const line = (pos: number, height: number) => {
    ctx.beginPath();
    ctx.moveTo(pos, 0);
    ctx.lineTo(pos, height);
    ctx.stroke();
  };
  const [small, nMed, nBig] = getTick(scale);
  const start = Math.floor(getOffset() / small / nBig) * small * nBig, 
        end = getOffset() + width / scale;
  const n = Math.ceil((end - start) / small);
  ctx.fillStyle = HEADER_BACK;
  ctx.fillRect(manager.scroll[0], 0, width, HEADER_HEIGHT);

  ctx.lineWidth = 0.5;
  for (let i = 0; i < n; i++) {
    const t = start + i * small;
    const pos = t * scale;
    let tickHeight;
    if (i % nBig == 0) {
      tickHeight = HEADER_HEIGHT;
      ctx.strokeStyle = LINE_BIG_COLOR;
      line(pos, height);
    } else if (i % nMed == 0) {
      tickHeight = HEADER_HEIGHT * 0.5;
      ctx.strokeStyle = LINE_MED_COLOR;
      line(pos, height);
    } else {
      tickHeight = HEADER_HEIGHT * 0.2;
    }
    ctx.strokeStyle = TICK_COLOR;
    line(pos, tickHeight);
  }

  ctx.fillStyle = RULER_TEXT;
  ctx.font = font(HEADER_HEIGHT * 0.8);
  ctx.textBaseline = 'bottom';
  for (let t = start; t < end; t += nBig * small) {
    const pos = Math.round(t * scale);
    ctx.fillText(Basic.formatTimestamp(t, 2), pos + 5, HEADER_HEIGHT);
  }
}

function renderTracks(ctx: CanvasRenderingContext2D) {
  ellipsisWidth = -1;
  ctx.textBaseline = 'top';
  ctx.font = font(TimelineConfig.data.fontSize);
  for (let ent of getVisibleEntries()) {
    getEntryPositions(ent).forEach((b) => {
      ctx.fillStyle = ent.label === 'none' 
        ? ENTRY_BACK 
        : LabelColor(ent.label, ENTRY_BACK_OPACITY);
      if (selection.has(ent)) {
        ctx.strokeStyle = ENTRY_BORDER_FOCUS;
        ctx.lineWidth = ENTRY_WIDTH_FOCUS;
      } else {
        ctx.strokeStyle = ENTRY_BORDER;
        ctx.lineWidth = ENTRY_WIDTH;
      }
      ctx.beginPath();
      ctx.roundRect(b.x, b.y, b.w, b.h, 4);
      ctx.fill();
      ctx.stroke();
      if (b.w > 50) {
        ctx.fillStyle = ENTRY_TEXT;
        ctx.fillText(
          ellipsisText(ctx, b.text, b.w - 8), 
          b.x + 4, b.y + 4);
      }
    });
  }
}

function renderCursor(ctx: CanvasRenderingContext2D) {
  let pos = Playback.cursorPosition * scale;
  if (selectBox) {
    ctx.fillStyle = BOXSELECT_BACK;
    ctx.strokeStyle = BOXSELECT_BORDER;
    ctx.lineWidth = BOXSELECT_WIDTH;
    ctx.beginPath();
    ctx.roundRect(
      selectBox.x, selectBox.y, 
      selectBox.w, selectBox.h, 2);
    ctx.fill();
    ctx.stroke();
  }
  if (alignmentLine) {
    ctx.strokeStyle = ALIGNLINE_COLOR;
    ctx.lineWidth = ALIGNLINE_WIDTH;
    ctx.beginPath();
    ctx.moveTo(alignmentLine.x - 5, alignmentLine.y1 - 5);
    ctx.lineTo(alignmentLine.x, alignmentLine.y1);
    ctx.lineTo(alignmentLine.x + 5, alignmentLine.y1 - 5);

    ctx.moveTo(alignmentLine.x - 5, alignmentLine.y2 + 5);
    ctx.lineTo(alignmentLine.x, alignmentLine.y2);
    ctx.lineTo(alignmentLine.x + 5, alignmentLine.y2 + 5);

    ctx.moveTo(alignmentLine.x, HEADER_HEIGHT);
    ctx.lineTo(alignmentLine.x, height);
    ctx.stroke();
  }

  // In-out area
  const area = get(Playback.playArea);
  const scrollX = manager.scroll[0];
  if (area.start !== undefined) {
    const start = area.start * scale;
    ctx.fillStyle = INOUT_AREA_OUTSIDE;
    ctx.fillRect(scrollX, 0, start - scrollX, height);
  }
  if (area.end !== undefined) {
    const end = area.end * scale;
    ctx.fillStyle = INOUT_AREA_OUTSIDE;
    ctx.fillRect(end, 0, width + scrollX - end, height);
  }

  ctx.fillStyle = CURSOR_COLOR;
  ctx.beginPath();
  ctx.moveTo(pos + 4, 0);
  ctx.lineTo(pos - 4, 0);
  ctx.lineTo(pos - 1, 10);
  ctx.lineTo(pos - 1, height);
  ctx.lineTo(pos + 1, height);
  ctx.lineTo(pos + 1, 10);
  ctx.lineTo(pos + 4, 0);
  ctx.fill();
}

function render(ctx: CanvasRenderingContext2D) {
  const t0 = Date.now();

  renderRuler(ctx);
  renderWaveform(ctx);
  renderTracks(ctx);
  renderCursor(ctx);

  ctx.font = 'bold ' + font(TimelineConfig.data.fontSize);
  ctx.fillStyle = INOUT_TEXT;
  ctx.textBaseline = 'top';
  const area = get(Playback.playArea);
  const status = (area.start === undefined ? '' : 'IN ')
               + (area.end === undefined ? '' : 'OUT ')
               + (area.loop ? 'LOOP ' : '');
  const statusWidth = ctx.measureText(status).width;
  ctx.fillText(status, 
    width - statusWidth - 5 + manager.scroll[0], HEADER_HEIGHT + 5);
  
  if (!TimelineConfig.data.showDebug) return;
  ctx.translate(manager.scroll[0], 0);
  ctx.font = `8px Courier, monospace`;
  ctx.fillStyle = theme.isDark ? 'white' : 'black';
  ctx.fillText(`offset=${getOffset().toFixed(2)}`, 5, 15);
  ctx.fillText(`scale=${scale.toFixed(2)}`, 5, 25);
  ctx.fillText(`render time=${(Date.now() - t0).toFixed(1)}`, 80, 15);
  ctx.fillText(`dpr=${devicePixelRatio}`, 80, 25);
}
</script>

<div class="container">
  <button onclick={(ev) => {
    const rect = ev.currentTarget.getBoundingClientRect();
    rowPopup.open!(rect);
  }} aria-label='edit'>
    <svg class="feather">
      <use href={`/feather-sprite.svg#edit-3`} />
    </svg>
  </button>
  <canvas class="timeline fill" bind:this={timelineCanvas}
    use:setupTimelineCanvas
    onclick={() => $uiFocus = 'Timeline'}
    class:timelinefocused={$uiFocus === 'Timeline'}>
  </canvas>
</div>

<Popup bind:handler={rowPopup} position="left">
  <div class="vlayout">
    <h5>
      {$_('timeline.filter-styles')}
    </h5>
    {#key styleRefreshCounter}
    {@const exclude = Source.subs.view.timelineExcludeStyles}
    {#each Source.subs.styles as style }
      <label>
        <input type="checkbox"
          checked={!exclude.has(style)}
          disabled={!exclude.has(style) && exclude.size >= Source.subs.styles.length - 1}
          onchange={(ev) => {
            if (ev.currentTarget.checked)
              exclude.delete(style);
            else
              exclude.add(style);
            preprocessStyles();
            Source.markChanged(ChangeType.View);
          }} />
        {style.name}
      </label>
    {/each}
    {/key}
  </div>
</Popup>

<style>
@media (prefers-color-scheme: light) {
  canvas.timeline {
    background-color: var(--uchu-gray-1);
  }
  .timelinefocused {
    box-shadow: 0 5px 10px gray;
  }
}

@media (prefers-color-scheme: dark) {
  canvas.timeline {
    background-color: black;
  }
  .timelinefocused {
    box-shadow: 0 5px 10px gray;
  }
}

h5 {
  padding-top: 0;
}

.timeline {
  border-radius: 4px;
  display: block;
  background-color: gray;
  user-select: none; -webkit-user-select: none;
  -moz-user-select: none; -ms-user-select: none;
}

.container {
  position: relative;
  width: 100%;
  height: 100%;
}
.container button {
  position: absolute;
  top: 0;
  right: 0;
  margin-right: 12px;
  margin-top: 2px;
}
</style>