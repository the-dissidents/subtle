import { Basic } from "../../Basic";
import type { CanvasManager } from "../../CanvasManager";
import { SubtitleEntry, type SubtitleStyle, Subtitles, AlignMode } from "../../core/Subtitles.svelte";
import { EventHost } from "../../details/EventHost";
import { Typography } from "../../details/Typography";
import { MediaConfig } from "./Config";
import type { EntryBox } from "./SubtitleView.svelte";

type WrappedEntry = {
    oldIndex: number,
    newIndex: number,
    entry: SubtitleEntry
}

type Box = {
    x: number, y: number,
    w: number, h: number, diffy: number
}

function getBoxFromMetrics(metrics: TextMetrics, x: number, y: number): Box {
    return {
        x: x - metrics.actualBoundingBoxLeft,
        y: y - metrics.fontBoundingBoxDescent - metrics.fontBoundingBoxAscent,
        w: metrics.width,
        h: metrics.fontBoundingBoxDescent + metrics.fontBoundingBoxAscent,
        diffy: metrics.fontBoundingBoxAscent
    };
}

function boxIntersects(a: EntryBox, b: Box) {
    // more lenient on X-axis because we only shift boxes around on Y, and we want to deal with empty lines (zero-width boxes) correctly
    const h = a.x + a.w >= b.x && b.x + b.w >= a.x;
    const v = a.y + a.h > b.y && b.y + b.h > a.y;
    return h && v;
}

function isLeft(alignment: AlignMode) {
    return alignment == AlignMode.BottomLeft
        || alignment == AlignMode.CenterLeft
        || alignment == AlignMode.TopLeft;
}

function isCenterH(alignment: AlignMode) {
    return alignment == AlignMode.BottomCenter
        || alignment == AlignMode.Center
        || alignment == AlignMode.TopCenter;
}

function isRight(alignment: AlignMode) {
    return alignment == AlignMode.BottomRight
        || alignment == AlignMode.CenterRight
        || alignment == AlignMode.TopRight;
}

function isTop(alignment: AlignMode) {
    return alignment == AlignMode.TopLeft
        || alignment == AlignMode.TopCenter
        || alignment == AlignMode.TopRight;
}

function isCenterV(alignment: AlignMode) {
    return alignment == AlignMode.CenterLeft
        || alignment == AlignMode.Center
        || alignment == AlignMode.CenterRight;
}

function isBottom(alignment: AlignMode) {
    return alignment == AlignMode.BottomLeft
        || alignment == AlignMode.BottomCenter
        || alignment == AlignMode.BottomRight;
}

export class SubtitleRenderer {
    #subs: Subtitles;
    
    #currentEntries: WrappedEntry[] = [];
    #sortedEntries: WrappedEntry[] = [];

    #currentTime = 0;
    #hMargin = 0;
    #vMargin = 0;
    #scale = 1;
    get currentTime() {
        return this.#currentTime;
    }

    readonly getBoxes = new EventHost<[EntryBox[]]>();

    constructor(
        private readonly manager: CanvasManager,
        subtitles: Subtitles) 
    {
        this.#subs = subtitles;
        manager.onDisplaySizeChanged.bind(this, (_1, _2, rw, rh) => {
            this.updateResolution();
        });
        this.updateResolution();
        this.updateTimes();
    }

    changeSubtitles(newSubs: Subtitles) {
        this.#subs = newSubs;
        this.updateResolution();
        this.updateTimes();
    }

