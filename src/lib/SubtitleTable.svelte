<script lang="ts" module>
export const TableConfig = new PublicConfigGroup(
  () => get(_)('config.table-view'),
  null, 1,
{
  maxZoom: {
    localizedName: () => get(_)('config.maximum-zoom'),
    type: 'number',
    description: () => get(_)('config.maximum-zoom-d'),
    bounds: [1, 6],
    default: 2
  },
  autoScrollSpeed: {
    localizedName: () => get(_)('config.auto-scroll-factor'),
    type: 'number',
    description: () => get(_)('config.auto-scroll-factor-d'),
    bounds: [1, 5],
    default: 2
  },
  autoScrollExponent: {
    localizedName: () => get(_)('config.auto-scroll-exponent'),
    type: 'number',
    description: () => get(_)('config.auto-scroll-exponent-d'),
    bounds: [1, 2],
    default: 1.5
  },
});
</script>

<script lang="ts">
import { onDestroy, onMount } from "svelte";
import { SvelteSet } from "svelte/reactivity";

import { assert, Basic } from "./Basic";
import { SubtitleEntry } from "./core/Subtitles.svelte";
import { theme, LabelColor } from "./Theming.svelte";

import { CanvasManager } from "./CanvasManager";
import { InterfaceConfig } from "./config/Groups";
import { PublicConfigGroup } from "./config/PublicConfig.svelte";
import { Actions } from "./frontend/Actions";
import { Editing, getSelectMode, SelectMode } from "./frontend/Editing";
import { EventHost } from "./frontend/Frontend";
import { Interface, UIFocus } from "./frontend/Interface";
import { Playback } from "./frontend/Playback";
import { ChangeCause, ChangeType, Source } from "./frontend/Source";

import { _ } from 'svelte-i18n';
import { get } from 'svelte/store';

let selection = $state(new SvelteSet<SubtitleEntry>);
let canvas = $state<HTMLCanvasElement>();
let manager: CanvasManager;
let cxt: CanvasRenderingContext2D;

let uiFocus = Interface.uiFocus;
let lines: {entry: SubtitleEntry, line: number, height: number}[] = [];
let lineMap = new WeakMap<SubtitleEntry, {line: number, height: number}>();
let totalLines = 0;
let requestedLayout = false;
let colPos: [number, number, number, number, number, number,] = [0, 0, 0, 0, 0, 0];

const linePadding   = $derived(InterfaceConfig.data.fontSize * 0.35);
const lineHeight    = $derived(InterfaceConfig.data.fontSize + linePadding * 2);
const headerHeight  = $derived(lineHeight);
const cellPadding   = $derived(InterfaceConfig.data.fontSize * 0.4);

const textColor           = $derived(theme.isDark ? '#fff'          : '#000');
const gridColor           = $derived(theme.isDark ? '#444'          : '#bbb');
const gridMajorColor      = $derived(theme.isDark ? '#666'          : '#999');
const headerBackground    = $derived(theme.isDark ? '#555'          : '#ddd');
const overlapColor        = $derived(theme.isDark ? 'lightpink'     : 'crimson');
const focusBackground     = $derived(theme.isDark ? 'darkslategray' : 'lightblue');
const selectedBackground  = $derived(theme.isDark ? '#444'          : '#eee');

function font() {
  return `${InterfaceConfig.data.fontSize}px ${InterfaceConfig.data.fontFamily}`;
}

