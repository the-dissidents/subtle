import type { CanvasManager } from "../../CanvasManager";
import { SubtitleEntry, type SubtitleStyle, Subtitles } from "../../core/Subtitles.svelte";
import { AlignMode } from "../../core/Labels";
import { EventHost } from "../../details/EventHost";
import { Typography } from "../../details/Typography";
import { layoutText, WarpStyle, type EvaluatedStyle, type Line } from "../../details/TextLayout";

export type LineBox = {
    x: number, y: number,
    style: SubtitleStyle,
    scale: number,
    line: Line
};

type WrappedEntry = {
    oldIndex: number,
    newIndex: number,
    entry: SubtitleEntry
}

type Box = {
    x: number, y: number,
    w: number, h: number,
}

function getBoxFromLine(line: Line, x: number, y: number): Box {
    return {
        x: x ,
        y: y - line.height,
        w: line.width,
        h: line.height,
    };
}

function boxIntersects(a: LineBox, b: Box) {
    // more lenient on X-axis because we only shift boxes around on Y, and we want to deal with empty lines (zero-width boxes) correctly
    const h = a.x + a.line.width >= b.x && b.x + b.w >= a.x;
    const v = a.y + a.line.height > b.y && b.y + b.h > a.y;
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

    readonly getBoxes = new EventHost<[LineBox[]]>();

    constructor(
        private readonly manager: CanvasManager,
        subtitles: Subtitles) 
    {
        this.#subs = subtitles;
        manager.onDisplaySizeChanged.bind(this, () => {
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
        const ratio = this.#subs.metadata.width / this.#subs.metadata.height;
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
            const w = this.#sortedEntries[i];
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

    #basePoint(style: SubtitleStyle): [number, number, 1 | -1] {
        const [width, height] = this.manager.physicalSize;
        let x = 0, y = 0, dy: 1 | -1 = 1;
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

    render(ctx: CanvasRenderingContext2D) {
        const boxes: LineBox[] = [];
        const [width, height] = this.manager.physicalSize;
        ctx.strokeStyle = 'white';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.rect(this.#hMargin, this.#vMargin, 
            width - 2 * this.#hMargin, height - 2 * this.#vMargin);
        ctx.stroke();

        const styleFonts = new Map<SubtitleStyle, EvaluatedStyle>(this.#subs.styles.map((style) => {
            const fontFamily = style.font ? `"${style.font}", sans-serif` : 'sans-serif';
            const factor = style.font ? Typography.getRealDimFactor(style.font) : 1;
            const cssSize = factor * style.size * this.#scale;
            return [style, {
                size: cssSize, fontFamily,
                color: style.color,
                bold: style.styles.bold,
                italic: style.styles.italic,
                underline: style.styles.underline,
                strikethrough: style.styles.strikethrough
            }];
        }));

        const reverseStyles = this.#subs.styles.toReversed();
        for (const ent of this.#currentEntries)
        for (const style of reverseStyles) {
            const text = ent.entry.texts.get(style);
            if (!text) continue;

            const lineWidth = width - this.#hMargin * 2 - 
                (style.margin.left + style.margin.right) * this.#scale;
            const lines = layoutText(text, ctx, {
                warpStyle: WarpStyle.Balanced, 
                baseStyle: styleFonts.get(style)!,
                lineWidth,
            });

            const [bx, by, dy] = this.#basePoint(style);

            // start from the bottom if aligned at the bottom, or vice versa
            if (dy < 0) lines.reverse();

            for (const line of lines) {
                const [x, y] = [bx, by];
                const newBox = getBoxFromLine(line, x, y);
                newBox.x += isRight(style.alignment)   ? -newBox.w
                          : isCenterH(style.alignment) ? -newBox.w * 0.5 : 0;
                newBox.y += isTop(style.alignment)     ? newBox.h
                          : isCenterV(style.alignment) ? newBox.h * 0.5 : 0;
                while (true) {
                    const overlapping = boxes.find((box) => boxIntersects(box, newBox));
                    if (!overlapping) break;
                    newBox.y = dy > 0
                        ? Math.max(newBox.y + 1, overlapping.y + overlapping.line.height + newBox.h)
                        : Math.min(newBox.y - 1, overlapping.y - newBox.h);
                }

                boxes.push({
                    ...newBox,
                    scale: this.#scale, line, style,
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

