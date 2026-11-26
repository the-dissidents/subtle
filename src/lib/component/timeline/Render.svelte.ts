import type { CanvasManager } from "../../CanvasManager";
import { Playback } from "../../frontend/Playback";
import { LabelColor, theme } from "../../Theming.svelte";
import { TimelineLayout } from "./Layout";
import { InterfaceConfig, MainConfig } from "../../config/Groups";
import { Basic } from "../../Basic";
import { TimelineConfig } from "./Config";
import { type TimelineInput } from "./Input.svelte";
import { hook } from "../../details/Hook.svelte";
import { Source } from "../../frontend/Source";
import { Editing } from "$lib/frontend/Editing";

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
const KEYFRAME_COLOR =
	$derived(theme.isDark ? `rgb(10% 40% 100% / 30%)` : `rgb(40% 40% 100% / 40%)`);
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

export class TimelineRenderer {
	private readonly manager: CanvasManager;
	#waveX = new Float32Array(0);
	#waveY = new Float32Array(0);
	#textWidthCache = new Map<string, number>();
	#cachedTextFont = '';

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

	#measureTextWidth(ctx: CanvasRenderingContext2D, text: string, ctxfont: string): number {
		if (this.#cachedTextFont !== ctxfont) {
			this.#cachedTextFont = ctxfont;
			this.#textWidthCache.clear();
		}
		let w = this.#textWidthCache.get(text);
		if (w === undefined) {
			w = ctx.measureText(text).width;
			if (this.#textWidthCache.size > 4000)
				this.#textWidthCache.clear();
			this.#textWidthCache.set(text, w);
		}
		return w;
	}

	async #render(ctx: CanvasRenderingContext2D) {
		if (this.layout.requestedLayout)
			await this.layout.layout(ctx);

		const t0 = performance.now();

		const minScale = Math.max(this.layout.width / this.layout.positionSpan, 0.15);
		if (this.layout.scale < minScale || this.layout.scale > 500)
			await this.layout.setScale(this.layout.scale);
		this.#renderWaveform(ctx);
		this.#renderRuler(ctx);
		this.#renderTracks(ctx);
		this.#renderCursor(ctx);
		this.#renderLeftColumn(ctx);

		if (!TimelineConfig.data.showDebug) return;

		ctx.translate(...this.manager.scroll);
		const x = this.layout.width - 5;
		const y = this.layout.height - 5;
		ctx.textAlign = 'right';
		ctx.textBaseline = 'bottom';
		ctx.font = `8px Courier, monospace`;
		ctx.fillStyle = theme.isDark ? 'white' : 'black';
		ctx.fillText(`off=${this.layout.offset.toFixed(2).padEnd(6)}`, x, y);
		ctx.fillText(`rt=${(performance.now() - t0).toFixed(1).padEnd(5)}`, x - 80, y);
		ctx.fillText(`scale=${this.layout.scale.toFixed(2).padEnd(6)}`, x, y - 10);
		ctx.fillText(`dpr=${devicePixelRatio.toString().padEnd(5)}`, x - 80, y - 10);
		ctx.fillText(`lcw=${this.layout.leftColumnWidth.toFixed(2).padEnd(6)}`, x, y - 20);

