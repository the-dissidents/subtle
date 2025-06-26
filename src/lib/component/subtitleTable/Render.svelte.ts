import { CanvasManager } from "../../CanvasManager";
import { InterfaceConfig } from "../../config/Groups";
import { Metrics } from "../../core/Filter";
import { SubtitleEntry } from "../../core/Subtitles.svelte";
import { hook } from "../../details/Hook.svelte";
import { Editing } from "../../frontend/Editing";
import { Source } from "../../frontend/Source";
import { LabelColor, theme } from "../../Theming.svelte";
import { TableConfig } from "./Config";
import { TableLayout } from "./Layout.svelte";

function overlappingTime(e1: SubtitleEntry | null, e2: SubtitleEntry) {
  return e1 && e2 && e1.start < e2.end && e1.end > e2.start;
}

const textColor           = $derived(theme.isDark ? '#fff'          : '#000');
const gridColor           = $derived(theme.isDark ? '#444'          : '#bbb');
const gridMajorColor      = $derived(theme.isDark ? '#666'          : '#999');
const headerBackground    = $derived(theme.isDark ? '#555'          : '#ddd');
const overlapColor        = $derived(theme.isDark ? 'lightpink'     : 'crimson');
const focusBackground     = $derived(theme.isDark ? 'darkslategray' : 'lightblue');
const selectedBackground  = $derived(theme.isDark ? '#444'          : '#eee');
const errorBackground     = $derived(theme.isDark ? '#aa335599'     : '#eedd0099');

export class TableRenderer {
    private manager: CanvasManager;
    #debugBlinker = true;

    constructor(private layout: TableLayout) {
        this.manager = layout.manager;
        this.manager.renderer = (ctx) => this.render(ctx);
        hook(() => theme.isDark, () => this.manager.requestRender());
    }

    render(cxt: CanvasRenderingContext2D) {
        const drawLine = (x1: number, y1: number, x2: number, y2: number) => {
            cxt.beginPath();
            cxt.moveTo(x1, y1);
            cxt.lineTo(x2, y2);
            cxt.stroke();
        };

        if (this.layout.requestedLayout) {
            this.layout.layout(cxt);
        }

        cxt.font = this.layout.font;
        cxt.textBaseline = 'top';
        cxt.fillStyle = textColor;

        const [sx, sy] = this.manager.scroll;
        const [width, height] = this.manager.size;

        // table
        let selection = new Set(Editing.getSelection());
        let focused = Editing.getFocusedEntry();
        let i = 0;
        for (const {entry, line, height: lh, texts} of this.layout.lines) {
            i += 1;
            if ((line + lh) * this.layout.lineHeight < sy) continue;
            if (line * this.layout.lineHeight > sy + width) break;

            // background of selection
            const y = line * this.layout.lineHeight + this.layout.headerHeight;
            const h = lh * this.layout.lineHeight;
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
            cxt.fillRect(0, y, this.layout.indexColumnLayout.width, h);
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
            const xpos = this.layout.channelColumns[0].layout!.position;
            
            // background for failed validation
            if (failed.length > 0) {
                cxt.fillStyle = errorBackground;
                cxt.fillRect(xpos, y0 + 1, width + sx - xpos, height * this.layout.lineHeight - 2);
            }

            for (const col of this.layout.channelColumns) {
                const value = Metrics[col.metric].stringValue(entry, style);
                let splitLines = value.split('\n');
                cxt.textBaseline = 'middle';
                cxt.textAlign = col.layout!.align;
                cxt.fillStyle = textFillStyle;
                splitLines.forEach((x, i) => 
                cxt.fillText(x, col.layout!.textX, y0 + (i + 0.5) * this.layout.lineHeight));
            }

            // inner horizontal lines
            y0 += height * this.layout.lineHeight;
            if (j != entry.texts.size - 1)
                drawLine(xpos, y0, width + sx, y0);
            j++;
            }

            // entry cells
            for (const col of this.layout.entryColumns) {
            const value = Metrics[col.metric].stringValue(entry, Source.subs.defaultStyle);
            let splitLines = value.split('\n');
            cxt.textBaseline = 'middle';
            cxt.textAlign = col.layout!.align;
            cxt.fillStyle = textFillStyle;
            splitLines.forEach((line, i) => 
                cxt.fillText(line, col.layout!.textX, y + (i + 0.5) * this.layout.lineHeight));
            }

            // index
            cxt.textAlign = 'end';
            cxt.fillStyle = textFillStyle;
            cxt.fillText(i.toString(), 
                this.layout.indexColumnLayout.width - this.layout.cellPadding, 
                y + 0.5 * this.layout.lineHeight);

            // outer horizontal line
            cxt.strokeStyle = gridMajorColor;
            drawLine(0, y + h, width + sx, y + h);
        }

        if (i == this.layout.lines.length) {
            // virtual entry
            const lastLine = this.layout.lines.at(-1);
            const y = (lastLine 
                ? (lastLine.line + lastLine.height) * this.layout.lineHeight 
                : 0) + this.layout.headerHeight;
            if (focused == 'virtual') {
            cxt.fillStyle = focusBackground;
            cxt.fillRect(0, y, width + sx, this.layout.lineHeight);
            }
            cxt.fillStyle = textColor;
            cxt.textBaseline = 'middle';
            cxt.textAlign = 'end';
            cxt.fillText(`*`, 
                this.layout.indexColumnLayout.width - this.layout.cellPadding, 
                y + this.layout.lineHeight * 0.5);
        }

        // header
        cxt.fillStyle = headerBackground;
        if (this.manager.scroll[1] > 0) {
            cxt.shadowBlur = 10;
            cxt.shadowColor = '#333a';
        }
        cxt.fillRect(0, this.manager.scroll[1], sx + width, this.layout.headerHeight);

        cxt.shadowColor = 'transparent';
        cxt.strokeStyle = gridMajorColor;
        drawLine(0, this.manager.scroll[1] + this.layout.headerHeight, 
            width + sx, this.manager.scroll[1] + this.layout.headerHeight);

        cxt.fillStyle = textColor;
        const cols = [this.layout.indexColumnLayout, 
            ...this.layout.entryColumns.map((x) => x.layout!), 
            ...this.layout.channelColumns.map((x) => x.layout!)];
        for (const col of cols) {
            cxt.textBaseline = 'middle';
            cxt.textAlign = col.align;
            cxt.fillText(col.name, col.textX, sy + this.layout.lineHeight * 0.5);
        }

        // vertical lines
        cxt.strokeStyle = gridMajorColor;
        const maxY = this.manager.contentRect.b;
        drawLine(this.layout.indexColumnLayout.width, sy, 
            this.layout.indexColumnLayout.width, 
            Math.min(sy + height, maxY - this.manager.scrollerSize));

        const bottom = Math.min(sy + height, 
            maxY - this.layout.lineHeight - this.manager.scrollerSize);
        cols.slice(1).map((x) => drawLine(x.position, sy, x.position, bottom));

        if (TableConfig.data.showDebug) {
            cxt.resetTransform();
            cxt.scale(devicePixelRatio, devicePixelRatio);
            cxt.fillStyle = this.#debugBlinker ? 'red' : 'blue';
            cxt.beginPath();
            cxt.arc(width - 15, height - 15, 5, 0, 2 * Math.PI);
            cxt.fill();
            this.#debugBlinker = !this.#debugBlinker;
        }
    }
}