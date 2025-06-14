import type { CanvasManager } from "../../CanvasManager";
import { Playback } from "../../frontend/Playback";
import { LabelColor, theme } from "../../Theming.svelte";
import { TimelineLayout } from "./Layout";
import { InterfaceConfig, MainConfig } from "../../config/Groups";
import { Basic } from "../../Basic";
import { TimelineConfig } from "./Config";
import type { TimelineInput } from "./Input.svelte";
import { hook } from "../../details/Hook.svelte";

const HEADER_BACK       = $derived(theme.isDark ? 'hsl(0deg 0% 20%/50%)' : 'hsl(0deg 0% 75%/50%)');
const TICK_COLOR        = $derived(theme.isDark ? 'white' : 'gray');
const LINE_BIG_COLOR    = $derived(theme.isDark ? 'hsl(0deg 0% 60%)' : 'hsl(0deg 0% 40%)');
const LINE_MED_COLOR    = $derived(theme.isDark ? 'hsl(0deg 0% 30%)' : 'hsl(0deg 0% 70%)');
const RULER_TEXT        = $derived(theme.isDark ? 'white' : 'hsl(0deg 0% 20%)');
const TRACK_LINE_COLOR  = $derived(theme.isDark ? '#ccc5' : '#aaa5');

const LEFT_COLUMN_BACK      = $derived(theme.isDark ? '#333' : '#d3d3d3');
const LEFT_COLUMN_SELECTED  = $derived(theme.isDark ? '#555' : '#bbb');
const LEFT_COLUMN_SHADOW    = $derived(theme.isDark ? '#eeea' : '#333a');
const LEFT_COLUMN_OUTLINE   = $derived(theme.isDark ? '#555' : '#888');
const LEFT_COLUMN_SEPARATOR = $derived(theme.isDark ? '#444' : '#aaa');
const LEFT_COLUMN_TEXT      = $derived(theme.isDark ? '#fff' : '#000');
const SELECTED_TRACK_BACK   = $derived(theme.isDark ? '#aaa5' : '#ddd5');

const ENTRY_WIDTH = 1;
const ENTRY_WIDTH_FOCUS = 2;
const ENTRY_BACK_OPACITY = 0.45;
const ENTRY_BACK = 
  $derived(theme.isDark ? 'hsl(0deg 0% 20%/45%)' : 'hsl(0deg 0% 85%/45%)');
const ENTRY_BORDER          = $derived(theme.isDark ? 'hsl(0deg 0% 60%)' : 'hsl(0deg 0% 80%)');
const ENTRY_BORDER_FOCUS    = $derived(theme.isDark ? 'goldenrod' : 'oklch(70.94% 0.136 258.06)');
const ENTRY_TEXT            = $derived(theme.isDark ? 'hsl(0deg 0% 90%)' : 'hsl(0deg 0% 20%)');
const ENTRY_TEXT_SPLITTING  = $derived(theme.isDark ? 'goldenrod' : 'tomato');
const ENTRY_TEXT_FADE       = $derived(theme.isDark ? '#0000' : '#FFF0');
const INOUT_TEXT            = $derived(theme.isDark ? 'lightgreen' : 'oklch(52.77% 0.138 145.41)');

const CURSOR_COLOR = 
  $derived(theme.isDark ? 'pink' : 'oklch(62.73% 0.209 12.37)');
const PENDING_WAVEFORM_COLOR = 
  $derived(theme.isDark ? `rgb(100% 10% 10% / 30%)` : `rgb(100% 40% 40% / 40%)`);
const WAVEFORM_COLOR = 
  $derived(theme.isDark ? `#5bb` : 'oklch(76.37% 0.101 355.37)');
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

export class TimelineRenderer {
  private readonly manager: CanvasManager;

  constructor(private layout: TimelineLayout, private input: TimelineInput) {
    this.manager = layout.manager;
    this.manager.renderer = (ctx) => this.#render(ctx);

    MainConfig.hook(
      () => theme.isDark, 
      () => this.manager.requestRender());

    hook(
      () => Playback.playArea.setting, 
      () => this.manager.requestRender());
  }

  #render(ctx: CanvasRenderingContext2D) {
    if (this.layout.requestedLayout)
      this.layout.layout(ctx);

    const t0 = Date.now();
  
    this.#renderWaveform(ctx);
    this.#renderRuler(ctx);
    this.#renderTracks(ctx);
    this.#renderCursor(ctx);
    this.#renderLeftColumn(ctx);
    
