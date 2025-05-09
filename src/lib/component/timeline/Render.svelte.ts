import { get } from "svelte/store";
import type { CanvasManager } from "../../CanvasManager";
import { Playback } from "../../frontend/Playback";
import { LabelColor, theme } from "../../Theming.svelte";
import { TimelineLayout } from "./Layout";
import { InterfaceConfig, MainConfig } from "../../config/Groups";
import { Basic } from "../../Basic";
import { TimelineConfig } from "./Config";
import type { TimelineInput } from "./Input";

const HEADER_BACK       = $derived(theme.isDark ? 'hsl(0deg 0% 20%)' : 'hsl(0deg 0% 85%)');
const TICK_COLOR        = $derived(theme.isDark ? 'white' : 'gray');
const LINE_BIG_COLOR    = $derived(theme.isDark ? 'hsl(0deg 0% 60%)' : 'hsl(0deg 0% 40%)');
const LINE_MED_COLOR    = $derived(theme.isDark ? 'hsl(0deg 0% 30%)' : 'hsl(0deg 0% 70%)');
const RULER_TEXT        = $derived(theme.isDark ? 'white' : 'hsl(0deg 0% 20%)');

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

function font(size: number) {
  return `${size}px ${InterfaceConfig.data.fontFamily}`;
}

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

export class TimelineRenderer {
  private readonly manager: CanvasManager;

  constructor(private layout: TimelineLayout, private input: TimelineInput) {
    this.manager = layout.manager;
    this.manager.renderer = (ctx) => this.#render(ctx);

    MainConfig.hook(
      () => InterfaceConfig.data.theme, 
      () => this.manager.requestRender());
    Playback.playArea.subscribe(() => this.manager.requestRender());
  }

  #render(ctx: CanvasRenderingContext2D) {
    const t0 = Date.now();
  
    this.#renderRuler(ctx);
    this.#renderWaveform(ctx);
    this.#renderTracks(ctx);
    this.#renderCursor(ctx);
  
    ctx.font = 'bold ' + font(TimelineConfig.data.fontSize);
    ctx.fillStyle = INOUT_TEXT;
    ctx.textBaseline = 'top';
    const area = get(Playback.playArea);
    const status = (area.start === undefined ? '' : 'IN ')
                 + (area.end === undefined ? '' : 'OUT ')
                 + (area.loop ? 'LOOP ' : '');
    const statusWidth = ctx.measureText(status).width;
    ctx.fillText(status, 
      this.layout.width - statusWidth - 5 + this.manager.scroll[0], 
      TimelineLayout.HEADER_HEIGHT + 5);
    