function layout(cxt: CanvasRenderingContext2D) {
  cxt.resetTransform();
  cxt.scale(devicePixelRatio, devicePixelRatio);
  cxt.font = font();

  lines = []; totalLines = 0;
  let textWidth = 0;
  for (const entry of Source.subs.entries) {
    let height = 0;
    for (const channel of entry.texts) {
      let splitLines = channel.text.split('\n');
      height += splitLines.length;
      textWidth = Math.max(textWidth, ...splitLines.map((x) => cxt.measureText(x).width));
    }
    lines.push({entry, line: totalLines, height});
    lineMap.set(entry, {line: totalLines, height});
    totalLines += height;
  }

  const timestampWidth = cxt.measureText(`99:99:99.999`).width;
  colPos[0] = 0;
  colPos[1] = colPos[0] + cellPadding * 2 + cxt.measureText(`${lines.length+1}`).width;
  colPos[2] = colPos[1] + cellPadding * 2 + timestampWidth;
  colPos[3] = colPos[2] + cellPadding * 2 + timestampWidth;
  colPos[4] = colPos[3] + cellPadding * 2 + Math.max(
    ...[Source.subs.defaultStyle, ...Source.subs.styles]
      .map((x) => cxt.measureText(x.name).width), 
    cxt.measureText('style').width);
  colPos[5] = colPos[4] + cellPadding * 2 + cxt.measureText(`999.9`).width;

  manager.setContentRect({
    r: colPos[5] + cellPadding * 2 + textWidth + manager.scrollerSize,
    b: (totalLines + 1) * lineHeight + headerHeight + manager.scrollerSize // add 1 for virtual entry
  });
}

function render(cxt: CanvasRenderingContext2D) {
  const drawLine = (x1: number, y1: number, x2: number, y2: number) => {
    cxt.beginPath();
    cxt.moveTo(x1, y1);
    cxt.lineTo(x2, y2);
    cxt.stroke();
  };

  if (requestedLayout) {
    layout(cxt);
    requestedLayout = false;
  }

  cxt.font = font();
  cxt.textBaseline = 'top';
  cxt.fillStyle = textColor;

  const [sx, sy] = manager.scroll;
  const [width, height] = manager.size;

  // table
  let selection = new Set(Editing.getSelection());
  let focused = Editing.getFocusedEntry();
  let i = 0;
  for (const {entry, line, height: lh} of lines) {
    i += 1;
    if ((line + lh) * lineHeight < sy) continue;
    if (line * lineHeight > sy + width) break;

    // background
    const y = line * lineHeight + headerHeight;
    const h = lh * lineHeight;
    if (entry == focused) {
      cxt.fillStyle = focusBackground;
      cxt.fillRect(0, y+1, width + sx, h-2);
    } else if (selection.has(entry)) {
      cxt.fillStyle = selectedBackground;
      cxt.fillRect(0, y+1, width + sx, h-2);
    }

    // label
    if (entry.label !== 'none') {
      cxt.fillStyle = LabelColor(entry.label);
      cxt.fillRect(0, y, colPos[1], h);
    }

    // texts
    cxt.fillStyle = 
      (entry !== focused 
        && focused instanceof SubtitleEntry 
        && overlappingTime(focused, entry)) ? overlapColor : textColor;
    cxt.strokeStyle = gridColor;
    let y0 = y;
    entry.texts.forEach((channel, i) => {
      // lines
      cxt.textBaseline = 'middle';
      cxt.textAlign = 'start';
      const splitLines = channel.text.split('\n');
      splitLines.forEach((x, i) => 
        cxt.fillText(x, colPos[5] + cellPadding, y0 + (i + 0.5) * lineHeight));

      const cellY = y0 + (splitLines.length * lineHeight) / 2;
      cxt.fillText(channel.style.name, colPos[3] + cellPadding, cellY);
      cxt.textAlign = 'end';
      cxt.fillText(getNpS(entry, channel.text), colPos[5] - cellPadding, cellY);

      // inner horizontal lines
      y0 += splitLines.length * lineHeight;
      if (i != entry.texts.length - 1) {
        drawLine(colPos[3], y0, width + sx, y0);
      }
    });

    // entry cells
    cxt.textBaseline = 'middle';
    cxt.textAlign = 'end';
    cxt.fillText(`${i}`, 
      colPos[1] - cellPadding, y + h * 0.5);
    cxt.textAlign = 'start';
    cxt.fillText(Basic.formatTimestamp(entry.start), 
      colPos[1] + cellPadding, y + h * 0.5);
    cxt.fillText(Basic.formatTimestamp(entry.end), 
      colPos[2] + cellPadding, y + h * 0.5);

    // outer horizontal line
    cxt.strokeStyle = gridMajorColor;
    drawLine(0, y + h, width + sx, y + h);
  }

  if (i == lines.length) {
    // virtual entry
    const lastLine = lines.at(-1);
    const y = lastLine 
        ? (lastLine.line + lastLine.height + 1) * lineHeight 
        : 0;
    if (focused == 'virtual') {
      cxt.fillStyle = focusBackground;
      cxt.fillRect(0, y, width + sx, lineHeight);
    }
    cxt.fillStyle = textColor;
    cxt.textBaseline = 'middle';
    cxt.textAlign = 'end';
    cxt.fillText(`*`, colPos[1] - cellPadding, y + lineHeight * 0.5);
  }

  // header
  cxt.fillStyle = headerBackground;
  cxt.fillRect(0, manager.scroll[1], sx + width, headerHeight);
  cxt.fillStyle = textColor;
  cxt.textBaseline = 'top';
  cxt.textAlign = 'end';
  cxt.fillText(`#`,     colPos[1] - cellPadding, sy + linePadding);
  cxt.fillText(`nps`,   colPos[5] - cellPadding, sy + linePadding);
  cxt.textAlign = 'center';
  cxt.fillText($_('table.start'), (colPos[1] + colPos[2]) / 2, sy + linePadding);
  cxt.fillText($_('table.end'),   (colPos[2] + colPos[3]) / 2, sy + linePadding);
  cxt.fillText($_('table.style'), (colPos[3] + colPos[4]) / 2, sy + linePadding);
  cxt.textAlign = 'start';
  cxt.fillText($_('table.text'),  colPos[5] + cellPadding, sy + linePadding);

  // vertical lines
  cxt.strokeStyle = gridMajorColor;

  const maxY = manager.contentRect.b;
  drawLine(colPos[1], sy, colPos[1], 
    Math.min(sy + height, maxY - manager.scrollerSize));

  const bottom = Math.min(sy + height, maxY - lineHeight - manager.scrollerSize);
  colPos.slice(2).map((pos) => drawLine(pos, sy, pos, bottom));
}

