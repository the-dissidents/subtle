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
  doubleClickStartEdit: {
    localizedName: () => get(_)('config.double-click-starts-edit'),
    type: 'boolean',
    default: true
  },
  doubleClickPlaybackBehavior: {
    localizedName: () => get(_)('config.double-click-playback-behavior.name'),
    type: 'dropdown',
    options: {
      none: {
        localizedName: () => get(_)('config.double-click-playback-behavior.none')
      },
      seek: {
        localizedName: () => get(_)('config.double-click-playback-behavior.seek')
      },
      play: {
        localizedName: () => get(_)('config.double-click-playback-behavior.play')
      }
    },
    default: 'seek'
  }
});
</script>

<script lang="ts">
import { onDestroy, onMount } from "svelte";
import { SvelteSet } from "svelte/reactivity";

import { Debug } from "./Debug";
import { theme, LabelColor } from "./Theming.svelte";

import { SubtitleEntry, type SubtitleStyle } from "./core/Subtitles.svelte";
import { evaluateFilter, filterDescription, type SimpleMetricFilter, type MetricName, Metrics, Metric, type MetricContext } from "./core/Filter";

import { CanvasManager } from "./CanvasManager";
import { InterfaceConfig, MainConfig } from "./config/Groups";
import { PublicConfigGroup } from "./config/PublicConfig.svelte";

import { Actions } from "./frontend/Actions";
import { Editing, getSelectMode, SelectMode } from "./frontend/Editing";
import { EventHost } from "./details/EventHost";
import { Interface } from "./frontend/Interface";
import { Playback } from "./frontend/Playback";
import { ChangeCause, ChangeType, Source } from "./frontend/Source";

import { _, locale } from 'svelte-i18n';
import { get } from 'svelte/store';

import Popup, { type PopupHandler } from "./ui/Popup.svelte";
import OrderableList from "./ui/OrderableList.svelte";
import { Menu } from "@tauri-apps/api/menu";
import { DeleteIcon, PenLineIcon, PlusIcon } from "@lucide/svelte";

const MetricsList = Object.entries(Metrics) as [keyof typeof Metrics, Metric<any>][];

let selection = $state(new SvelteSet<SubtitleEntry>);
let canvas = $state<HTMLCanvasElement>();
let validationMessagePopup = $state<PopupHandler>({});
let columnPopup = $state<PopupHandler>({});
let popupMessage = $state('');
let manager: CanvasManager;

type Column = {
  metric: MetricName,
  layout?: ColumnLayout
};

type ColumnLayout = {
  name: string,
  align: 'start' | 'center' | 'end',
  position: number,
  textX: number
  width: number
};

let entryColumns = $state<Column[]>([{ metric: 'startTime' }, { metric: 'endTime' }]);
let channelColumns = $state<Column[]>([{ metric: 'style' }, { metric: 'content' }]);
let indexColumnLayout: ColumnLayout = { name: '#', align: 'end', position: 0, textX: -1, width: -1 };

type TextLayout = {
  style: SubtitleStyle,
  text: string,
  line: number, height: number,
  failed: SimpleMetricFilter[],
};

let uiFocus = Interface.uiFocus;
let lines: {
  entry: SubtitleEntry, 
  line: number, 
  height: number,
  texts: TextLayout[]
}[] = [];
let lineMap = new WeakMap<SubtitleEntry, {line: number, height: number}>();
let totalLines = 0;
let requestedLayout = true;

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
const errorBackground     = $derived(theme.isDark ? '#aa335599'     : '#eedd0099');

function font() {
  return `${InterfaceConfig.data.fontSize}px ${InterfaceConfig.data.fontFamily}`;
}