		if (Playback.sampler?.isSampling) {
			const s = Playback.sampler;
			const x1 = this.layout.width - 105;
			const x2 = this.layout.width - 5;
			const y = this.layout.height - 40;
			const prog = (s.sampleProgress - s.sampleStart) / (s.sampleEnd - s.sampleStart);
			const middle = Math.max(x1, x1 * (1 - prog) + x2 * prog);
			ctx.lineWidth = 2;

			ctx.beginPath();
			ctx.moveTo(x1, y);
			ctx.lineTo(middle, y);
			ctx.strokeStyle = 'red';
			ctx.stroke();

			ctx.beginPath();
			ctx.moveTo(middle, y);
			ctx.lineTo(x2, y);
			ctx.strokeStyle = 'blue';
			ctx.stroke();

			ctx.textAlign = 'left';
			ctx.fillText(`${s.sampleStart.toFixed(2)}`, x1, y - 5);
			ctx.textAlign = 'right';
			ctx.fillText(`${s.sampleEnd.toFixed(2)}`, x2, y - 5);
		}
	}

	#renderWaveform(ctx: CanvasRenderingContext2D) {
		if (!Playback.sampler) return;

		const sampler = Playback.sampler;
		const yscroll = this.manager.scroll[1];
		const resolution = sampler.intensityResolution;
		const pointsPerPixel = Math.max(1,
			Math.floor(resolution / this.layout.scale / devicePixelRatio));
		const step = 2 ** Math.floor(Math.log2(pointsPerPixel));

		const start = Math.max(0, Math.floor(
			(this.layout.offset - this.layout.minPosition)
				* resolution / step));
		const end = Math.ceil(
			(this.layout.offset - this.layout.minPosition + this.layout.width / this.layout.scale)
				* resolution / step);
		const data = sampler.intensityData(step, start, end);

		const widthV = step / resolution * this.layout.scale;
		const offset = this.layout.leftColumnWidth + this.layout.minPosition * this.layout.scale;
		const drawWidth = Math.max(1 / devicePixelRatio, widthV);
		const drawStart = start * widthV + offset;
		const drawEnd = end * widthV + offset;
		const halfTrackH = (this.layout.height - TimelineLayout.HEADER_HEIGHT) / 2;
		const baseline = halfTrackH + TimelineLayout.HEADER_HEIGHT + yscroll;
		const halfPixel = 0.5 / devicePixelRatio;

		// Pending waveform gaps
		let lastGap = -1;
		ctx.fillStyle = PENDING_WAVEFORM_COLOR;
		for (let i = 0; i < data.length; i++) {
			const x = (i + start) * widthV + offset;
			if (isNaN(data[i])) {
				if (lastGap < 0) lastGap = x;
				this.layout.requestedSampler = true;
			} else if (lastGap >= 0) {
				ctx.fillRect(lastGap, yscroll, x - lastGap, this.layout.height);
				lastGap = -1;
			}
		}
		if (lastGap >= 0)
			ctx.fillRect(lastGap, yscroll, drawEnd - lastGap, this.layout.height);

		// Waveform fill: batch vertical rects when dense, or TypedArray polygon when zoomed in
		ctx.fillStyle = WAVEFORM_COLOR;
		ctx.beginPath();
		if (drawWidth <= 2) {
			for (let i = 0; i < data.length; i++) {
				const v = data[i];
				if (isNaN(v)) continue;
				const halfH = v * halfTrackH + halfPixel;
				ctx.rect((i + start) * widthV + offset, baseline - halfH, drawWidth, halfH * 2);
			}
		} else if (data.length > 0) {
			if (this.#waveX.length < data.length) {
				this.#waveX = new Float32Array(data.length);
				this.#waveY = new Float32Array(data.length);
			}
			const wx = this.#waveX;
			const wy = this.#waveY;
			for (let i = 0; i < data.length; i++) {
				wx[i] = (i + start) * widthV + offset;
				const v = data[i];
				wy[i] = isNaN(v) ? 0 : v * halfTrackH;
			}
			ctx.moveTo(drawStart, baseline);
			for (let i = 0; i < data.length; i++)
				ctx.lineTo(wx[i], baseline + halfPixel + wy[i]);
			ctx.lineTo(drawEnd, baseline);
			for (let i = data.length - 1; i >= 0; i--)
				ctx.lineTo(wx[i], baseline - halfPixel - wy[i]);
			ctx.closePath();
		}
		ctx.fill();

		if (TimelineConfig.data.showKeyframes
		 && this.layout.scale * devicePixelRatio / sampler.keyframeResolution > 1)
		{
			const viewLeft = this.layout.offset;
			const viewRight = viewLeft + this.layout.width / this.layout.scale;
			const keyframes = sampler.keyframesInRange(viewLeft, viewRight);
			if (keyframes.length > 0) {
				ctx.fillStyle = KEYFRAME_COLOR;
				for (const kf of keyframes) {
					ctx.fillRect(
						kf * this.layout.scale + this.layout.leftColumnWidth, yscroll,
						2, this.layout.height);
				}
			}
		}

		if (this.layout.requestedSampler)
			this.layout.scheduleSampler();
	}

	#getTick(scale: number): [small: number, nMed: number, nBig: number] {
		const UNITS = Playback.player
			? [1 / Playback.player.frameRate, 1, 1, 10, 60, 600, 3600]
			: [0.05, 0.1, 1, 10, 60, 600, 3600];
		for (let i = 0; i <= UNITS.length - 3; i++)
			if (scale * UNITS[i+2] > 170 / devicePixelRatio) return [
				UNITS[i],
				UNITS[i+1],
				UNITS[i+2]];
		return [60, 10, 60];
	}

	#renderRuler(ctx: CanvasRenderingContext2D) {
		const y = this.manager.scroll[1];
		const [small, medium, big] = this.#getTick(this.layout.scale);
		const end = this.layout.offset + this.layout.width / this.layout.scale;
		const scale = this.layout.scale;
		const lcw = this.layout.leftColumnWidth;
		const fullBottom = y + this.layout.height;

		ctx.fillStyle = HEADER_BACK;
		ctx.fillRect(
			this.manager.scroll[0], y,
			this.layout.width, TimelineLayout.HEADER_HEIGHT);

		ctx.lineWidth = 0.5;

		// Batch medium vertical grid lines
		ctx.strokeStyle = LINE_MED_COLOR;
		ctx.beginPath();
		for (let x = Math.floor(this.layout.offset / medium) * medium; x <= end; x += medium) {
			const pos = x * scale + lcw;
			ctx.moveTo(pos, y);
			ctx.lineTo(pos, fullBottom);
		}
		ctx.stroke();

		// Batch big vertical grid lines
		ctx.strokeStyle = LINE_BIG_COLOR;
		ctx.beginPath();
		for (let x = Math.floor(this.layout.offset / big) * big; x <= end; x += big) {
			const pos = x * scale + lcw;
			ctx.moveTo(pos, y);
			ctx.lineTo(pos, fullBottom);
		}
		ctx.stroke();

		// Batch all ruler ticks (small, medium, big) in one stroke
		ctx.strokeStyle = TICK_COLOR;
		ctx.beginPath();
		const smallBottom = y + TimelineLayout.HEADER_HEIGHT * 0.2;
		for (let x = Math.floor(this.layout.offset / small) * small; x <= end; x += small) {
			const pos = x * scale + lcw;
			ctx.moveTo(pos, y);
			ctx.lineTo(pos, smallBottom);
		}
		const medBottom = y + TimelineLayout.HEADER_HEIGHT * 0.5;
		for (let x = Math.floor(this.layout.offset / medium) * medium; x <= end; x += medium) {
			const pos = x * scale + lcw;
			ctx.moveTo(pos, y);
			ctx.lineTo(pos, medBottom);
		}
		const bigBottom = y + TimelineLayout.HEADER_HEIGHT;
		for (let x = Math.floor(this.layout.offset / big) * big; x <= end; x += big) {
			const pos = x * scale + lcw;
			ctx.moveTo(pos, y);
			ctx.lineTo(pos, bigBottom);
		}
		ctx.stroke();

		ctx.fillStyle = RULER_TEXT;
		ctx.font = font(TimelineLayout.HEADER_HEIGHT * 0.8);
		ctx.textBaseline = 'bottom';
		ctx.textAlign = 'start';

		for (let x = Math.floor(this.layout.offset / big) * big;
				 x < end; x += big)
		{
			ctx.fillText(Basic.formatTimestamp(x, 2),
				Math.round(x * scale + lcw) + 5,
				y + TimelineLayout.HEADER_HEIGHT);
		}
	}

	#renderTracks(ctx: CanvasRenderingContext2D) {
		let y = TimelineLayout.HEADER_HEIGHT + TimelineLayout.TRACKS_PADDING;
		for (const s of this.layout.shownStyles) {
			if (Editing.activeChannel === s) {
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
		const split = this.input.splitting;
		for (const ent of this.layout.getVisibleEntries()) {
			const boxes = this.layout.getEntryPositions(ent);
			if (boxes.length == 0) continue;
			const fillStyle = ent.label === 'none'
				? ENTRY_BACK
				: LabelColor(ent.label, ENTRY_BACK_OPACITY);
			const isSelected = this.input.selection.has(ent);
			const strokeStyle = isSelected ? ENTRY_BORDER_FOCUS : ENTRY_BORDER;
			const lineWidth = isSelected ? ENTRY_WIDTH_FOCUS : ENTRY_WIDTH;
			let overflowGrad: CanvasGradient | null = null;

			for (const b of boxes) {
				ctx.fillStyle = fillStyle;
				ctx.strokeStyle = strokeStyle;
				ctx.lineWidth = lineWidth;
				ctx.beginPath();
				ctx.roundRect(b.x, b.y, b.w, b.h, 4);
				ctx.fill();
				ctx.stroke();

				if (b.w < 15 || b.text.length === 0)
					continue;

				if (split?.target == ent && split.positions.has(b.style)) {
					ctx.save();
					ctx.beginPath();
					ctx.rect(b.x + 1, b.y + 1, b.w - 2, b.h - 2);
					ctx.clip();
					ctx.strokeStyle = ALIGNLINE_COLOR;
					ctx.lineWidth = 2;
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
					ctx.restore();
				} else {
					const textWidth = this.#measureTextWidth(ctx, b.text, ctxfont);
					if (textWidth <= b.w - 19) {
						ctx.fillStyle = ENTRY_TEXT;
						ctx.fillText(b.text, b.x + 4, b.y + 4);
					} else {
						if (!overflowGrad) {
							overflowGrad = ctx.createLinearGradient(
								b.x + b.w - 15, b.y, b.x + b.w, b.y);
							overflowGrad.addColorStop(0, ENTRY_TEXT);
							overflowGrad.addColorStop(1, ENTRY_TEXT_FADE);
						}
						ctx.save();
						ctx.beginPath();
						ctx.rect(b.x + 1, b.y + 1, b.w - 2, b.h - 2);
						ctx.clip();
						ctx.fillStyle = overflowGrad;
						ctx.fillText(b.text, b.x + 4, b.y + 4);
						ctx.restore();
					}
				}
			}
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

		ctx.strokeStyle = ALIGNLINE_COLOR;
		ctx.lineWidth = ALIGNLINE_WIDTH;

		const alignmentLine = this.input.alignmentLine;
		if (alignmentLine) {
			const x = alignmentLine.pos * this.layout.scale + this.layout.leftColumnWidth;
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
			ctx.lineTo(x, this.manager.contentRect.b);
			ctx.stroke();
		}

		if (this.input.newChannel) {
			const rightmost = this.layout.offset + this.layout.width / this.layout.scale;
			const channel = this.input.newChannel.channel;
			const y1 = TimelineLayout.HEADER_HEIGHT + TimelineLayout.TRACKS_PADDING +
				this.layout.entryHeight * Source.subs.styles.indexOf(channel);
			for (const { start, end, texts } of this.input.newChannel.targets) {
				if (end < this.layout.offset || start > rightmost) continue;
				if (texts.has(channel)) continue;

				const x1 = start * this.layout.scale + this.layout.leftColumnWidth;
				const x2 = end * this.layout.scale + this.layout.leftColumnWidth;

				ctx.strokeRect(x1, y1, x2 - x1, this.layout.entryHeight);
			}
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
		if (this.layout.offset > 0) {
			const edgeX = x + this.layout.leftColumnWidth;
			const shadowGrad = ctx.createLinearGradient(edgeX, y, edgeX + 10, y);
			shadowGrad.addColorStop(0, LEFT_COLUMN_SHADOW);
			shadowGrad.addColorStop(1, 'transparent');
			ctx.fillStyle = shadowGrad;
			ctx.fillRect(edgeX, y, 10, this.layout.height);
		}
		ctx.fillStyle = LEFT_COLUMN_BACK;
		ctx.fillRect(x, y,
			this.layout.leftColumnWidth,
			this.layout.height);

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

        const activeChannel = Editing.activeChannel;
		for (const s of this.layout.shownStyles) {
			if (s === activeChannel) {
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
