import { Basic } from "./Basic";
import { SubtitleEntry, type SubtitleStyle, Subtitles, AlignMode } from "./core/Subtitles.svelte";

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
    //console.log(metrics);
    return {
        x: x - metrics.actualBoundingBoxLeft,
        y: y - metrics.fontBoundingBoxDescent - metrics.fontBoundingBoxAscent,
        w: metrics.width,
        h: metrics.fontBoundingBoxDescent + metrics.fontBoundingBoxAscent,
        diffy: metrics.fontBoundingBoxAscent
    };
}

function boxIntersects(a: Box, b: Box) {
    let h = a.x + a.w > b.x && b.x + b.w > a.x;
    let v = a.y + a.h > b.y && b.y + b.h > a.y;
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
    // #nextUpdateEntry: WrappedEntry | null = null;
    // #nextStopTime = Infinity;
    #hMargin = 0;
    #vMargin = 0;
    #scale = 1;
    get currentTime() {
        return this.#currentTime;
    }

    constructor(
        public width: number, 
        public height: number, 
        subtitles: Subtitles) 
    {
        this.#subs = subtitles;
        this.changeResolution();
        this.updateTimes();
    }

    changeSubtitles(newSubs: Subtitles) {
        this.#subs = newSubs;
        this.changeResolution();
        this.updateTimes();
    }

    changeResolution(width: number = this.width, height: number = this.height) {
        this.width = width;
        this.height = height;
        let ratio = this.#subs.metadata.width / this.#subs.metadata.height;
        if (width / height < ratio) {
            [this.#hMargin, this.#vMargin] = [0, (height - width / ratio) / 2];
            this.#scale = width / this.#subs.metadata.width;
        } else {
            [this.#hMargin, this.#vMargin] = [(width - height * ratio) / 2, 0];
            this.#scale = height / this.#subs.metadata.height;
        }
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
        let x = 0, y = 0, dy = 1;
        if (isLeft(style.alignment))
            x = style.margin.left * this.#scale + this.#hMargin;
        if (isCenterH(style.alignment))
            x = this.width / 2;
        if (isRight(style.alignment))
            x = this.width - (style.margin.right * this.#scale + this.#hMargin);

        if (isTop(style.alignment))
            y = style.margin.top * this.#scale + this.#vMargin;
        if (isCenterV(style.alignment))
            y = this.height / 2;
        if (isBottom(style.alignment)) {
            y = this.height - (style.margin.bottom * this.#scale + this.#vMargin);
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
        let boxes: Box[] = [];
        // ctx.clearRect(0, 0, this.width, this.height);
        ctx.strokeStyle = 'white';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.rect(this.#hMargin, this.#vMargin, 
            this.width - 2 * this.#hMargin, this.height - 2 * this.#vMargin);
        ctx.stroke();
        const reverseStyles = this.#subs.styles.toReversed();
        for (const ent of this.#currentEntries)
        for (const style of reverseStyles) {
            const text = ent.entry.texts.get(style);
            if (!text) continue;

            if (isLeft(style.alignment)) ctx.textAlign = 'left';
            if (isCenterH(style.alignment)) ctx.textAlign = 'center';
            if (isRight(style.alignment)) ctx.textAlign = 'right';
    
            let size = style.size;
            let font = style.font;
            let color = style.color;
            let lineColor = style.outlineColor;
            let lineWidth = style.outline;
            if (isNaN(size)) size = 48;
            if (isNaN(lineWidth)) lineWidth = 0;
            if (font == '') font = 'sans-serif';
            if (color == '') color = 'white';
            if (lineColor == '') lineColor = 'black';
            // I'm making sure this is compatible to libass, though I believe 3/4 is
            // a mistake for 4/3
            ctx.font = `${style.styles.bold ? 'bold ' : ''}${style.styles.italic ? 'italic ' : ''}${size * this.#scale * 3/4}px "${font}", sans-serif`;
            ctx.fillStyle = color;

            let width = this.width - this.#hMargin * 2 - 
                (style.margin.left + style.margin.right) * this.#scale;
            let lines = this.#breakWords(text, width, ctx);
            
            // loop for each line, starting from the bottom
            let [bx, by, dy] = this.#basePoint(style);
            if (dy < 0) lines.reverse();
            for (let line of lines) {
                // TODO: revise the algorithm
                let metrics = ctx.measureText(line);
                let [x, y] = [bx, by];
                let newBox = getBoxFromMetrics(metrics, x, y);
                let yOffset = 0;
                if (isTop(style.alignment))
                    yOffset = newBox.h;
                if (isCenterV(style.alignment))
                    yOffset = newBox.h * 0.5;
                newBox.y += yOffset;
                while (true) {
                    let overlapping = boxes.find((box) => boxIntersects(box, newBox));
                    if (!overlapping) break;
                    if (dy > 0) {
                        newBox.y = Math.max(newBox.y + 1, overlapping.y + overlapping.h);
                    } else {
                        newBox.y = Math.min(newBox.y - 1, overlapping.y - overlapping.h);
                    }
                }
                boxes.push(newBox);
                ctx.beginPath();
                ctx.rect(newBox.x, newBox.y, newBox.w, newBox.h);
                ctx.strokeStyle = 'white';
                ctx.lineWidth = 1;
                ctx.stroke();
                if (lineWidth > 0) {
                    ctx.strokeStyle = lineColor;
                    ctx.lineWidth = lineWidth * this.#scale;
                    ctx.strokeText(line, x, newBox.y + newBox.diffy);
                }
                ctx.fillText(line, x, newBox.y + newBox.diffy);
            }
        }
    }

    setTime(time: number) {
        if (time == this.currentTime) return;

        // console.log('time ->', time);
        this.#currentTime = time;
        this.#searchCurrentEntries();
    }
}

