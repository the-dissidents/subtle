import { AudioSampler } from "./AudioSampler";
import { Basic, assert } from "./Basic";
import type { WithCanvas } from "./CanvasKeeper";
import { SubtitleEntry, SubtitleUtil, type SubtitleChannel, SubtitleStyle } from "./Subtitles";
import { ChangeCause, ChangeType, SelectMode, type Frontend } from "./Frontend";
import { MMedia } from "./API";

const SCROLLER_HEIGHT = 15;
const HEADER_HEIGHT = 30;
const HEADER_BACK = 'hsl(0deg 0% 20%)';
const TICK_COLOR = 'white';
const LINE_BIG_COLOR = 'hsl(0deg 0% 60%)';
const LINE_MED_COLOR = 'hsl(0deg 0% 30%)';
const RULER_TEXT = 'white';

const PRELOAD_MARGIN = 5;
const PRELOAD_MARGIN_2 = 0.1;
const CURSOR_AREA_MARGIN = 100;
const TRACK_AREA_MARGIN = 40;

const ENTRY_WIDTH = 1;
const ENTRY_BORDER = 'hsl(0deg 0% 60%)';
const ENTRY_BACK = 'hsl(0deg 0% 40% / 60%)';
const ENTRY_TEXT = 'hsl(0deg 0% 80%)';
const ENTRY_BORDER_FOCUS = 'goldenrod';
const ENTRY_WIDTH_FOCUS = 4;

const CURSOR_COLOR = 'pink';
const BOXSELECT_BACK = 'hsl(0deg 0% 80% / 40%)';
const BOXSELECT_BORDER = 'hsl(0deg 0% 70%)';
const BOXSELECT_WIDTH = 3;

const INOUT_AREA_OUTSIDE = 'hsl(0deg 0% 80% / 40%)';

const DRAG_RESIZE_MARGIN = 10;
const SNAP_DISTANCE = 10;
const ALIGNLINE_COLOR = 'hsl(0deg 0% 80%)';
const ALIGNLINE_WIDTH = 3;

type Box = {
    x: number, y: number,
    w: number, h: number, channel?: SubtitleChannel
};

function getTick(scale: number): [small: number, nMed: number, nBig: number] {
    const UNITS = [0.001, 0.01, 0.1, 1, 10, 60, 600, 3600];
    for (let i = 0; i < UNITS.length - 3; i++)
        if (scale * UNITS[i] > 2) return [
            UNITS[i], 
            UNITS[i+1] / UNITS[i], 
            UNITS[i+2] / UNITS[i]];
    return [60, 600, 3600];
}

let ellipsisWidth = -1;

