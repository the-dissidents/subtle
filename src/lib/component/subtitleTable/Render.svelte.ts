import { CanvasManager } from "../../CanvasManager";
import { SubtitleEntry } from "../../core/Subtitles.svelte";
import { hook } from "../../details/Hook.svelte";
import { applyStyle, toCSSStyle, type Line } from "../../details/TextLayout";
import { Editing } from "../../frontend/Editing";
import { LabelColor, theme } from "../../Theming.svelte";
import { TableConfig } from "./Config";
import { TableLayout } from "./Layout.svelte";

function overlappingTime(e1: SubtitleEntry | null, e2: SubtitleEntry) {
    const EPSILON = 0.002;
    return e1 && e2 && e1.start < e2.end - EPSILON && e1.end > e2.start + EPSILON;
}

const textColor           = $derived(theme.isDark ? '#fff'          : '#000');
const gridColor           = $derived(theme.isDark ? '#444'          : '#ddd');
const gridMajorColor      = $derived(theme.isDark ? '#666'          : '#bbb');
const headerBackground    = $derived(theme.isDark ? '#555'          : '#ddd');
const overlapColor        = $derived(theme.isDark ? 'lightpink'       : 'crimson');
const focusBackground     = $derived(theme.isDark ? 'darkslategray'   : 'lightblue');
const selectedBackground  = $derived(theme.isDark ? '#444'          : '#e8e8e8');
const errorBackground     = $derived(theme.isDark ? '#aa335599'     : '#eedd0099');

export class TableRenderer {
    private manager: CanvasManager;
    #debugBlinker = true;

    constructor(private layout: TableLayout) {
        this.manager = layout.manager;
        this.manager.renderer = (ctx) => this.render(ctx);
        hook(() => theme.isDark, () => this.manager.requestRender());
    }