function layout(cxt: CanvasRenderingContext2D) {
  const startTime = performance.now();
  cxt.resetTransform();
  cxt.scale(devicePixelRatio, devicePixelRatio);
  cxt.font = font();

  for (const col of [...entryColumns, ...channelColumns]) {
    const metric = Metrics[col.metric];
    const name = metric.shortName();
    col.layout = {
      name, align: 'start',
      position: -1, 
      width: cxt.measureText(name).width + cellPadding * 2, 
      textX: -1
    };
  }

  lines = []; totalLines = 0;
  for (const entry of Source.subs.entries) {
    for (const col of entryColumns) {
      // FIXME: we assume no string metrics here
      const metric = Metrics[col.metric];
      const value = metric.stringValue(entry, Source.subs.defaultStyle);
      col.layout!.width = 
        Math.max(col.layout!.width, cxt.measureText(value).width + cellPadding * 2);
    }

    let entryHeight = 0;
    const texts: (typeof lines)[number]['texts'] = [];
    for (const style of Source.subs.styles) {
      const text = entry.texts.get(style);
      if (text === undefined) continue;

      let lineHeight = 1;
      for (const col of channelColumns) {
        const value = Metrics[col.metric].stringValue(entry, style);
        const splitLines = value.split('\n');
        const w = Math.max(...splitLines.map((x) => cxt.measureText(x).width)) + cellPadding * 2;
        col.layout!.width = Math.max(col.layout!.width, w);
        lineHeight = Math.max(lineHeight, splitLines.length);
      }

      texts.push({
        style, text: text,
        height: lineHeight,
        line: totalLines + entryHeight,
        failed: style.validator === null 
          ? [] : evaluateFilter(style.validator, entry, style).failed
      });
      entryHeight += lineHeight;
    }
    lines.push({entry, line: totalLines, height: entryHeight, texts});
    lineMap.set(entry, {line: totalLines, height: entryHeight});
    totalLines += entryHeight;
  }

  let pos = 0;
  indexColumnLayout.position = 0;
  indexColumnLayout.width = cellPadding * 2 + cxt.measureText(`${Math.max(lines.length+1, 100)}`).width;
  indexColumnLayout.textX = indexColumnLayout.width - cellPadding;
  pos += indexColumnLayout.width;

  for (const col of [...entryColumns, ...channelColumns]) {
    col.layout!.position = pos;
    col.layout!.textX = 
          col.layout!.align == 'start'  ? col.layout!.position + cellPadding
        : col.layout!.align == 'end'    ? col.layout!.position + col.layout!.width - cellPadding
        : col.layout!.align == 'center' ? col.layout!.position + col.layout!.width * 0.5
        : Debug.never(col.layout!.align);
    pos += col.layout!.width;
  }

  manager.setContentRect({
    r: pos + manager.scrollerSize,
    b: (totalLines + 1) * lineHeight + headerHeight + manager.scrollerSize
    // add 1 for virtual entry
  });
  Debug.trace(`layout done in ${performance.now() - startTime}ms`);
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
  for (const {entry, line, height: lh, texts} of lines) {
    i += 1;
    if ((line + lh) * lineHeight < sy) continue;
    if (line * lineHeight > sy + width) break;

    // background of selection
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
      cxt.fillRect(0, y, indexColumnLayout.width, h);
    }

    // texts
    const textFillStyle = 
      (entry !== focused 
        && focused instanceof SubtitleEntry 
        && overlappingTime(focused, entry)) ? overlapColor : textColor;
    cxt.strokeStyle = gridColor;
    let y0 = y;
    
    let j = 0;
    // lines; in the order of Source.subs.styles
    for (const {style, failed, height} of texts) {
      const xpos = channelColumns[0].layout!.position;
      
      // background for failed validation
      if (failed.length > 0) {
        cxt.fillStyle = errorBackground;
        cxt.fillRect(xpos, y0 + 1, width + sx - xpos, height * lineHeight - 2);
      }

      for (const col of channelColumns) {
        const value = Metrics[col.metric].stringValue(entry, style);
        let splitLines = value.split('\n');
        cxt.textBaseline = 'middle';
        cxt.textAlign = col.layout!.align;
        cxt.fillStyle = textFillStyle;
        splitLines.forEach((x, i) => 
          cxt.fillText(x, col.layout!.textX, y0 + (i + 0.5) * lineHeight));
      }

      // inner horizontal lines
      y0 += height * lineHeight;
      if (j != entry.texts.size - 1)
        drawLine(xpos, y0, width + sx, y0);
      j++;
    }

    // entry cells
    for (const col of entryColumns) {
      const value = Metrics[col.metric].stringValue(entry, Source.subs.defaultStyle);
      let splitLines = value.split('\n');
      cxt.textBaseline = 'middle';
      cxt.textAlign = col.layout!.align;
      cxt.fillStyle = textFillStyle;
      splitLines.forEach((line, i) => 
        cxt.fillText(line, col.layout!.textX, y + (i + 0.5) * lineHeight));
    }

    // index
    cxt.textAlign = 'end';
    cxt.fillStyle = textFillStyle;
    cxt.fillText(i.toString(), 
      indexColumnLayout.width - cellPadding, 
      y + 0.5 * lineHeight);

    // outer horizontal line
    cxt.strokeStyle = gridMajorColor;
    drawLine(0, y + h, width + sx, y + h);
  }

  if (i == lines.length) {
    // virtual entry
    const lastLine = lines.at(-1);
    const y = (lastLine 
        ? (lastLine.line + lastLine.height) * lineHeight 
        : 0) + headerHeight;
    if (focused == 'virtual') {
      cxt.fillStyle = focusBackground;
      cxt.fillRect(0, y, width + sx, lineHeight);
    }
    cxt.fillStyle = textColor;
    cxt.textBaseline = 'middle';
    cxt.textAlign = 'end';
    cxt.fillText(`*`, indexColumnLayout.width - cellPadding, y + lineHeight * 0.5);
  }

  // header
  cxt.fillStyle = headerBackground;
  if (manager.scroll[1] > 0) {
    cxt.shadowBlur = 10;
    cxt.shadowColor = '#333a';
  }
  cxt.fillRect(0, manager.scroll[1], sx + width, headerHeight);

  cxt.shadowColor = 'transparent';
  cxt.strokeStyle = gridMajorColor;
  drawLine(0, manager.scroll[1] + headerHeight, 
    width + sx, manager.scroll[1] + headerHeight);

  cxt.fillStyle = textColor;
  const cols = [indexColumnLayout, 
    ...entryColumns.map((x) => x.layout!), 
    ...channelColumns.map((x) => x.layout!)];
  for (const col of cols) {
    cxt.textBaseline = 'middle';
    cxt.textAlign = col.align;
    cxt.fillText(col.name, col.textX, sy + lineHeight * 0.5);
  }

  // vertical lines
  cxt.strokeStyle = gridMajorColor;
  const maxY = manager.contentRect.b;
  drawLine(indexColumnLayout.width, sy, 
    indexColumnLayout.width, 
    Math.min(sy + height, maxY - manager.scrollerSize));

  const bottom = Math.min(sy + height, maxY - lineHeight - manager.scrollerSize);
  cols.slice(1).map((x) => drawLine(x.position, sy, x.position, bottom));
}