    if (!TimelineConfig.data.showDebug) return;
    ctx.translate(this.manager.scroll[0], 0);
    const x = this.layout.width - 5;
    const y = this.layout.height - 5;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';
    ctx.font = `8px Courier, monospace`;
    ctx.fillStyle = theme.isDark ? 'white' : 'black';
    ctx.fillText(`off=${this.layout.offset.toFixed(2).padEnd(6)}`, x, y);
    ctx.fillText(`rt=${(Date.now() - t0).toFixed(1).padEnd(5)}`, x - 80, y);
    ctx.fillText(`scale=${this.layout.scale.toFixed(2).padEnd(6)}`, x, y - 10);
    ctx.fillText(`dpr=${devicePixelRatio.toString().padEnd(5)}`, x - 80, y - 10);
    ctx.fillText(`lcw=${this.layout.leftColumnWidth.toFixed(2).padEnd(6)}`, x, y - 20);
  }

  #drawAggregation<T extends Float32Array | Uint8Array>(
    resolution: number,
    tree: (level: number, from: number, to: number) => T,
    handler: (x: number, width: number, value: number) => void
  ) {
    const pointsPerPixel = Math.max(1, 
      Math.floor(resolution / this.layout.scale / devicePixelRatio));
    const step = 2 ** Math.floor(Math.log2(pointsPerPixel));
    
    const start = Math.max(0, Math.floor(this.layout.offset * resolution / step));
    const end = Math.ceil(
      (this.layout.offset + this.layout.width / this.layout.scale) * resolution / step);
    const data = tree(step, start, end);

    const width_v = 1 / resolution * this.layout.scale * step;
    const drawWidth = Math.max(1 / devicePixelRatio, width_v);

    for (let i = 0; i < data.length; i++) {
      const x = (i + start) * width_v + this.layout.leftColumnWidth;
      handler(x, drawWidth, data[i]);
    }
    return { 
      drawStart: start * width_v + this.layout.leftColumnWidth, 
      drawEnd: (start + data.length - 1) * width_v + this.layout.leftColumnWidth, 
      step
    };
  }

  #renderWaveform(ctx: CanvasRenderingContext2D) {
    if (!Playback.sampler) return;

    const yscroll = this.manager.scroll[1];
    let points: {x: number, y: number}[] = [];
    let lastGap = -1;
    ctx.fillStyle = PENDING_WAVEFORM_COLOR;
    let {drawStart, drawEnd} = this.#drawAggregation(
      Playback.sampler.intensityResolution, 
      (a, b, c) => Playback.sampler!.intensity.get(a, b, c),
      (x, _, value) => {
        if (isNaN(value)) {
          if (lastGap < 0) lastGap = x;
          this.layout.requestedSampler = true;
          points.push({x, y: 0});
        } else {
          if (lastGap >= 0) {
            ctx.fillRect(lastGap, yscroll, x - lastGap, this.layout.height);
            lastGap = -1;
          }
          points.push({x, y: 
            value * (this.layout.height - TimelineLayout.HEADER_HEIGHT) / 2});
        }
      });
    if (lastGap >= 0)
      ctx.fillRect(lastGap, yscroll, drawEnd - lastGap, this.layout.height);

    const baseline = 
      (this.layout.height - TimelineLayout.HEADER_HEIGHT) / 2 + TimelineLayout.HEADER_HEIGHT;
    ctx.beginPath();
    ctx.moveTo(drawStart, baseline);
    points.forEach(
      ({x, y}) => ctx.lineTo(x, baseline + 0.5 / devicePixelRatio + y + yscroll));
    ctx.lineTo(drawEnd, baseline);
    points.reverse().forEach(
      ({x, y}) => ctx.lineTo(x, baseline - 0.5 / devicePixelRatio - y + yscroll));
    ctx.closePath();
    ctx.fillStyle = WAVEFORM_COLOR;
    ctx.fill();

    lastGap = -1;
    this.#drawAggregation(
      Playback.sampler.keyframeResolution,
      (a, b, c) => Playback.sampler!.keyframes.get(a, b, c),
      (x, width, value) => {
        if (value == 0) {
          if (lastGap < 0) lastGap = x;
          // this.layout.requestedSampler = true;
        } else {
          if (lastGap >= 0) {
            ctx.fillStyle = "#6D66";
            ctx.fillRect(lastGap, yscroll, x - lastGap, this.layout.height);
            lastGap = -1;
          }
          if (value == 2) {
            ctx.fillStyle = "#66E6";
            ctx.fillRect(x, yscroll, width, this.layout.height);
          }
        }
      }
    );
  
    if (this.layout.requestedSampler)
      this.layout.processSampler();
  }

  #renderRuler(ctx: CanvasRenderingContext2D) {
    const y = this.manager.scroll[1];

    const line = (pos: number, height: number) => {
      ctx.beginPath();
      ctx.moveTo(pos, y);
      ctx.lineTo(pos, y + height);
      ctx.stroke();
    };
    const [small, nMed, nBig] = getTick(this.layout.scale);
    const start = Math.floor(this.layout.offset / small / nBig) * small * nBig, 
          end = this.layout.offset + this.layout.width / this.layout.scale;
    const n = Math.ceil((end - start) / small);
    ctx.fillStyle = HEADER_BACK;
    ctx.fillRect(
      this.manager.scroll[0], y, 
      this.layout.width, TimelineLayout.HEADER_HEIGHT);

    ctx.lineWidth = 0.5;
    for (let i = 0; i < n; i++) {
      const t = start + i * small;
      const pos = t * this.layout.scale + this.layout.leftColumnWidth;
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
    ctx.textAlign = 'start';
    for (let t = start; t < end; t += nBig * small) {
      ctx.fillText(Basic.formatTimestamp(t, 2), 
        Math.round(t * this.layout.scale + this.layout.leftColumnWidth) + 5, 
        y + TimelineLayout.HEADER_HEIGHT);
    }
  }

  #renderTracks(ctx: CanvasRenderingContext2D) {
    let y = TimelineLayout.HEADER_HEIGHT + TimelineLayout.TRACKS_PADDING;
    for (const s of this.layout.shownStyles) {
      if (this.input.activeChannel == s) {
        ctx.fillStyle = SELECTED_TRACK_BACK;
        ctx.fillRect(this.manager.scroll[0], y, 
          this.layout.width, 
          this.layout.entryHeight);
      }
      y += this.layout.entryHeight;
    }

    ctx.strokeStyle = TRACK_LINE_COLOR;
    ctx.beginPath();
    for (let i = 0; i <= this.layout.shownStyles.length; i++) {
      const y = i * this.layout.entryHeight 
        + TimelineLayout.HEADER_HEIGHT + TimelineLayout.TRACKS_PADDING;
      ctx.moveTo(this.manager.scroll[0], y);
      ctx.lineTo(this.manager.scroll[0] + this.layout.width, y);
    }
    ctx.stroke();

    ctx.textAlign = 'start';
    ctx.textBaseline = 'top';
    const ctxfont = font(TimelineConfig.data.fontSize);
    ctx.font = ctxfont;
    for (const ent of this.layout.getVisibleEntries()) {
      const boxes = this.layout.getEntryPositions(ent);
      if (boxes.length == 0) continue;
      const grad = ctx.createLinearGradient(
        boxes[0].x + boxes[0].w - 15, boxes[0].y, boxes[0].x + boxes[0].w, boxes[0].y);
      grad.addColorStop(0, ENTRY_TEXT);
      grad.addColorStop(1, ENTRY_TEXT_FADE);
      for (const b of boxes) {
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
        const path = new Path2D();
        path.roundRect(b.x, b.y, b.w, b.h, 4);
        ctx.fill(path);
        ctx.stroke(path);

        if (b.w < 15)
          continue;
        ctx.save();
        ctx.clip(path);

        ctx.strokeStyle = ALIGNLINE_COLOR;
        ctx.lineWidth = 2;
        const split = this.input.splitting;
        if (split?.target == ent && split.positions.has(b.style)) {
          const pos = split.positions.get(b.style);
          const separator = (split.breakPosition - ent.start) / (ent.end - ent.start) * b.w;
          const text1 = b.text.substring(0, pos);
          const text2 = b.text.substring(pos!);
          const color = split.current == b.style ? ENTRY_TEXT_SPLITTING : ENTRY_TEXT;
          const grad = ctx.createLinearGradient(b.x, b.y, b.x + b.w, b.y);
          grad.addColorStop(0, ENTRY_TEXT_FADE);
          grad.addColorStop(Math.min(1, 15 / b.w), color);
          grad.addColorStop(Math.max(0, 1 - 15 / b.w), color);
          grad.addColorStop(1, ENTRY_TEXT_FADE);
          ctx.fillStyle = grad;
          ctx.textAlign = 'end';
          ctx.fillText(text1, b.x + separator - 2, b.y + 4);
          ctx.textAlign = 'start';
          ctx.fillText(text2, b.x + separator + 2, b.y + 4);
          ctx.beginPath();
          ctx.moveTo(b.x + separator, b.y + 4);
          ctx.lineTo(b.x + separator, b.y + this.layout.entryHeight - 4);
          ctx.stroke();
        } else {
          ctx.fillStyle = grad;
          ctx.fillText(b.text, b.x + 4, b.y + 4);
        }
        ctx.restore();
      };
    }
  }

  #renderCursor(ctx: CanvasRenderingContext2D) {
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
      const x = alignmentLine.pos * this.layout.scale + this.layout.leftColumnWidth;
      ctx.strokeStyle = ALIGNLINE_COLOR;
      ctx.lineWidth = ALIGNLINE_WIDTH;
      ctx.beginPath();

      for (const row of alignmentLine.rows) {
        const y1 = TimelineLayout.HEADER_HEIGHT 
          + TimelineLayout.TRACKS_PADDING + this.layout.entryHeight * row;
        const y2 = y1 + this.layout.entryHeight;

        if (!alignmentLine.rows.has(row - 1)) {
          ctx.moveTo(x - 5, y1 - 5);
          ctx.lineTo(x, y1);
          ctx.lineTo(x + 5, y1 - 5);
        }
        if (!alignmentLine.rows.has(row + 1)) {
          ctx.moveTo(x - 5, y2 + 5);
          ctx.lineTo(x, y2);
          ctx.lineTo(x + 5, y2 + 5);
        }
      }
  
      ctx.moveTo(x, TimelineLayout.HEADER_HEIGHT);
      ctx.lineTo(x, this.layout.height);
      ctx.stroke();
    }
  
    const x = Playback.position * this.layout.scale + this.layout.leftColumnWidth;
    const y = this.manager.scroll[1];
    ctx.fillStyle = CURSOR_COLOR;
    ctx.beginPath();
    ctx.moveTo(x + 4, y);
    ctx.lineTo(x - 4, y);
    ctx.lineTo(x - 1, y + 10);
    ctx.lineTo(x - 1, y + this.layout.height);
    ctx.lineTo(x + 1, y + this.layout.height);
    ctx.lineTo(x + 1, y + 10);
    ctx.lineTo(x + 4, y);
    ctx.fill();
  
    // In-out area. Only display the setting, not override value
    const area = Playback.playArea.setting;
    const scrollX = this.manager.scroll[0];
    if (area.start !== undefined) {
      const start = area.start * this.layout.scale;
      ctx.fillStyle = INOUT_AREA_OUTSIDE;
      ctx.fillRect(scrollX, 0, 
        start + this.layout.leftColumnWidth - scrollX, 
        this.layout.height);
    }
    if (area.end !== undefined) {
      const end = area.end * this.layout.scale;
      ctx.fillStyle = INOUT_AREA_OUTSIDE;
      ctx.fillRect(end + this.layout.leftColumnWidth, 0, 
        this.layout.width + scrollX - end, 
        this.layout.height);
    }

    ctx.font = 'bold ' + font(TimelineConfig.data.fontSize);
    ctx.fillStyle = INOUT_TEXT;
    ctx.textBaseline = 'top';
    const status = (area.start === undefined ? '' : 'IN ')
                 + (area.end === undefined ? '' : 'OUT ')
                 + (area.loop ? 'LOOP ' : '');
    const statusWidth = ctx.measureText(status).width;
    ctx.fillText(status, 
      this.layout.width - statusWidth - 5 + this.manager.scroll[0], 
      TimelineLayout.HEADER_HEIGHT + 5);
  }

  #renderLeftColumn(ctx: CanvasRenderingContext2D) {
    const [x, y] = this.manager.convertPosition('offset', 'canvas', 0, 0);
    ctx.fillStyle = LEFT_COLUMN_BACK;
    if (this.layout.offset > 0) {
      ctx.shadowBlur = 10;
      ctx.shadowColor = LEFT_COLUMN_SHADOW;
    } else {
      ctx.shadowColor = 'transparent';
    }
    ctx.fillRect(x, y, 
      this.layout.leftColumnWidth, 
      this.layout.height);
    ctx.shadowColor = 'transparent';

    ctx.strokeStyle = LEFT_COLUMN_OUTLINE;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x + this.layout.leftColumnWidth, y);
    ctx.lineTo(x + this.layout.leftColumnWidth, y + this.layout.height);
    ctx.stroke();
    
    let y1 = TimelineLayout.HEADER_HEIGHT 
           + TimelineLayout.TRACKS_PADDING;
    ctx.font = font(TimelineConfig.data.fontSize);
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'end';
    for (const s of this.layout.shownStyles) {
      if (this.input.activeChannel == s) {
        ctx.fillStyle = LEFT_COLUMN_SELECTED;
        ctx.fillRect(x, y1, 
          this.layout.leftColumnWidth, 
          this.layout.entryHeight);
      }
      ctx.fillStyle = LEFT_COLUMN_TEXT;
      ctx.fillText(s.name, 
        x + this.layout.leftColumnWidth - TimelineLayout.LEFT_COLUMN_MARGIN, 
        y1 + this.layout.entryHeight * 0.5);
      y1 += this.layout.entryHeight;
    }

    ctx.strokeStyle = LEFT_COLUMN_SEPARATOR;
    ctx.beginPath();
    for (let i = 0; i <= this.layout.shownStyles.length; i++) {
      const y = i * this.layout.entryHeight 
        + TimelineLayout.HEADER_HEIGHT + TimelineLayout.TRACKS_PADDING;
      ctx.moveTo(x, y);
      ctx.lineTo(x + this.layout.leftColumnWidth, y);
    }
    ctx.stroke();
  }
}