    render(ctx: CanvasRenderingContext2D) {
        const drawLine = (x1: number, y1: number, x2: number, y2: number) => {
            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
            ctx.stroke();
        };

        const drawText = (lines: Line[], x: number, y: number) => {
            let cy = y;
            for (const line of lines) {
                let cx = x;
                for (const word of line.chunks) {
                    for (const chunk of word.chunks) {
                        applyStyle(toCSSStyle(chunk.format), ctx);
                        ctx.fillText(chunk.text, cx, cy);
                        cx += chunk.width;
                    }
                    cx += word.spaceWidth;
                }
                cy += this.layout.lineHeight;
            }
        }

        if (this.layout.requestedLayout) {
            this.layout.layout(ctx);
        }

        const [sx, sy] = this.manager.scroll;
        const [width, height] = this.manager.size;

        // table
        const focused = Editing.getFocusedEntry();
        const selection = new Set(Editing.getSelection());
        let i = 0;
        for (const { entry, line, height: lh, texts, cells } of this.layout.entries) {
            i += 1;
            if ((line + lh) * this.layout.lineHeight < sy) continue;
            if (line * this.layout.lineHeight > sy + width) break;

            // background of selection
            const baseY = line * this.layout.lineHeight + this.layout.headerHeight;
            const h = lh * this.layout.lineHeight;
            if (entry == focused) {
                ctx.fillStyle = focusBackground;
                ctx.fillRect(0, baseY+1, width + sx, h-2);
            } else if (selection.has(entry)) {
                ctx.fillStyle = selectedBackground;
                ctx.fillRect(0, baseY+1, width + sx, h-2);
            }

            // label
            if (entry.label !== 'none') {
                ctx.fillStyle = LabelColor(entry.label);
                ctx.fillRect(0, baseY, this.layout.indexColumnLayout.width, h);
            }

            // texts
            const textFillStyle =
                (entry !== focused
                    && focused instanceof SubtitleEntry
                    && overlappingTime(focused, entry)) ? overlapColor : textColor;

            ctx.strokeStyle = gridColor;

            // channels; in the order of Source.subs.styles
            let y0 = baseY;
            let j = 0;
            for (const { failed, height, cells } of texts) {
                const xpos = this.layout.channelColumns[0].layout!.position;

                // background for failed validation
                if (failed.length > 0) {
                    ctx.fillStyle = errorBackground;
                    ctx.fillRect(xpos, y0 + 1, 
                        width + sx - xpos, height * this.layout.lineHeight - 2);
                }

                cells.forEach((cell, k) => {
                    const col = this.layout.channelColumns[k];
                    ctx.textBaseline = 'middle';
                    ctx.textAlign = col.layout!.align;
                    ctx.fillStyle = textFillStyle;
                    applyStyle(this.layout.baseStyleCSS, ctx);
                    drawText(cell.layout, 
                        col.layout!.textX, 
                        y0 + 0.5 * this.layout.lineHeight);
                });

                // inner horizontal lines
                y0 += height * this.layout.lineHeight;
                if (j != entry.texts.size - 1)
                    drawLine(xpos, y0, width + sx, y0);
                j++;
            }

            // entry cells
            const entryCellY = Math.min(
                Math.max(sy + this.layout.headerHeight, baseY), 
                baseY + (lh - 1) * this.layout.lineHeight
            );

            cells.forEach((cell, j) => {
                const col = this.layout.entryColumns[j];
                ctx.textAlign = col.layout!.align;
                ctx.fillStyle = textFillStyle;
                applyStyle(this.layout.baseStyleCSS, ctx);
                ctx.textBaseline = 'middle';
                drawText(cell.layout, 
                    col.layout!.textX, 
                    entryCellY + 0.5 * this.layout.lineHeight);
            });

            // index
            ctx.textAlign = 'end';
            ctx.fillStyle = textFillStyle;
            applyStyle(this.layout.baseStyleMonospaceCSS, ctx);
            ctx.fillText(i.toString(),
                this.layout.indexColumnLayout.width - this.layout.cellPadding,
                entryCellY + 0.5 * this.layout.lineHeight);

            // outer horizontal line
            ctx.strokeStyle = gridMajorColor;
            drawLine(0, baseY + h, width + sx, baseY + h);
        }

        if (i == this.layout.entries.length) {
            // virtual entry
            const lastLine = this.layout.entries.at(-1);
            const y = (lastLine 
                        ? (lastLine.line + lastLine.height) * this.layout.lineHeight 
                        : 0) + this.layout.headerHeight;
            if (focused == 'virtual') {
                ctx.fillStyle = focusBackground;
                ctx.fillRect(0, y, width + sx, this.layout.lineHeight);
            }
            ctx.fillStyle = textColor;
            ctx.textBaseline = 'middle';
            ctx.textAlign = 'end';
            applyStyle(this.layout.baseStyleMonospaceCSS, ctx);
            ctx.fillText(`*`,
                this.layout.indexColumnLayout.width - this.layout.cellPadding,
                y + this.layout.lineHeight * 0.5);
        }

        // header
        ctx.fillStyle = headerBackground;
        if (this.manager.scroll[1] > 0) {
            ctx.shadowBlur = 10;
            ctx.shadowColor = '#333a';
        }
        ctx.fillRect(0, this.manager.scroll[1], sx + width, this.layout.headerHeight);

        ctx.shadowColor = 'transparent';
        ctx.strokeStyle = gridMajorColor;
        drawLine(0, this.manager.scroll[1] + this.layout.headerHeight,
            width + sx, this.manager.scroll[1] + this.layout.headerHeight);

        const cols = [this.layout.indexColumnLayout,
            ...this.layout.entryColumns.map((x) => x.layout!),
            ...this.layout.channelColumns.map((x) => x.layout!)];

        ctx.textBaseline = 'middle';
        ctx.fillStyle = textColor;
        applyStyle(this.layout.baseStyleCSS, ctx);
        for (const col of cols) {
            ctx.textAlign = col.align;
            ctx.fillText(col.name, col.textX, sy + this.layout.lineHeight * 0.5);
        }

        // vertical lines
        ctx.strokeStyle = gridMajorColor;
        const maxY = this.manager.contentRect.b;
        drawLine(this.layout.indexColumnLayout.width, sy,
            this.layout.indexColumnLayout.width,
            Math.min(sy + height, maxY - this.manager.scrollerSize));

        const bottom = Math.min(sy + height,
            maxY - this.layout.lineHeight - this.manager.scrollerSize);
        cols.slice(1).map((x) => drawLine(x.position, sy, x.position, bottom));

        if (TableConfig.data.showDebug) {
            ctx.resetTransform();
            ctx.scale(devicePixelRatio, devicePixelRatio);
            ctx.fillStyle = this.#debugBlinker ? 'red' : 'blue';
            ctx.beginPath();
            ctx.arc(width - 15, height - 15, 5, 0, 2 * Math.PI);
            ctx.fill();
            this.#debugBlinker = !this.#debugBlinker;
        }
    }
}