const me = {};
onDestroy(() => EventHost.unbind(me));

Source.onSubtitleObjectReload.bind(me, () => {
  updateColumns();
});

Source.onSubtitlesChanged.bind(me, (t) => {
  // TODO: can we optimize this by not re-layouting everything on every edit?
  if (t == ChangeType.View) {
    // the only way columns are updated is through the subtitle table
    // updateColumns();
  } else if (t !== ChangeType.Metadata) {
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
    Debug.warn('?!row', ent, old);
    return;
  }
  const sy = (posNew.line - posOld.line) * lineHeight + manager.scroll[1];
  manager.setScroll({y: sy})
  Editing.onKeepEntryInView.dispatch(ent);
});

Editing.onKeepEntryInView.bind(me, (ent) => {
  // otherwise dragging outside/auto scrolling becomes unusable
  if (manager.dragType !== 'none') return;

  if (ent instanceof SubtitleEntry) {
    const pos = lineMap.get(ent);
    if (pos === undefined) {
      Debug.warn('?!row', ent);
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

function updateColumns() {
  entryColumns = Source.subs.view.perEntryColumns
    .map((x) => ({metric: x, layout: undefined}));
  channelColumns = Source.subs.view.perChannelColumns
    .map((x) => ({metric: x, layout: undefined}));
  requestedLayout = true;
  manager.requestRender();
}

function changeColumns() {
  Source.subs.view.perEntryColumns = entryColumns.map((x) => x.metric);
  Source.subs.view.perChannelColumns = channelColumns.map((x) => x.metric);
  Source.markChanged(ChangeType.View);
  requestedLayout = true;
  manager.requestRender();
}

onMount(() => {
  Debug.assert(canvas !== undefined);
  manager = new CanvasManager(canvas);
  manager.onDisplaySizeChanged.bind(me, (w, h) => {
    manager.requestRender();
  });
  manager.renderer = (ctx) => render(ctx);
  manager.canBeginDrag = (ev) => ev.offsetY > headerHeight / manager.scale;
  manager.onMouseMove.bind(me, onMouseMove);
  manager.onMouseDown.bind(me, onMouseDown);
  manager.onDrag.bind(me, onDrag);

  MainConfig.hook(
    () => [InterfaceConfig.data.fontSize, InterfaceConfig.data.fontFamily], 
    () => {
      requestedLayout = true;
      manager.requestRender();
    });

  MainConfig.hook(
    () => TableConfig.data.maxZoom, 
    (zoom) => {
      manager.setMaxZoom(zoom)
    });

  $effect(() => {
    if (theme.isDark !== undefined)
      manager.requestRender();
  });
});

function overlappingTime(e1: SubtitleEntry | null, e2: SubtitleEntry) {
  return e1 && e2 && e1.start < e2.end && e1.end > e2.start;
}

function onFocus() {
  Interface.uiFocus.set('Table');
}

let currentLine = -1;
let autoScrollY = 0;
let lastAnimateFrameTime = -1;

function getLineFromOffset(y: number) {
  return (y / manager.scale + manager.scroll[1] - headerHeight) / lineHeight;
}

let currentFails: SimpleMetricFilter[] = [];

function onMouseMove(ev: MouseEvent) {
  if (ev.offsetY < headerHeight / manager.scale) return;
  
  const [cx, cy] = manager.convertPosition('offset', 'canvas', ev.offsetX, ev.offsetY);
  const currentLine = Math.floor((cy - headerHeight) / lineHeight);

  let channelColumnStart = channelColumns[0].layout?.position ?? Infinity;
  let currentText: TextLayout | undefined;
  if (currentLine <= totalLines && cx > channelColumnStart) {
    outer: for (const {texts} of lines) {
      for (const text of texts) {
        if (currentLine < text.line)
          break outer;
        currentText = text;
      }
    }
  }

  if (currentText?.failed !== currentFails) {
    currentFails = currentText?.failed ?? [];
    if (validationMessagePopup.isOpen!()) validationMessagePopup.close!();
    if (currentFails.length > 0) {
      Debug.assert(currentText !== undefined);
      popupMessage = `${$_('table.requirement-not-met', {values: {n: currentFails.length}})}\n` 
        + currentFails.map(filterDescription).join('\n');
      let [left, top] = manager.convertPosition('canvas', 'client', 
        channelColumnStart, currentText.line * lineHeight + headerHeight);
      validationMessagePopup.open!({left, top, width: 0, 
        height: currentText.height * 0.5 * lineHeight / manager.scale});
    }
  }
}

function onMouseDown(ev: MouseEvent) {
  onFocus();
  // don't do anything if mouse is within header area
  if (ev.offsetY < headerHeight / manager.scale) return;

  if (ev.button == 0) {
    currentLine = getLineFromOffset(ev.offsetY);
    if (currentLine > totalLines) {
      Editing.selectVirtualEntry();
      return;
    } else if (lines.length > 0) {
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
    manager.setScroll({y: manager.scroll[1] + autoScrollY * (time - lastAnimateFrameTime) * 0.001})
    lastAnimateFrameTime = time;

    const line = getLineFromOffset((autoScrollY < 0) ? 0 : manager.size[1]);
    if (line != currentLine && lines.length > 0) {
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

function onDrag(_: number, offsetY: number) {
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

  const line = getLineFromOffset(offsetY);
  if (line != currentLine && lines.length > 0) {
    currentLine = line;
    let i = 1;
    for (; i < lines.length && lines[i].line < currentLine; i++);
    Editing.selectEntry(lines[i-1].entry, SelectMode.Sequence);
  }
}
</script>

<div class="container">
  <button onclick={(ev) => {
    const rect = ev.currentTarget.getBoundingClientRect();
    columnPopup.open!(rect);
  }} aria-label='edit'>
    <PenLineIcon />
  </button>
  <canvas bind:this={canvas}
    class:subsfocused={$uiFocus === 'Table'}
    ondblclick={async () => {
      onFocus();
      let focused = Editing.getFocusedEntry();
      Debug.assert(focused !== null);
      if (focused == 'virtual') {
        if (TableConfig.data.doubleClickStartEdit)
          Editing.startEditingNewVirtualEntry();
      } else {
        if (get(Playback.isLoaded)) switch (TableConfig.data.doubleClickPlaybackBehavior) {
          case 'none': break;
          case 'seek':
            Playback.setPosition(focused.start);
            break;
          case 'play':
            await Playback.forceSetPosition(focused.start);
            Playback.play(true);
            break;
          default:
            Debug.never(<never>TableConfig.data.doubleClickPlaybackBehavior);
        }
        if (TableConfig.data.doubleClickStartEdit)
          Editing.startEditingFocusedEntry();
      }
    }}
    oncontextmenu={(ev) => {
      onFocus();
      ev.preventDefault();
      Actions.contextMenu();
    }}
  ></canvas>
</div>

{#snippet metricList(opt: {list: Column[]}, category: MetricContext[])}
  <OrderableList list={opt.list} style='width: 100%' onsubmit={changeColumns}>
    {#snippet row(col, i)}
      <select bind:value={col.metric} onchange={changeColumns}>
        {#each MetricsList as [name, m]}
          {#if category.includes(m.context)
            && (!opt.list.some((x) => x.metric == name) || name == col.metric)}
            <option value={name}>{m.localizedName()}</option>
          {/if}
        {/each}
      </select>
      <button onclick={() => {
        opt.list.splice(i, 1);
        changeColumns();
      }} aria-label='delete'>
        <DeleteIcon />
      </button>
    {/snippet}
    {#snippet footer()}
    {@const used = new Set(opt.list.map((x) => x.metric))}
    {@const unused = MetricsList.filter(
        ([x, y]) => category.includes(y.context) && !used.has(x))}
      <button disabled={unused.length == 0} class="hlayout"
        onclick={async () =>
          (await Menu.new({items: unused.map(([x, y]) => ({
            text: y.localizedName(),
            action() {
              opt.list.push({ metric: x });
              changeColumns();
            }
          }))})).popup()}
      >
        <PlusIcon />
        {$_('table.add-column')}
      </button>
    {/snippet}
  </OrderableList>
{/snippet}

<Popup bind:handler={columnPopup} position="left">
  {#key $locale}
  <div class="form">
    <h5>
      {$_('table.edit-columns')}
    </h5>
    {@render metricList({list: entryColumns}, ['entry'])}
    <hr>
    {@render metricList({list: channelColumns}, ['style', 'channel'])}
  </div>
  {/key}
</Popup>

<Popup bind:handler={validationMessagePopup} position="left" style='tooltip'>
  <span style="white-space: pre-wrap;">
    {popupMessage}
  </span>
</Popup>

<style>
  @media (prefers-color-scheme: dark) {
    .container button {
      background-color: var(--uchu-yin-5);
    }
  }

  .form {
    display: flex;
    flex-direction: column;
    text-align: start;
  }
  .form h5 {
    padding-top: 0;
  }
  .form select {
    flex-grow: 1;
    min-width: 80px;
    vertical-align: middle;
  }
  .form hr {
    border-bottom: 1px solid gray;
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
