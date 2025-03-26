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
  minScrollerLength: {
      localizedName: () => get(_)('config.minimum-scroller-length'),
      type: 'number',
      description: () => get(_)('config.minimum-scroller-length-d'),
      bounds: [1, 200],
      default: 20
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

import { SubtitleEntry, SubtitleUtil } from "./core/Subtitles.svelte";
import { LabelColor } from "./Theming";
import { assert } from "./Basic";

import { ChangeCause, ChangeType, Source } from "./frontend/Source";
import { Editing, getSelectMode, SelectMode } from "./frontend/Editing";
import { Interface, UIFocus } from "./frontend/Interface";
import { Playback } from "./frontend/Playback";
import { Actions } from "./frontend/Actions";
import { EventHost, translateWheelEvent } from "./frontend/Frontend";
import { CanvasKeeper } from "./CanvasKeeper";
import { PublicConfigGroup } from "./config/PublicConfig.svelte";
import { InterfaceConfig } from "./config/Groups";

import { _ } from 'svelte-i18n';
import { get } from 'svelte/store';

let selection = $state(new SvelteSet<SubtitleEntry>);
let canvas = $state<HTMLCanvasElement>();
let cxt: CanvasRenderingContext2D;

let uiFocus = Interface.uiFocus;

let centerX: number | undefined;
let centerY: number | undefined;

let scale = 1;
let scrollX = 0, scrollY = 0;
let width = 100, height = 100;

let lines: {entry: SubtitleEntry, line: number, height: number}[] = [];
let lineMap = new WeakMap<SubtitleEntry, {line: number, height: number}>();
let maxX = 0, maxY = 0, totalLines = 0;
let requestedRender = false;
let colPos: [number, number, number, number, number, number,] = [0, 0, 0, 0, 0, 0];

let linePadding = $derived(InterfaceConfig.data.fontSize * 0.35);
let lineHeight = $derived(InterfaceConfig.data.fontSize + linePadding * 2);
let headerHeight = $derived(lineHeight);
let cellPadding = $derived(InterfaceConfig.data.fontSize * 0.4);
let scrollerSize = 4;

const gridColor = '#bbb';
const gridMajorColor = '#999';
const headerBackground = '#ddd';
const overlapColor = 'crimson';
const focusBackground = 'lightblue';
const selectedBackground = 'rgb(234, 234, 234)';

const scrollerFade = 1500;
const scrollerFadeStart = 1000;

function font() {
  return `${InterfaceConfig.data.fontSize}px ${InterfaceConfig.data.fontFamily}`;
}

function layout() {
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

  maxY = (totalLines + 1) * lineHeight + headerHeight; // add 1 for virtual entry
  maxX = colPos[5] + cellPadding * 2 + textWidth;
}

let scrollerFadeStartTime = 0;

function render() {
  const drawLine = (x1: number, y1: number, x2: number, y2: number) => {
    cxt.beginPath();
    cxt.moveTo(x1, y1);
    cxt.lineTo(x2, y2);
    cxt.stroke();
  };

  requestedRender = false;
  cxt.resetTransform();
  cxt.scale(devicePixelRatio, devicePixelRatio);
  cxt.clearRect(0, 0, width, height);
  cxt.scale(scale, scale);
  cxt.translate(-scrollX, -scrollY);
  cxt.font = font();
  cxt.textBaseline = 'top';
  cxt.fillStyle = 'black';

  // table
  let selection = new Set(Editing.getSelection());
  let focused = Editing.getFocusedEntry();
  let i = 0;
  for (const {entry, line, height: lh} of lines) {
    i += 1;
    if ((line + lh) * lineHeight < scrollY) continue;
    if (line * lineHeight > scrollY + height) break;

    // background
    const y = line * lineHeight + headerHeight;
    const h = lh * lineHeight;
    if (entry == focused) {
      cxt.fillStyle = focusBackground;
      cxt.fillRect(0, y, width + scrollX, h);
    } else if (selection.has(entry)) {
      cxt.fillStyle = selectedBackground;
      cxt.fillRect(0, y, width + scrollX, h);
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
        && overlappingTime(focused, entry)) ? overlapColor : 'black';
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
        drawLine(colPos[3], y0, width + scrollX, y0);
      }
    });

    // entry cells
    cxt.textBaseline = 'middle';
    cxt.textAlign = 'end';
    cxt.fillText(`${i}`, 
      colPos[1] - cellPadding, y + h * 0.5);
    cxt.textAlign = 'start';
    cxt.fillText(SubtitleUtil.formatTimestamp(entry.start), 
      colPos[1] + cellPadding, y + h * 0.5);
    cxt.fillText(SubtitleUtil.formatTimestamp(entry.end), 
      colPos[2] + cellPadding, y + h * 0.5);

    // outer horizontal line
    cxt.strokeStyle = gridMajorColor;
    drawLine(0, y + h, width + scrollX, y + h);
  }
  if (i == lines.length) {
    // virtual entry
    if (focused == 'virtual') {
      cxt.fillStyle = focusBackground;
      cxt.fillRect(0, maxY - lineHeight, width + scrollX, lineHeight);
    }
    cxt.fillStyle = 'black';
    cxt.textBaseline = 'middle';
    cxt.textAlign = 'end';
    cxt.fillText(`*`, colPos[1] - cellPadding, maxY - lineHeight * 0.5);
  }

  // header
  cxt.fillStyle = headerBackground;
  cxt.fillRect(0, scrollY, scrollX + width, headerHeight);
  cxt.fillStyle = 'black';
  cxt.textBaseline = 'top';
  cxt.textAlign = 'end';
  cxt.fillText(`#`,     colPos[1] - cellPadding, scrollY + linePadding);
  cxt.fillText(`nps`,   colPos[5] - cellPadding, scrollY + linePadding);
  cxt.textAlign = 'center';
  cxt.fillText($_('table.start'), (colPos[1] + colPos[2]) / 2, scrollY + linePadding);
  cxt.fillText($_('table.end'),   (colPos[2] + colPos[3]) / 2, scrollY + linePadding);
  cxt.fillText($_('table.style'), (colPos[3] + colPos[4]) / 2, scrollY + linePadding);
  cxt.textAlign = 'start';
  cxt.fillText($_('table.text'),  colPos[5] + cellPadding, scrollY + linePadding);

  // vertical lines
  cxt.strokeStyle = gridMajorColor;
  drawLine(colPos[1], scrollY, colPos[1], Math.min(scrollY + height, maxY));

  const bottom = Math.min(scrollY + height, maxY - lineHeight);
  colPos.slice(2).map((pos) => drawLine(pos, scrollY, pos, bottom));

  const now = performance.now();
  if (now > scrollerFadeStartTime + scrollerFade) return;
  const fade = 
    1 - Math.max(0, now - scrollerFadeStartTime - scrollerFadeStart) 
    / (scrollerFade - scrollerFadeStart);

  // for scrollers, draw in screen space again
  cxt.resetTransform();
  cxt.scale(devicePixelRatio, devicePixelRatio);
  cxt.fillStyle = `rgb(0 0 0 / ${40 * fade}%)`;
  const minScrollerLength = TableConfig.data.minScrollerLength;
  if (maxX > width / scale) {
    let scaledScreen = width / scale;
    let len = Math.max(minScrollerLength, scaledScreen / maxX * width);
    cxt.fillRect(
      scrollX / (maxX - scaledScreen) * (width - len), 
      height - scrollerSize, 
      len, 
      scrollerSize);
  }
  if (maxY > height / scale) {
    let scaledScreen = height / scale;
    let len = Math.max(minScrollerLength, scaledScreen / maxY * height);
    cxt.fillRect(
      width - scrollerSize, 
      scrollY / (maxY - scaledScreen) * (height - len),
      scrollerSize, 
      len);
  }
  if (now - scrollerFadeStartTime < scrollerFadeStart) {
    setTimeout(requestRender, scrollerFadeStart - now + scrollerFadeStartTime);
  } else {
    requestRender();
  }
}