function ellipsisText(cxt: CanvasRenderingContext2D, str: string, max: number) {
    const ellipsis = '…';
    const binarySearch = (max: number, match: number, 
        getValue: (guess: number) => number) => 
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

function fontSize(size: number) {
    return window.devicePixelRatio * size;
}

export class Timeline implements WithCanvas {
    #frontend: Frontend;
    #cxt: CanvasRenderingContext2D;
    #animating = false;
    #requestedRender = false;
    #requestedSampler = false;

    #sampler: AudioSampler | null = null;
    #scale = 1; // pixel per second
    #offset = 0; // in seconds
    #cursorPos = 0;

    #width = 100;
    #height = 100;
    #entryHeight = 0;
    #stylesMap = new Map<SubtitleStyle, number>();

    #selectBox: Box | null = null;
    #selection = new Set<SubtitleEntry>;
    #alignmentLine: number | null = null;
    
    get viewScale() {return this.#scale;}
    get viewOffset() {return this.#offset;}
    get cursorPos() {return this.#cursorPos;}

    setDisplaySize(_1: number, _2: number, w: number, h: number): void {
        this.#width = w;
        this.#height = h;
        this.#preprocessStyles();
        this.setViewScale(this.#scale);
        this.requestRender();
    }

    #preprocessStyles() {
        const subs = this.#frontend.subs;
        this.#entryHeight = (this.#height - HEADER_HEIGHT - TRACK_AREA_MARGIN * 2) 
            / (subs.styles.length+1);
        this.#stylesMap = new Map(
            [[subs.defaultStyle, 0], ...subs.styles.map((x, i) => [x, i+1])] as any);
    }

    constructor(c: CanvasRenderingContext2D, f: Frontend) {
        this.#cxt = c;
        this.#frontend = f;
        this.setViewScale(10);
        this.requestRender();

        c.canvas.oncontextmenu = (e) => e.preventDefault();
        c.canvas.onmousemove = (ev) => this.#processMouseMove(ev);
        c.canvas.onmousedown = (ev) => this.#processMouseDown(ev);
        c.canvas.ondblclick = () => this.#precessDoubleClick();
        c.canvas.onwheel = (ev) => this.#processWheel(ev);
        f.onSelectionChanged.bind((cause) => {
            if (cause != ChangeCause.Timeline) {
                this.#selection = new Set(this.#frontend.getSelection());
                if (this.#frontend.focused.entry)
                    this.#keepEntryInView(this.#frontend.focused.entry);
                this.requestRender();
            }
        });
        f.onSubtitlesChanged.bind((type) => {
            if (type == ChangeType.StyleDefinitions || type == ChangeType.General) {
                this.#preprocessStyles();
            }
            if (type != ChangeType.Metadata)
                this.requestRender();
        });
        f.onSubtitleObjectReload.bind(() => {
            this.#preprocessStyles();
            this.requestRender();
        })
    }

    // helpers

    #getVisibleEntries(): SubtitleEntry[] {
        const end = this.#offset + this.#width / this.#scale;
        return this.#frontend.subs.entries.filter(
            (ent) => ent.end > this.#offset && ent.start < end);
    }

    #getEntryPositions(ent: SubtitleEntry): Box[] {
        const w = (ent.end - ent.start) * this.#scale,
              x = (ent.start - this.#offset) * this.#scale;
        return ent.texts.map((channel) => {
            let i = this.#stylesMap.get(channel.style) ?? 0;
            let y = this.#entryHeight * i + HEADER_HEIGHT + TRACK_AREA_MARGIN;
            return {x: x, y: y, w: w, h: this.#entryHeight, channel: channel};
        });
    }

    #findEntriesByPosition(
        x: number, y: number, w = 0, h = 0): SubtitleEntry[] 
    {
        let result = [];
        const start = (x / this.#scale) + this.#offset;
        const end = (x + w / this.#scale) + this.#offset;
        for (let ent of this.#frontend.subs.entries) {
            if (ent.end < start || ent.start > end) continue;
            if (this.#getEntryPositions(ent)
                .some((b) => b.x <= x + w && b.x + b.w >= x 
                          && b.y <= y + h && b.y + b.h >= y)) result.push(ent);
        }
        return result;
    }

    #snapMove(focus: SubtitleEntry, desiredStart: number) {
        let flen = focus.end - focus.start;
        let snap = (x: number) => {
            // start
            let d = Math.abs(desiredStart - x);
            if (d < minDist) {
                pos = x;
                newStart = x;
                minDist = d;
            }
            // end
            d = Math.abs(desiredStart + flen - x);
            if (d < minDist) {
                pos = x;
                newStart = x - flen;
                minDist = d;
            }
        };
        let minDist = SNAP_DISTANCE / this.#scale;
        let pos: number | null = null, newStart: number = desiredStart;
        snap(this.#cursorPos);
        for (let e of this.#getVisibleEntries()) {
            if (this.#selection.has(e)) continue;
            snap(e.start);
            snap(e.end);
        }
        this.#alignmentLine = pos !== null ? (pos - this.#offset) * this.#scale : null;
        return newStart;
    }

    #snapEnds(ent: SubtitleEntry, desired: number, isStart: boolean) {
        let ok = isStart 
            ? (x: number) => x < ent.end 
            : (x: number) => x > ent.start;
        let snap = (x: number) => {
            if (!ok(x)) return;
            let d = Math.abs(desired - x);
            if (d < minDist) {
                pos = x;
                minDist = d;
            }
        };
        let minDist = SNAP_DISTANCE / this.#scale;
        let pos: number | null = null;
        snap(this.#cursorPos);
        for (let e of this.#getVisibleEntries()) {
            if (e == ent) continue;
            snap(e.start);
            snap(e.end);
        }
        this.#alignmentLine = pos !== null ? (pos - this.#offset) * this.#scale : null;
        return pos ?? desired;
    }

    #keepEntryInView(ent: SubtitleEntry) {
        const w = (ent.end - ent.start) * this.#scale,
              x = (ent.start - this.#offset) * this.#scale;
        const dxStart = x;
        const dxEnd = (x + w) - this.#width;
        if (dxStart >= 0 && dxEnd <= 0) return;
        if (Math.abs(dxStart) < Math.abs(dxEnd))
            this.setViewOffset(this.#offset + dxStart / this.#scale);
        else
            this.setViewOffset(this.#offset + dxEnd / this.#scale);
    }

    #keepPosInSafeArea(pos: number) {
        let margin = CURSOR_AREA_MARGIN / this.#scale;
        let left = this.#offset + margin,
            right = this.#offset + this.#width / this.#scale - margin;
        if (pos < left) this.setViewOffset(this.#offset + pos - left);
        if (pos > right) this.setViewOffset(this.#offset + pos - right);
    }

    // UI events

    #processMouseMove(e: MouseEvent) {
        const ratio = window.devicePixelRatio;
        this.#cxt.canvas.style.cursor = 'default';
        if (e.offsetY * ratio < HEADER_HEIGHT) {
            this.#cxt.canvas.style.cursor = 'col-resize';
            return;
        }

        const under = this.#findEntriesByPosition(e.offsetX * ratio, e.offsetY * ratio);
        if (under.length == 0) return;
        if ((this.#selection.size > 1 
             || (Basic.ctrlKey() == 'Meta' ? e.metaKey : e.ctrlKey)) 
            && under.some((x) => this.#selection.has(x)))
        {
            this.#cxt.canvas.style.cursor = 'move';
        } else {
            let ent = under.find((x) => this.#selection.has(x)) ?? under[0];
            const w = (ent.end - ent.start) * this.#scale,
                  x = (ent.start - this.#offset) * this.#scale;
            if (e.offsetX * ratio - x < DRAG_RESIZE_MARGIN)
                this.#cxt.canvas.style.cursor = 'e-resize';
            else if (x + w - e.offsetX * ratio < DRAG_RESIZE_MARGIN)
                this.#cxt.canvas.style.cursor = 'w-resize';
            // else
            //     this.#cxt.canvas.style.cursor = 'move';
        }
    }

    #processMouseDown(e0: MouseEvent) {
        e0.preventDefault();
        let onMove = (_: MouseEvent) => {};
        let onUp = (_: MouseEvent) => {};
        const ratio = window.devicePixelRatio;
        const origPos = this.#offset + e0.offsetX / this.#scale * ratio;
        if (e0.button == 1) {
            // scale
            const orig = this.#scale;
            onMove = (e1) => {
                this.setViewScale(orig / Math.pow(1.03, (e0.clientX - e1.clientX)));
                this.setViewOffset(origPos - e0.offsetX / this.#scale * ratio);
            };
        } else {
            if (e0.offsetY * ratio < HEADER_HEIGHT) {
                // move cursor
                onMove = async (e1) => await this.setCursorPos(
                    this.#offset + e1.offsetX / this.#scale * ratio);
                onMove(e0);
            } else {
                let ents = this.#findEntriesByPosition(
                    e0.offsetX * ratio, e0.offsetY * ratio);
                if (ents.length == 0) {
                    // clicked on nothing
                    if (Basic.ctrlKey() == 'Meta' ? !e0.metaKey : !e0.ctrlKey) {
                        // clear selection
                        this.#frontend.clearSelection(ChangeCause.Timeline);
                        this.#selection.clear();
                        this.requestRender();
                    }
                    // initiate box select
                    this.#selectBox = null;
                    const originalSelection = [...this.#selection];
                    let thisGroup = [];
                    onMove = (e1) => {
                        let x1 = (origPos - this.#offset) * this.#scale,
                            x2 = e1.offsetX * ratio,
                            y1 = e0.offsetY * ratio,
                            y2 = e1.offsetY * ratio;
                        let b: Box = {
                            x: Math.min(x1, x2), y: Math.min(y1, y2), 
                            w: Math.abs(x1 - x2), h: Math.abs(y1 - y2)};
                        this.#selectBox = b;
                        let newGroup =
                            this.#findEntriesByPosition(b.x, b.y, b.w, b.h);
                        if (newGroup.length != thisGroup.length) {
                            this.#selection = new Set(
                                [...originalSelection, ...newGroup]);
                            thisGroup = newGroup;
                            this.#dispatchSelectionChanged();
                        }
                        this.#keepPosInSafeArea(x2 / this.#scale + this.#offset);
                        this.requestRender();
                    };
                    // stop box select
                    onUp = () => {
                        this.#selectBox = null;
                        this.requestRender();
                    };
                } else if (e0.button == 2) {
                    // right-clicked on something
                    // clear selection and re-select only if it's not selected
                    if (!ents.some((x) => this.#selection.has(x))) {
                        this.#frontend.clearSelection(ChangeCause.Timeline);
                        this.#frontend.selectEntry(ents[0], 
                            SelectMode.Single, ChangeCause.Action);
                    }
                    // you can't drag in this case! no onMove.
                    // start context menu on mouse up
                    // note we do it here instead of in oncontextmenu
                    onUp = () => this.#frontend.uiHelper.contextMenu();
                } else {
                    // left-clicked on something
                    // renew selection
                    let afterUp = () => {};
                    if (Basic.ctrlKey() == 'Meta' ? e0.metaKey : e0.ctrlKey) {
                        // multiple select. Only the first entry counts
                        if (!this.#selection.has(ents[0])) {
                            this.#selection.add(ents[0]);
                            this.#dispatchSelectionChanged();
                            this.requestRender();
                        } else afterUp = () => {
                            // if hasn't dragged
                            console.log('afterup');
                            this.#selection.delete(ents[0]);
                            this.#dispatchSelectionChanged();
                            this.requestRender();
                        }
                    } else {
                        // single select
                        if (this.#selection.size > 1) {
                            afterUp = () => {
                                console.log('afterup');
                                this.#selection.clear();
                                this.#selection.add(ents[0]);
                                this.#frontend.selectEntry(ents[0], 
                                    SelectMode.Single, ChangeCause.Timeline);
                            };
                        } else {
                            // cycle through the overlapping entries under the cursor
                            let one = [...this.#selection][0];
                            let index = (ents.indexOf(one) + 1) % ents.length;
                            this.#selection.clear();
                            this.#selection.add(ents[index]);
                            this.#frontend.selectEntry(ents[index], 
                                SelectMode.Single, ChangeCause.Timeline);
                        }
                        this.requestRender();
                    }
                    // drag if necessary
                    const sels = [...this.#selection];
                    const origL = Math.min(...sels.map((x) => x.start)),
                          origR = Math.max(...sels.map((x) => x.end));
                    const distL = origPos - origL, distR = origR - origPos;
                    console.log(distL * this.#scale, distR * this.#scale);
                    if (this.#selection.size > 1 
                        || (distL * this.#scale > DRAG_RESIZE_MARGIN 
                         && distR * this.#scale > DRAG_RESIZE_MARGIN))
                    {
                        // dragging the whole
                        const one = ents.find((x) => this.#selection.has(x));
                        const origStarts = new Map(sels.map((x) => [x, x.start]));
                        let dragged = false;
                        onMove = (e1) => {
                            const newPos = 
                                e1.offsetX / this.#scale * ratio + this.#offset;
                            let dval = newPos - origPos;
                            if (!e1.altKey && one)
                                dval = this.#snapMove(one, origStarts.get(one)! + dval) 
                                    - origStarts.get(one)!;
                            dragged = newPos != origPos;
                            for (let ent of sels) {
                                const len = ent.end - ent.start;
                                ent.start = origStarts.get(ent)! + dval;
                                ent.end = ent.start + len;
                            }
                            this.requestRender();
                        };
                        onUp = () => {
                            this.#alignmentLine = null;
                            this.requestRender();
                            if (dragged) {
                                this.#frontend.markChanged(
                                    ChangeType.Times, ChangeCause.Timeline);
                            } else afterUp();
                        };
                    } else {
                        // dragging endpoints
                        const isStart = distL * this.#scale <= DRAG_RESIZE_MARGIN;
                        const entry = sels[0];
                        const origVal = isStart ? entry.start : entry.end;
                        let dragged = false;
                        onMove = (e1) => {
                            const newPos = 
                                e1.offsetX / this.#scale * ratio + this.#offset;
                            let val = origVal + newPos - origPos;
                            if (!e1.altKey) val = this.#snapEnds(entry, val, isStart);
                            if (isStart) entry.start = Math.min(entry.end, val);
                            else entry.end = Math.max(entry.start, val);
                            dragged = val != origVal;
                            this.#keepPosInSafeArea(val);
                            this.requestRender();
                        };
                        onUp = () => {
                            this.#alignmentLine = null;
                            this.requestRender();
                            if (dragged) {
                                this.#frontend.markChanged(
                                    ChangeType.Times, ChangeCause.Timeline);
                            } else afterUp();
                        };
                    }
                }
            }
        };

        let handler = (ev: MouseEvent) => {
            onUp(ev);
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', handler);
        };
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', handler);
    }

    #precessDoubleClick() {
        if (this.#selection.size == 1) {
            let one = [...this.#selection][0];
            if (this.#frontend.focused.entry == one)
                this.#frontend.startEditingFocusedEntry();
        }
    }

    #processWheel(e: WheelEvent) {
        if (e.deltaX != 0)
            this.setViewOffset(this.#offset + 10 * e.deltaX / this.#scale);
        else if (e.deltaY % 1 != 0) {
            const ratio = window.devicePixelRatio;
            const origPos = this.#offset + e.offsetX / this.#scale * ratio;
            this.setViewScale(this.#scale / Math.pow(1.03, e.deltaY));
            this.setViewOffset(origPos - e.offsetX / this.#scale * ratio);
        }
    }

    #dispatchSelectionChanged() {
        this.#frontend.focused.entry = null;
        this.#frontend.selection.submitted = new Set(this.#selection);
        if (this.#selection.size == 1) {
            let array = [...this.#selection.values()];
            this.#frontend.selection.currentGroup = array;
            this.#frontend.selection.currentStart = array[0];
            this.#frontend.focused.entry = array[0];
        } else {
            this.#frontend.selection.currentGroup = [];
            this.#frontend.selection.currentStart = null;
        }
        this.#frontend.onSelectionChanged.dispatch(ChangeCause.Timeline);
    }

    #samplerMedia?: MMedia;

    async load(rawurl: string) {
        if (this.#samplerMedia !== undefined && !this.#samplerMedia.isClosed) {
            this.#samplerMedia.close();
        }
        this.#samplerMedia = await MMedia.open(rawurl);
        this.#sampler = await AudioSampler.open(this.#samplerMedia);
        this.#scale = Math.max(this.#width / this.#sampler.duration, 10);
        this.#offset = 0;
        this.#cursorPos = 0; // or setCursorPos?
        this.requestRender();
    }

    // view & sampling

    #maxPosition() {
        return this.#sampler 
            ? this.#sampler.duration 
            : Math.max(...this.#frontend.subs.entries.map((x) => x.end)) + 20;
    }

    #processSampler() {
        if (!this.#sampler) return;

        let start = this.#offset;
        let end = this.#offset + this.#width / this.#scale;
        const preload = Math.min(PRELOAD_MARGIN, (end - start) * PRELOAD_MARGIN_2);
        if (this.#sampler.isSampling) {
            if (this.#sampler.sampleProgress + preload < this.#offset 
                || this.#sampler.sampleProgress > end + preload) 
                    this.#sampler.tryCancelSampling();
            else if (this.#sampler.sampleEnd < end + preload)
                this.#sampler.extendSampling(end + preload);
        }
        if (this.#sampler.isSampling) return;

        const resolution = this.#sampler.resolution;
        const i = Math.floor(this.#offset * resolution),
              i_end = Math.ceil(end * resolution);
        const subarray = this.#sampler.detail.subarray(i, i_end);
        const first0 = subarray.findIndex((x) => x == 0);
        // const firstLarge = subarray.findIndex((x) => x > 5);
        if (this.#frontend.playback.isPlaying) {
            if (first0 < 0) {
                // if (firstLarge < 0)
                    this.#requestedSampler = false;
                return;
            }
        } else {
            this.#requestedSampler = false;
            if (first0 < 0) return;
        }
        start = (first0 + i) / resolution;
        let end0 = subarray.findIndex((x, i) => i > first0 && x > 0);
        if (end0 > 0) end = (end0 + i) / resolution;

        end += preload;
        if (start < 0) start = 0;
        if (end > this.#sampler.duration) end = this.#sampler.duration;
        if (end <= start) return;

        this.#animating = true;
        this.#sampler.startSampling(start, end).then(() => {
            this.#animating = false;
            this.requestRender();
            this.#processSampler();
        });
        this.requestRender();
    }

    setViewOffset(v: number) {
        if (v < 0) v = 0;
        v = Math.min(v, this.#maxPosition() - this.#width / this.#scale);
        this.#offset = v;
        this.#processSampler();
        this.requestRender();
        this.#requestedSampler = true;
    }

    setCursorPosPassive(pos: number) {
        if (pos == this.#cursorPos) return;
        if (pos < 0) pos = 0;
        pos = Math.min(pos, this.#maxPosition());
        this.#cursorPos = pos;
        this.#keepPosInSafeArea(pos);
        this.requestRender();
    }

    async setCursorPos(pos: number) {
        if (pos == this.#cursorPos) return;
        this.setCursorPosPassive(pos);
        await this.#frontend.playback.setPosition(pos);
    }

    setViewScale(v: number) {
        assert(v > 0);
        v = Math.max(v, this.#width / this.#maxPosition());
        v = Math.min(v, 500);
        if (v == this.#scale) return;
        this.#scale = v;
        this.#processSampler();
        this.requestRender();
        this.#requestedSampler = true;
    }

    // rendering
    // TODO: it's timeline rendering that takes the most CPU time when playing video,
    // and there's a lot we can do to optimize it.
    //
    // 1. Make the pointer a separate sprite, or equivalently, render waveform on a 
    //    background canvas
    // 2. Render incrementally when scrolling
    #renderWaveform() {
        if (!this.#sampler) return;
        if (this.#requestedSampler) this.#processSampler();

        const resolution = this.#sampler.resolution;
        const start = Math.max(0, Math.floor(this.#offset * resolution));
        const end = Math.min(
            Math.ceil((this.#offset + this.#width / this.#scale) * resolution),
            this.#sampler.data.length - 1);
        const width = 1 / resolution * this.#scale;
        const step = Math.max(1, Math.ceil(1 / width));
        const drawWidth = Math.ceil(Math.max(1, step * width))
        for (let i = start; i < end; i += step) {
            const detail = this.#sampler.detail[i];
            const x = Math.floor((i - this.#offset * resolution) * width);

            this.#cxt.fillStyle = `rgb(100% 10% 10% / 30%)`;
            let dh = (1 - detail) * this.#height;
            this.#cxt.fillRect(x, this.#height - dh, drawWidth, dh);

            if (detail == 0) continue;
            let value = Math.sqrt(this.#sampler.data[i]) * this.#height;
            this.#cxt.fillStyle = `rgb(100 255 255)`;
            this.#cxt.fillRect(x, (this.#height - value) / 2, 
                drawWidth, Math.max(value, 1));
        }
    }

    #renderRulerAndScroller() {
        let line = (pos: number, height: number) => {
            this.#cxt.beginPath();
            this.#cxt.moveTo(pos, 0);
            this.#cxt.lineTo(pos, height);
            this.#cxt.stroke();
        };
        const [small, nMed, nBig] = getTick(this.#scale);
        const start = Math.floor(this.#offset / small / nBig) * small * nBig, 
              end = this.#offset + this.#width / this.#scale;
        const n = Math.ceil((end - start) / small);
        this.#cxt.fillStyle = HEADER_BACK;
        this.#cxt.fillRect(0, 0, this.#width, HEADER_HEIGHT);

        this.#cxt.fillStyle = RULER_TEXT;
        this.#cxt.font = `${fontSize(10)}px sans-serif`;
        this.#cxt.textBaseline = 'bottom';
        this.#cxt.lineWidth = 1;
        for (let i = 0; i < n; i++) {
            let t = start + i * small;
            let pos = Math.round((t - this.#offset) * this.#scale);
            let height = 5;
            if (i % nBig == 0) {
                height = HEADER_HEIGHT;
                this.#cxt.strokeStyle = LINE_BIG_COLOR;
                line(pos, this.#height);
            } else if (i % nMed == 0) {
                height = HEADER_HEIGHT * 0.5;
                this.#cxt.strokeStyle = LINE_MED_COLOR;
                line(pos, this.#height);
            } else {
                height = HEADER_HEIGHT * 0.2;
            }
            this.#cxt.strokeStyle = TICK_COLOR;
            line(pos, height);
        }
        for (let t = start; t < end; t += nBig * small) {
            const pos = Math.round((t - this.#offset) * this.#scale);
            this.#cxt.fillText(SubtitleUtil.formatTimestamp(t, 2), 
                pos + 5, HEADER_HEIGHT);
        }

        const max = this.#maxPosition();
        if (Math.abs(this.#width - this.#scale * max) < 0.001) return;
        this.#cxt.fillStyle = `rgb(255 255 255 / 40%)`;
        this.#cxt.fillRect(
            this.#width * (this.#offset / max), this.#height - SCROLLER_HEIGHT, 
            this.#width * (this.#width / this.#scale / max), SCROLLER_HEIGHT);
    }

    #renderTracks() {
        ellipsisWidth = -1;
        this.#cxt.textBaseline = 'top';
        this.#cxt.font = `${fontSize(12)}px sans-serif`;
        for (let ent of this.#getVisibleEntries()) {
            this.#getEntryPositions(ent).forEach((b) => {
                this.#cxt.fillStyle = ENTRY_BACK;
                if (this.#selection.has(ent)) {
                    this.#cxt.strokeStyle = ENTRY_BORDER_FOCUS;
                    this.#cxt.lineWidth = ENTRY_WIDTH_FOCUS;
                } else {
                    this.#cxt.strokeStyle = ENTRY_BORDER;
                    this.#cxt.lineWidth = ENTRY_WIDTH;
                }
                this.#cxt.beginPath();
                this.#cxt.roundRect(b.x, b.y, b.w, b.h, 4);
                this.#cxt.fill();
                this.#cxt.stroke();
                if (b.w > 50) {
                    this.#cxt.fillStyle = ENTRY_TEXT;
                    this.#cxt.fillText(
                        ellipsisText(this.#cxt, b.channel!.text, b.w - 8), 
                        b.x + 4, b.y + 4);
                }
            });
        }
    }

    #renderCursor() {
        let pos = (this.#cursorPos - this.#offset) * this.#scale;
        if (this.#selectBox) {
            this.#cxt.fillStyle = BOXSELECT_BACK;
            this.#cxt.strokeStyle = BOXSELECT_BORDER;
            this.#cxt.lineWidth = BOXSELECT_WIDTH;
            this.#cxt.beginPath();
            this.#cxt.roundRect(
                this.#selectBox.x, this.#selectBox.y, 
                this.#selectBox.w, this.#selectBox.h, 2);
            this.#cxt.fill();
            this.#cxt.stroke();
        }
        if (this.#alignmentLine) {
            this.#cxt.strokeStyle = ALIGNLINE_COLOR;
            this.#cxt.lineWidth = ALIGNLINE_WIDTH;
            this.#cxt.beginPath();
            this.#cxt.moveTo(this.#alignmentLine, HEADER_HEIGHT);
            this.#cxt.lineTo(this.#alignmentLine, this.#height);
            this.#cxt.stroke();
        }
        const area = this.#frontend.playback.playArea;
        if (area.start !== undefined) {
            const start = (area.start - this.#offset) * this.#scale;
            this.#cxt.fillStyle = INOUT_AREA_OUTSIDE;
            this.#cxt.fillRect(0, 0, start, this.#height);
        }
        if (area.end !== undefined) {
            const end = (area.end - this.#offset) * this.#scale;
            this.#cxt.fillStyle = INOUT_AREA_OUTSIDE;
            this.#cxt.fillRect(end, 0, this.#width - end, this.#height);
        }

        this.#cxt.fillStyle = CURSOR_COLOR;
        this.#cxt.beginPath();
        this.#cxt.moveTo(pos + 8, 0);
        this.#cxt.lineTo(pos - 8, 0);
        this.#cxt.lineTo(pos - 2, 10);
        this.#cxt.lineTo(pos - 2, this.#height);
        this.#cxt.lineTo(pos + 2, this.#height);
        this.#cxt.lineTo(pos + 2, 10);
        this.#cxt.lineTo(pos + 8, 0);
        this.#cxt.fill();
    }

    #render() {
        this.#requestedRender = false;
        const t0 = Date.now();
    
        this.#cxt.fillStyle = 'black';
        this.#cxt.fillRect(0, 0, this.#width, this.#height);
        this.#renderRulerAndScroller();
        this.#renderWaveform();
        this.#renderTracks();
        this.#renderCursor();

        this.#cxt.font = `bold ${fontSize(12)}px sans-serif`;
        this.#cxt.fillStyle = 'lightgreen';
        this.#cxt.textBaseline = 'top';
        const area = this.#frontend.playback.playArea;
        const status = (area.start === undefined ? '' : 'IN ')
                     + (area.end === undefined ? '' : 'OUT ')
                     + (area.loop ? 'LOOP ' : '');
        const statusWidth = this.#cxt.measureText(status).width;
        this.#cxt.fillText(status, this.#width - statusWidth - 5, 35);
        
        this.#cxt.font = `${fontSize(8)}px sans-serif`;
        this.#cxt.fillStyle = 'white';
        this.#cxt.fillText(`offset=${this.#offset.toFixed(2)}`, 10, 30);
        this.#cxt.fillText(`scale=${this.#scale.toFixed(2)}`, 10, 50);
        this.#cxt.fillText(`render time=${(Date.now() - t0).toFixed(1)}`, 100, 30);

        if (this.#animating)
            this.requestRender();
    }

    requestRender() {
        if (this.#requestedRender) return;
        this.#requestedRender = true;
        requestAnimationFrame(() => this.#render());
    }
}