const me = {};
onDestroy(() => EventHost.unbind(me));

Source.onSubtitleObjectReload.bind(me, () => {
  requestedLayout = true;
  manager.requestRender();
});

Source.onSubtitlesChanged.bind(me, (t) => {
  if (t !== ChangeType.Metadata) {
    requestedLayout = true;
    manager.requestRender();
  }
});

Editing.onSelectionChanged.bind(me, () => {
  selection = new SvelteSet(Editing.getSelection());
  manager.requestRender();
});

Editing.onKeepEntryAtPosition.bind(me, (ent, old) => {
  if (manager.dragType !== 'none') return;

  const posNew = lineMap.get(ent);
  const posOld = lineMap.get(old);
  if (posNew === undefined || posOld === undefined) {
    console.warn('?!row', ent, old);
    return;
  }
  const sy = (posNew.line - posOld.line) * lineHeight + manager.scroll[1];
  manager.setScroll({y: sy})
  manager.requestRender();
});

Editing.onKeepEntryInView.bind(me, (ent) => {
  // otherwise dragging outside/auto scrolling becomes unusable
  if (manager.dragType !== 'none') return;

  if (ent instanceof SubtitleEntry) {
    const pos = lineMap.get(ent);
    if (pos === undefined) {
      console.warn('?!row', ent);
      return;
    }
    const sy = Math.max(
      (pos.line + pos.height + 1) * lineHeight - manager.size[1] / manager.scale, 
      Math.min(manager.scroll[1], pos.line * lineHeight));
    manager.setScroll({y: sy})
    manager.requestRender();
  } else {
    const sy = manager.contentRect.b - manager.size[1] / manager.scale;
    manager.setScroll({y: sy})
    manager.requestRender();
  }
});

onMount(() => {
  assert(canvas !== undefined);
  manager = new CanvasManager(canvas);
  manager.onDisplaySizeChanged.bind(me, (w, h) => {
    manager.requestRender();
  });
  manager.renderer = (ctx) => render(ctx);
  manager.onMouseDown.bind(me, onMouseDown);
  manager.onDrag.bind(me, onDrag);
  cxt = manager.context;

  $effect(() => {
    if (InterfaceConfig.data.fontSize || InterfaceConfig.data.fontFamily) {
      requestedLayout = true;
      manager.requestRender();
    }
  });

  $effect(() => {
    if (theme.isDark !== undefined)
      manager.requestRender();
  });

  $effect(() => {
    manager.setMaxZoom(TableConfig.data.maxZoom);
  });
});