function requestRender() {
  if (requestedRender) return;
  requestedRender = true;
  requestAnimationFrame(() => render());
}

const me = {};
onDestroy(() => EventHost.unbind(me));

Source.onSubtitleObjectReload.bind(me, () => {
  layout();
  requestRender();
});

Source.onSubtitlesChanged.bind(me, (t) => {
  if (t !== ChangeType.Metadata) {
    layout();
    requestRender();
  }
});

Editing.onSelectionChanged.bind(me, () => {
  selection = new SvelteSet(Editing.getSelection());
  requestRender();
});

Editing.onKeepEntryInView.bind(me, (ent) => {
  // otherwise dragging outside/auto scrolling becomes unusable
  if (isDragging) return;

  if (ent instanceof SubtitleEntry) {
    const pos = lineMap.get(ent);
    if (pos === undefined) {
        console.warn('?!row', ent);
        return;
    }
    scrollY = Math.max(
      (pos.line + pos.height + 1) * lineHeight - height / scale, 
      Math.min(scrollY, pos.line * lineHeight));
    requestRender();
  } else {
    scrollY = Math.max(0, maxY - height / scale);
    requestRender();
  }
});


onMount(() => {
  assert(canvas !== undefined);
  let keeper = new CanvasKeeper(canvas, canvas);
  keeper.bind({
    setDisplaySize(w, h, rw, rh) {
        width = w;
        height = h;
        requestRender();
    },
  });
  cxt = keeper.cxt;

  $effect(() => {
    if (InterfaceConfig.data.fontSize || InterfaceConfig.data.fontFamily) {
      layout();
      requestRender();
    }
  });
});