    if (!TimelineConfig.data.showDebug) return;
    ctx.translate(this.manager.scroll[0], 0);
    ctx.font = `8px Courier, monospace`;
    ctx.fillStyle = theme.isDark ? 'white' : 'black';
    ctx.fillText(`offset=${this.layout.offset.toFixed(2)}`, 5, 15);
    ctx.fillText(`scale=${this.layout.scale.toFixed(2)}`, 5, 25);
    ctx.fillText(`render time=${(Date.now() - t0).toFixed(1)}`, 80, 15);
    ctx.fillText(`dpr=${devicePixelRatio}`, 80, 25);
  }

  #renderWaveform(ctx: CanvasRenderingContext2D) {
    if (!this.layout.sampler) return;
  
    const resolution = this.layout.sampler.resolution;
    const pointsPerPixel = Math.max(1, 
      Math.floor(resolution / this.layout.scale / devicePixelRatio));
    const step = 2 ** Math.floor(Math.log2(pointsPerPixel));
    const data = this.layout.sampler.data.getLevel(step);
    
    const start = Math.max(0, Math.floor(this.layout.offset * resolution / step));
    const end = Math.min(
      Math.ceil((this.layout.offset + this.layout.width / this.layout.scale) * resolution / step),
      data.length - 1);
    const width_v = 1 / resolution * this.layout.scale * step;
    const drawWidth = Math.max(1 / devicePixelRatio, width_v);
  
    let points: {x: number, y: number}[] = [];
    ctx.fillStyle = PENDING_WAVEFORM_COLOR;
    for (let i = start; i < end; i++) {
      const detail = this.layout.sampler.detail[i * step];
      const x = i * width_v;
  
      if (detail == 0) {
        ctx.fillRect(x, 0, drawWidth, this.layout.height);
        this.layout.requestedSampler = true;
      }
  
      let value = detail == 0 
        ? 0 
        : data[i] * (this.layout.height - TimelineLayout.HEADER_HEIGHT);
      const point = {x, y: value / 2};
      points.push(point);
    }
    const baseline = 
      (this.layout.height - TimelineLayout.HEADER_HEIGHT) / 2 + TimelineLayout.HEADER_HEIGHT;
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
      ctx.fillText(`using step=${step}`, this.manager.scroll[0] + 120, 35);
    }
  
    if (this.layout.requestedSampler) this.layout.processSampler();
  }

  #renderRuler(ctx: CanvasRenderingContext2D) {
    const line = (pos: number, height: number) => {
      ctx.beginPath();
      ctx.moveTo(pos, 0);
      ctx.lineTo(pos, height);
      ctx.stroke();
    };
    const [small, nMed, nBig] = getTick(this.layout.scale);
    const start = Math.floor(this.layout.offset / small / nBig) * small * nBig, 
          end = this.layout.offset + this.layout.width / this.layout.scale;
    const n = Math.ceil((end - start) / small);
    ctx.fillStyle = HEADER_BACK;
    ctx.fillRect(this.manager.scroll[0], 0, this.layout.width, TimelineLayout.HEADER_HEIGHT);

    ctx.lineWidth = 0.5;
    for (let i = 0; i < n; i++) {
      const t = start + i * small;
      const pos = t * this.layout.scale;
      let tickHeight;
      if (i % nBig == 0) {
        tickHeight = TimelineLayout.HEADER_HEIGHT;
        ctx.strokeStyle = LINE_BIG_COLOR;
        line(pos, this.layout.height);
      } else if (i % nMed == 0) {
        tickHeight = TimelineLayout.HEADER_HEIGHT * 0.5;
        ctx.strokeStyle = LINE_MED_COLOR;
        line(pos, this.layout.height);
      } else {
        tickHeight = TimelineLayout.HEADER_HEIGHT * 0.2;
      }
      ctx.strokeStyle = TICK_COLOR;
      line(pos, tickHeight);
    }

    ctx.fillStyle = RULER_TEXT;
    ctx.font = font(TimelineLayout.HEADER_HEIGHT * 0.8);
    ctx.textBaseline = 'bottom';
    for (let t = start; t < end; t += nBig * small) {
      const pos = Math.round(t * this.layout.scale);
      ctx.fillText(Basic.formatTimestamp(t, 2), pos + 5, TimelineLayout.HEADER_HEIGHT);
    }
  }

  #renderTracks(ctx: CanvasRenderingContext2D) {
    ellipsisWidth = -1;
    ctx.textBaseline = 'top';
    ctx.font = font(TimelineConfig.data.fontSize);
    for (let ent of this.layout.getVisibleEntries()) {
      this.layout.getEntryPositions(ent).forEach((b) => {
        ctx.fillStyle = ent.label === 'none' 
          ? ENTRY_BACK 
          : LabelColor(ent.label, ENTRY_BACK_OPACITY);
        if (this.input.selection.has(ent)) {
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

  #renderCursor(ctx: CanvasRenderingContext2D) {
    let pos = Playback.position * this.layout.scale;
    const selectBox = this.input.selectBox;
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
    const alignmentLine = this.input.alignmentLine;
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
  
      ctx.moveTo(alignmentLine.x, TimelineLayout.HEADER_HEIGHT);
      ctx.lineTo(alignmentLine.x, this.layout.height);
      ctx.stroke();
    }
  
    // In-out area
    const area = get(Playback.playArea);
    const scrollX = this.manager.scroll[0];
    if (area.start !== undefined) {
      const start = area.start * this.layout.scale;
      ctx.fillStyle = INOUT_AREA_OUTSIDE;
      ctx.fillRect(scrollX, 0, start - scrollX, this.layout.height);
    }
    if (area.end !== undefined) {
      const end = area.end * this.layout.scale;
      ctx.fillStyle = INOUT_AREA_OUTSIDE;
      ctx.fillRect(end, 0, this.layout.width + scrollX - end, this.layout.height);
    }
  
    ctx.fillStyle = CURSOR_COLOR;
    ctx.beginPath();
    ctx.moveTo(pos + 4, 0);
    ctx.lineTo(pos - 4, 0);
    ctx.lineTo(pos - 1, 10);
    ctx.lineTo(pos - 1, this.layout.height);
    ctx.lineTo(pos + 1, this.layout.height);
    ctx.lineTo(pos + 1, 10);
    ctx.lineTo(pos + 4, 0);
    ctx.fill();
  }
}