function overlappingTime(e1: SubtitleEntry | null, e2: SubtitleEntry) {
  return e1 && e2 && e1.start < e2.end && e1.end > e2.start;
}


function getTextLength(s: string) {
  return [...s.matchAll(/[\w\u4E00-\u9FFF]/g)].length;
}

function getNpS(ent: SubtitleEntry, text: string) {
  let num = getTextLength(text) / (ent.end - ent.start);
  return (isFinite(num) && !isNaN(num)) ? num.toFixed(1) : '--';
}

function onFocus() {
  Interface.uiFocus.set(UIFocus.Table);
}

let currentLine = -1;
let autoScrollY = 0;
let lastAnimateFrameTime = -1;

function onMouseDown(ev: MouseEvent) {
  onFocus();
  if (ev.button == 0) {
    currentLine = (ev.offsetY / manager.scale + manager.scroll[1] - headerHeight) / lineHeight;
    if (currentLine > totalLines) {
      Editing.selectVirtualEntry();
      return;
    } else {
      let i = 1;
      for (; i < lines.length && lines[i].line <= currentLine; i++);
      Editing.toggleEntry(lines[i-1].entry, getSelectMode(ev), ChangeCause.UIList);
    }
  }
}

function requestAutoScroll() {
  const doAutoScroll = () => {
    if (autoScrollY == 0) {
      lastAnimateFrameTime = -1;
      return;
    }
    let time = performance.now();
    manager.setScroll({y: autoScrollY * (time - lastAnimateFrameTime) * 0.001})
    lastAnimateFrameTime = time;

    const line = (((autoScrollY < 0) ? 0 : manager.size[1]) / manager.scale + manager.scroll[1] - headerHeight) / lineHeight;
    if (line != currentLine) {
      currentLine = line;
      let i = 1;
      for (; i < lines.length && lines[i].line < currentLine; i++);
      Editing.selectEntry(lines[i-1].entry, SelectMode.Sequence);
    }

    manager.requestRender();
    requestAnimationFrame(() => doAutoScroll());
  }
  if (lastAnimateFrameTime < 0)
    lastAnimateFrameTime = performance.now();
  requestAnimationFrame(() => doAutoScroll());
}

function powWithSign(x: number, y: number) {
  return Math.sign(x) * Math.pow(Math.abs(x), y);
}

function onDrag(offsetX: number, offsetY: number) {
  // auto scroll if pointing outside
  const speed = TableConfig.data.autoScrollSpeed;
  const exponent = TableConfig.data.autoScrollExponent;
  if (offsetY < headerHeight) {
    if (autoScrollY == 0) requestAutoScroll();
    autoScrollY = powWithSign((offsetY - headerHeight) * speed, exponent);
  } else if (offsetY > manager.size[1]) {
    if (autoScrollY == 0) requestAutoScroll();
    autoScrollY = powWithSign((offsetY - manager.size[1]) * speed, exponent);
  } else {
    autoScrollY = 0;
  }

  let line = (offsetY / manager.scale + manager.scroll[1] - headerHeight) / lineHeight;
  if (line != currentLine) {
    currentLine = line;
    let i = 1;
    for (; i < lines.length && lines[i].line < currentLine; i++);
    Editing.selectEntry(lines[i-1].entry, SelectMode.Sequence);
  }
}
</script>

<canvas bind:this={canvas}
  class:subsfocused={$uiFocus === UIFocus.Table}
  ondblclick={() => {
    onFocus();
    let focused = Editing.getFocusedEntry();
    assert(focused !== null);
    if (focused == 'virtual') {
      Editing.startEditingNewVirtualEntry();
    } else {
      Playback.setPosition(focused.start);
      Editing.startEditingFocusedEntry();
    }
  }}
  oncontextmenu={(ev) => {
    onFocus();
    ev.preventDefault();
    Actions.contextMenu();
  }}
></canvas>

<style>
  canvas {
    width: 100%;
    height: 100%;
    border-radius: 4px;
    margin-bottom: 6px;
  }

  .subsfocused {
    /* border: 2px solid skyblue; */
    box-shadow: 0 5px 10px gray;
  }
</style>