function overlappingTime(e1: SubtitleEntry | null, e2: SubtitleEntry) {
  return e1 && e2 && e1.start < e2.end && e1.end > e2.start;
}

function getNpS(ent: SubtitleEntry, text: string) {
  let num = SubtitleUtil.getTextLength(text) / (ent.end - ent.start);
  return (isFinite(num) && !isNaN(num)) ? num.toFixed(1) : '--';
}

function onFocus() {
  Interface.uiFocus.set(UIFocus.Table);
}

let currentLine = -1;
let autoScrollY = 0, isDragging = false;;
let lastAnimateFrameTime = -1;

function onMouseDown(ev: MouseEvent) {
  onFocus();
  if (ev.button == 0) {
    currentLine = (ev.offsetY / scale + scrollY - headerHeight) / lineHeight;
    if (currentLine > totalLines) {
      Editing.selectVirtualEntry();
    } else {
      let i = 1;
      for (; i < lines.length && lines[i].line <= currentLine; i++);
      Editing.toggleEntry(lines[i-1].entry, getSelectMode(ev), ChangeCause.UIList);
      isDragging = true;
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', () => {
        document.removeEventListener('mousemove', onMouseMove);
        isDragging = false;
        autoScrollY = 0;
      }, { once: true });
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
    scrollY += autoScrollY * (time - lastAnimateFrameTime) * 0.001;
    lastAnimateFrameTime = time;
    constraintScroll();

    let line = (((autoScrollY < 0) ? 0 : height) / scale + scrollY - headerHeight) / lineHeight;
    if (line != currentLine) {
      currentLine = line;
      let i = 1;
      for (; i < lines.length && lines[i].line < currentLine; i++);
      Editing.selectEntry(lines[i-1].entry, SelectMode.Sequence);
    }

    requestRender();
    requestAnimationFrame(() => doAutoScroll());
  }
  if (lastAnimateFrameTime < 0)
    lastAnimateFrameTime = performance.now();
  requestAnimationFrame(() => doAutoScroll());
}

function powWithSign(x: number, y: number) {
  return Math.sign(x) * Math.pow(Math.abs(x), y);
}

function onMouseMove(ev: MouseEvent) {
  if (ev.buttons == 1) {
    let offsetY = ev.clientY - canvas!.getBoundingClientRect().top;
    // auto scroll if pointing outside
    const speed = TableConfig.data.autoScrollSpeed;
    const exponent = TableConfig.data.autoScrollExponent;
    if (offsetY < headerHeight) {
      if (autoScrollY == 0) requestAutoScroll();
      autoScrollY = powWithSign((offsetY - headerHeight) * speed, exponent);
    } else if (offsetY > height) {
      if (autoScrollY == 0) requestAutoScroll();
      autoScrollY = powWithSign((offsetY - height) * speed, exponent);
    } else {
      autoScrollY = 0;
    }

    let line = (offsetY / scale + scrollY - headerHeight) / lineHeight;
    if (line != currentLine) {
      currentLine = line;
      let i = 1;
      for (; i < lines.length && lines[i].line < currentLine; i++);
      Editing.selectEntry(lines[i-1].entry, SelectMode.Sequence);
    }
  }
}

function constraintScroll() {
  scrollerFadeStartTime = performance.now();
  scrollX = Math.max(0, Math.min(maxX - width / scale, scrollX));
  scrollY = Math.max(0, Math.min(maxY - height / scale, scrollY));
}

function processWheel(ev: WheelEvent) {
  const tr = translateWheelEvent(ev);
  if (tr.isZoom) {
    if (!centerX || !centerY) {
      centerX = ev.offsetX / scale + scrollX;
      centerY = ev.offsetY / scale + scrollY;
    }
    scale = Math.min(TableConfig.data.maxZoom, 
      Math.max(1, scale / Math.pow(1.01, tr.amount)));
    scrollX = centerX - ev.offsetX / scale;
    scrollY = centerY - ev.offsetY / scale;
  } else {
    scrollX += tr.amountX * 0.1;
    scrollY += tr.amountY * 0.1;
  }
  constraintScroll();
  requestRender();
}
</script>

<canvas bind:this={canvas}
  class:subsfocused={$uiFocus === UIFocus.Table}
  onwheel={(ev) => processWheel(ev)}
  onmousemove={() => centerX = undefined}
  onmousedown={(ev) => onMouseDown(ev)}
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