    updateResolution() {
        const [width, height] = this.manager.physicalSize;
        let ratio = this.#subs.metadata.width / this.#subs.metadata.height;
        if (width / height < ratio) {
            [this.#hMargin, this.#vMargin] = [0, (height - width / ratio) / 2];
            this.#scale = width / this.#subs.metadata.width * this.#subs.metadata.scalingFactor;
        } else {
            [this.#hMargin, this.#vMargin] = [(width - height * ratio) / 2, 0];
            this.#scale = height / this.#subs.metadata.height * this.#subs.metadata.scalingFactor;
        }
        // TODO: investigate https://github.com/libass/libass/blob/695509365f152bd28720a0c0e036d46836ee9345/libass/ass_render.c#L2161
    }

    updateTimes() {
        this.#sortedEntries = this.#subs.entries
            .map((x, i) => ({oldIndex: i, newIndex: -1, entry: x}) as WrappedEntry)
            .toSorted((a, b) => a.entry.start - b.entry.start);
        for (let i = 0; i < this.#sortedEntries.length; i++)
            this.#sortedEntries[i].newIndex = i;

        this.#searchCurrentEntries();
    }

    #searchCurrentEntries() {
        this.#currentEntries = [];
        // this.#nextStopTime = Infinity;
        for (let i = 0; i < this.#sortedEntries.length; i++) {
            let w = this.#sortedEntries[i];
            if (w.entry.start > this.#currentTime) {
                // this.#nextUpdateEntry = w;
                break;
            }
            if (w.entry.end > this.#currentTime) {
                this.#currentEntries.push(w);
                // this.#nextStopTime = Math.min(this.#nextStopTime, w.entry.end);
            }
        }
        this.#currentEntries.sort((a, b) => a.oldIndex - b.oldIndex);
    }

    #basePoint(style: SubtitleStyle): [number, number, number] {
        const [width, height] = this.manager.physicalSize;
        let x = 0, y = 0, dy = 1;
        if (isLeft(style.alignment))
            x = style.margin.left * this.#scale + this.#hMargin;
        if (isCenterH(style.alignment))
            x = width / 2;
        if (isRight(style.alignment))
            x = width - (style.margin.right * this.#scale + this.#hMargin);

        if (isTop(style.alignment))
            y = style.margin.top * this.#scale + this.#vMargin;
        if (isCenterV(style.alignment))
            y = height / 2;
        if (isBottom(style.alignment)) {
            y = height - (style.margin.bottom * this.#scale + this.#vMargin);
            dy = -1;
        }
        return [x, y, dy];
    }

    #breakWords(text: string, width: number, ctx: CanvasRenderingContext2D) {
        let words = Basic.splitPrintingWords(text);
        let lines: string[] = [], currentLine = '';
        for (let word of words) {
            if (word == '\n') {
                lines.push(currentLine);
                currentLine = '';
                continue;
            }
            let w = ctx.measureText(currentLine + word).width;
            if (w < width) {
                currentLine += word;
            } else {
                lines.push(currentLine);
                currentLine = word;
            }
        }
        lines.push(currentLine);
        return lines;
    }

    render(ctx: CanvasRenderingContext2D) {
        let boxes: EntryBox[] = [];

        const [width, height] = this.manager.physicalSize;
        ctx.strokeStyle = 'white';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.rect(this.#hMargin, this.#vMargin, 
            width - 2 * this.#hMargin, height - 2 * this.#vMargin);
        ctx.stroke();

        const styleFonts = new Map(this.#subs.styles.map((style) => {
            const size = style.size || 48;
            const font = style.font || 'sans-serif';
            const fontFamily = `"${font}", sans-serif`;
            const cssSize = 
                Typography.getRealDimFactor(fontFamily, ctx) * size * this.#scale;
            return [style, `${style.styles.bold ? 'bold ' : ''} ${style.styles.italic ? 'italic ' : ''} ${cssSize}px ${fontFamily}`];
        }));

        const reverseStyles = this.#subs.styles.toReversed();
        for (const ent of this.#currentEntries)
        for (const style of reverseStyles) {
            const text = ent.entry.texts.get(style);
            if (!text) continue;

            if (isLeft(style.alignment)) ctx.textAlign = 'left';
            if (isCenterH(style.alignment)) ctx.textAlign = 'center';
            if (isRight(style.alignment)) ctx.textAlign = 'right';
    
            ctx.font = styleFonts.get(style)!;
            ctx.fillStyle = style.color.toString();

            const textWidth = width - this.#hMargin * 2 - 
                (style.margin.left + style.margin.right) * this.#scale;
            const lines = this.#breakWords(text, textWidth, ctx);
            
            // loop for each line, starting from the bottom
            const [bx, by, dy] = this.#basePoint(style);
            if (dy < 0) lines.reverse();
            for (const line of lines) {
                const metrics = ctx.measureText(line);
                const [x, y] = [bx, by];
                const newBox = getBoxFromMetrics(metrics, x, y);
                newBox.y += isTop(style.alignment)     ? newBox.h
                          : isCenterV(style.alignment) ? newBox.h * 0.5 : 0;
                while (true) {
                    const overlapping = boxes.find((box) => boxIntersects(box, newBox));
                    if (!overlapping) break;
                    newBox.y = dy > 0
                        ? Math.max(newBox.y + 1, overlapping.y + overlapping.h)
                        : Math.min(newBox.y - 1, overlapping.y - overlapping.h);
                }

                if (MediaConfig.data.subtitleRenderer != 'dom') {
                    ctx.beginPath();
                    ctx.rect(newBox.x, newBox.y, newBox.w, newBox.h);
                    ctx.strokeStyle = 'white';
                    ctx.lineWidth = 1;
                    ctx.stroke();
                    if (style.outline) {
                        ctx.strokeStyle = style.outlineColor.toString();
                        ctx.lineWidth = style.outline * this.#scale;
                        ctx.strokeText(line, x, newBox.y + newBox.diffy);
                    }
                    ctx.fillText(line, x, newBox.y + newBox.diffy);
                }

                boxes.push({
                    ...newBox,
                    scale: this.#scale,
                    ascent: newBox.diffy,
                    text: line, style,
                    font: styleFonts.get(style)!
                });
            }
        }

        this.getBoxes.dispatch(boxes);
    }

    setTime(time: number) {
        if (time == this.currentTime) return;
        this.#currentTime = time;
        this.#searchCurrentEntries();
    }
}

