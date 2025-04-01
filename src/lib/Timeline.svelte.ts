import { AudioSampler } from "./AudioSampler";
import { Basic, assert } from "./Basic";
import { DebugConfig, InterfaceConfig } from "./config/Groups";
import { CanvasManager } from "./CanvasManager";
import { MMedia } from "./API";
import { LabelColor, theme } from "./Theming.svelte";

import { SubtitleEntry, SubtitleUtil, type SubtitleChannel, SubtitleStyle } from "./core/Subtitles.svelte";
import { ChangeCause, ChangeType, Source } from "./frontend/Source";
import { Editing, SelectMode } from "./frontend/Editing";
import { Playback } from "./frontend/Playback";
import { Actions } from "./frontend/Actions";
import { PublicConfigGroup } from "./config/PublicConfig.svelte";
import { type TranslatedWheelEvent } from "./frontend/Frontend";

import { _ } from 'svelte-i18n';
import { get } from "svelte/store";

export const TimelineConfig = new PublicConfigGroup(
    () => get(_)('config.timeline'),
    null, 1,
{
    fontSize: {
        localizedName: () => get(_)('config.font-size'),
        type: 'number',
        bounds: [5, null],
        default: 12
    },
    waveformResolution: {
        localizedName: () => get(_)('config.waveform-resolution'),
        description: () => get(_)('config.waveform-resolution-d'),
        type: 'number',
        bounds: [50, 800],
        default: 700
    },
    dragResizeArea: {
        localizedName: () => get(_)('config.resize-area-size'),
        type: 'number',
        description: () => get(_)('config.resize-area-size-d'),
        bounds: [1, 10],
        default: 5
    },
    enableSnap: {
        localizedName: () => get(_)('config.snapping'),
        type: 'boolean',
        description: () => get(_)('config.snapping-d'),
        default: true
    },
    snapDistance: {
        localizedName: () => get(_)('config.snap-distance'),
        type: 'number',
        description: () => get(_)('config.snap-distance-d'),
        bounds: [1, 10],
        default: 5
    },
    multiselectDragReference: {
        localizedName: () => get(_)('config.multiselect-drag-reference'),
        type: 'dropdown',
        options: {
            whole: { localizedName: () => get(_)('config.whole-of-selection') },
            eachStyleofWhole: { localizedName: () => get(_)('config.each-style-of-selection') },
            one: { localizedName: () => get(_)('config.the-entry-under-the-mouse') }
        },
        default: 'eachStyleofWhole'
    },
    showDebug: {
        localizedName: () => get(_)('config.show-debug-info'),
        type: 'boolean',
        default: true
    },
});

const HEADER_HEIGHT = 15;
const HEADER_BACK       = $derived(theme.isDark ? 'hsl(0deg 0% 20%)' : 'hsl(0deg 0% 85%)');
const TICK_COLOR        = $derived(theme.isDark ? 'white' : 'gray');
const LINE_BIG_COLOR    = $derived(theme.isDark ? 'hsl(0deg 0% 60%)' : 'hsl(0deg 0% 40%)');
const LINE_MED_COLOR    = $derived(theme.isDark ? 'hsl(0deg 0% 30%)' : 'hsl(0deg 0% 70%)');
const RULER_TEXT        = $derived(theme.isDark ? 'white' : 'hsl(0deg 0% 20%)');

const PRELOAD_MARGIN = 3;
const PRELOAD_MARGIN_FACTOR = 0.1;
const CURSOR_AREA_MARGIN = 50;
const TRACK_AREA_MARGIN = 20;

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

type Box = {
    x: number, y: number,
    w: number, h: number, channel?: SubtitleChannel
};

function getTick(scale: number): [small: number, nMed: number, nBig: number] {
    const UNITS = [0.001, 0.01, 0.1, 1, 10, 60, 600, 3600];
    for (let i = 0; i < UNITS.length - 3; i++)
        if (scale * UNITS[i] > 2 / devicePixelRatio) return [
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
    return size;
}

function font(size: number) {
    return `${size}px ${InterfaceConfig.data.fontFamily}`;
}
// TODO: convert to a component!

export class Timeline {
    #requestedSampler = false;

    #sampler: AudioSampler | null = null;
    /** pixels per second */
    #scale = 1;
    #cursorPos = 0;

    #width = 100;
    #height = 100;
    #entryHeight = 0;
    #stylesMap = new Map<SubtitleStyle, number>();

    #selectBox: Box | null = null;
    #selection = new Set<SubtitleEntry>;
    #alignmentLine: {x: number, y1: number, y2: number} | null = null;

    #manager: CanvasManager;
    
    get cursorPos() {return this.#cursorPos;}
    get #offset() {
        return this.#manager.scroll[0] / this.#scale;
    }

    setDisplaySize(w: number, h: number, cw: number, ch: number): void {
        this.#width = w;
        this.#height = h;
        this.#preprocessStyles();
        const offset = this.#offset;
        this.setViewScale(this.#scale);
        this.setViewOffset(offset);
        this.#manager.requestRender();
    }

    #preprocessStyles() {
        const subs = Source.subs;
        this.#entryHeight = (this.#height - HEADER_HEIGHT - TRACK_AREA_MARGIN * 2) 
            / (subs.styles.length+1);
        this.#stylesMap = new Map(
            [[subs.defaultStyle, 0], ...subs.styles.map((x, i) => [x, i+1])] as any);
    }

    constructor(canvas: HTMLCanvasElement) {
        this.#manager = new CanvasManager(canvas);
        this.#manager.onDisplaySizeChanged.bind(this, 
            (w, h, rw, rh) => this.setDisplaySize(w, h, rw, rh));
        this.#manager.renderer = (ctx) => this.#render(ctx);

        canvas.oncontextmenu = (e) => e.preventDefault();
        canvas.ondblclick = () => this.#precessDoubleClick();
        this.#manager.onMouseMove.bind(this, (ev) => this.#processMouseMove(ev));
        this.#manager.onMouseDown.bind(this, (ev) => this.#processMouseDown(ev));
        this.#manager.onMouseWheel.bind(this, (tr, e) => this.#processWheel(tr, e));
        this.#manager.onUserScroll.bind(this, () => this.#requestedSampler = true);

        this.setViewScale(10);

        Editing.onSelectionChanged.bind(this, (cause) => {
            if (cause != ChangeCause.Timeline) {
                this.#selection = new Set(Editing.getSelection());
                let focused = Editing.getFocusedEntry();
                if (focused instanceof SubtitleEntry) this.#keepEntryInView(focused);
                this.#manager.requestRender();
            }
        });
        Source.onSubtitlesChanged.bind(this, (type) => {
            if (type == ChangeType.StyleDefinitions || type == ChangeType.General) {
                this.#preprocessStyles();
            }
            if (type != ChangeType.Metadata)
                this.#manager.requestRender();
        });
        Source.onSubtitleObjectReload.bind(this, () => {
            this.#preprocessStyles();
            this.#manager.requestRender();
        });
    }

    // helpers

    #getVisibleEntries(): SubtitleEntry[] {
        const end = this.#offset + this.#width / this.#scale;
        return Source.subs.entries.filter(
            (ent) => ent.end > this.#offset && ent.start < end);
    }

    #getEntryPositions(ent: SubtitleEntry): Box[] {
        const w = (ent.end - ent.start) * this.#scale,
              x = ent.start * this.#scale;
        return ent.texts.map((channel) => {
            let i = this.#stylesMap.get(channel.style) ?? 0;
            let y = this.#entryHeight * i + HEADER_HEIGHT + TRACK_AREA_MARGIN;
            return {x: x, y: y, w: w, h: this.#entryHeight, channel: channel};
        });
    }

    // coordinates are offset but not scaled
    #findEntriesByPosition(
        x: number, y: number, w = 0, h = 0): SubtitleEntry[] 
    {
        let result = [];
        const start = x / this.#scale;
        const end = (x + w) / this.#scale;
        for (let ent of Source.subs.entries) {
            if (ent.end < start || ent.start > end) continue;
            if (this.#getEntryPositions(ent)
                .some((b) => b.x <= x + w && b.x + b.w >= x 
                          && b.y <= y + h && b.y + b.h >= y)) result.push(ent);
        }
        return result;
    }

    #snapMove(points: number[], origStart: number, desiredStart: number) {
        const snap = (x: number, y1: number, y2: number) => {
            for (const point of points) {
                let d = Math.abs(desiredStart - x + point - origStart);
                if (d < minDist) {
                    this.#alignmentLine = {x: x * this.#scale, y1, y2};
                    snapped = x - point + origStart;
                    minDist = d;
                }
            }
        };
        let minDist = TimelineConfig.data.snapDistance / this.#scale;
        let snapped = desiredStart; 
        this.#alignmentLine = null;
        snap(this.#cursorPos, 0, this.#height);
        for (const e of this.#getVisibleEntries()) {
            if (this.#selection.has(e)) continue;
            let positions = this.#getEntryPositions(e);
            let y1 = Math.min(...positions.map((x) => x.y));
            let y2 = Math.max(...positions.map((x) => x.y + x.h));
            snap(e.start, y1, y2);
            snap(e.end, y1, y2);
        }
        return snapped;
    }

    #snapEnds(start: number, end: number, desired: number, isStart: boolean) {
        const ok = isStart 
            ? (x: number) => x < end 
            : (x: number) => x > start;
        const snap = (x: number, y1: number, y2: number) => {
            if (!ok(x)) return;
            let d = Math.abs(desired - x);
            if (d < minDist) {
                minDist = d;
                this.#alignmentLine = {x: x * this.#scale, y1, y2};
                snapped = x;
            }
        };
        let minDist = TimelineConfig.data.snapDistance / this.#scale;
        let snapped = desired;
        this.#alignmentLine = null;
        snap(this.#cursorPos, 0, this.#height);
        for (const e of this.#getVisibleEntries()) {
            if (this.#selection.has(e)) continue;
            let positions = this.#getEntryPositions(e);
            let y1 = Math.min(...positions.map((x) => x.y));
            let y2 = Math.max(...positions.map((x) => x.y + x.h));
            snap(e.start, y1, y2);
            snap(e.end, y1, y2);
        }
        return snapped;
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
        const margin = CURSOR_AREA_MARGIN / this.#scale;
        const left = this.#offset + margin,
              right = this.#offset + this.#width / this.#scale - margin;
        if (pos < left) this.setViewOffset(this.#offset + pos - left);
        if (pos > right) this.setViewOffset(this.#offset + pos - right);
    }

    // UI events

    #processMouseMove(e: MouseEvent) {
        const canvas = this.#manager.canvas;
        canvas.style.cursor = 'default';
        if (e.offsetY < HEADER_HEIGHT) {
            canvas.style.cursor = 'col-resize';
            return;
        }

        const under = this.#findEntriesByPosition(
            e.offsetX + this.#manager.scroll[0], e.offsetY);
        if (under.length == 0) return;
        if ((this.#selection.size > 1 
             || (Basic.ctrlKey() == 'Meta' ? e.metaKey : e.ctrlKey)) 
            && under.some((x) => this.#selection.has(x)))
        {
            canvas.style.cursor = 'move';
        } else {
            let ent = under.find((x) => this.#selection.has(x)) ?? under[0];
            const w = (ent.end - ent.start) * this.#scale,
                  x = (ent.start - this.#offset) * this.#scale;
            if (e.offsetX - x < TimelineConfig.data.dragResizeArea)
                canvas.style.cursor = 'e-resize';
            else if (x + w - e.offsetX < TimelineConfig.data.dragResizeArea)
                canvas.style.cursor = 'w-resize';
            // else
            //     canvas.style.cursor = 'move';
        }
    }

    #processMouseDown(e0: MouseEvent) {
        e0.preventDefault();
        let onMove = (_: MouseEvent) => {};
        let onUp = (_: MouseEvent) => {};
        const origPos = this.#offset + e0.offsetX / this.#scale;
        const scrollX = this.#manager.scroll[0];
        if (e0.button == 1) {
            // scale
            const orig = this.#scale;
            onMove = (e1) => {
                this.setViewScale(orig / Math.pow(1.03, (e0.clientX - e1.clientX)));
                this.setViewOffset(origPos - e0.offsetX / this.#scale);
            };
        } else {
            if (e0.offsetY < HEADER_HEIGHT) {
                // move cursor
                onMove = async (e1) => 
                    await this.setCursorPos((e1.offsetX + scrollX) / this.#scale);
                onMove(e0);
            } else {
                let underMouse = this.#findEntriesByPosition(
                    e0.offsetX + scrollX, e0.offsetY);
                if (underMouse.length == 0) {
                    // clicked on nothing
                    if (Basic.ctrlKey() == 'Meta' ? !e0.metaKey : !e0.ctrlKey) {
                        // clear selection
                        Editing.clearSelection(ChangeCause.Timeline);
                        this.#selection.clear();
                        this.#manager.requestRender();
                    }
                    // initiate box select
                    this.#selectBox = null;
                    const originalSelection = [...this.#selection];
                    let thisGroup = [];
                    onMove = (e1) => {
                        let x1 = origPos * this.#scale,
                            x2 = e1.offsetX + scrollX,
                            y1 = e0.offsetY,
                            y2 = e1.offsetY;
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
                        this.#keepPosInSafeArea(x2 / this.#scale);
                        this.#manager.requestRender();
                    };
                    // stop box select
                    onUp = () => {
                        this.#selectBox = null;
                        this.#manager.requestRender();
                    };
                } else if (e0.button == 2) {
                    // right-clicked on something
                    // clear selection and re-select only if it's not selected
                    if (!underMouse.some((x) => this.#selection.has(x))) {
                        Editing.clearSelection(ChangeCause.Timeline);
                        Editing.selectEntry(underMouse[0], 
                            SelectMode.Single, ChangeCause.Action);
                    }
                    // you can't drag in this case! no onMove.
                    // start context menu on mouse up
                    // note we do it here instead of in oncontextmenu
                    onUp = () => Actions.contextMenu();
                } else {
                    // left-clicked on something
                    // renew selection
                    let afterUp = () => {};
                    if (Basic.ctrlKey() == 'Meta' ? e0.metaKey : e0.ctrlKey) {
                        // multiple select. Only the first entry counts
                        if (!this.#selection.has(underMouse[0])) {
                            this.#selection.add(underMouse[0]);
                            this.#dispatchSelectionChanged();
                            this.#manager.requestRender();
                        } else afterUp = () => {
                            // if hasn't dragged
                            this.#selection.delete(underMouse[0]);
                            this.#dispatchSelectionChanged();
                            this.#manager.requestRender();
                        }
                    } else {
                        // single select
                        if (this.#selection.size > 1) {
                            afterUp = () => {
                                this.#selection.clear();
                                this.#selection.add(underMouse[0]);
                                Editing.selectEntry(underMouse[0], 
                                    SelectMode.Single, ChangeCause.Timeline);
                            };
                        } else {
                            // cycle through the overlapping entries under the cursor
                            let one = [...this.#selection][0];
                            let index = (underMouse.indexOf(one) + 1) % underMouse.length;
                            this.#selection.clear();
                            this.#selection.add(underMouse[index]);
                            Editing.selectEntry(underMouse[index], 
                                SelectMode.Single, ChangeCause.Timeline);
                        }
                        this.#manager.requestRender();
                    }
                    // drag if necessary
                    const sels = [...this.#selection];
                    if (sels.length == 0) return;

                    // save original positions
                    const origPositions = new Map(sels.map((x) => [x, {
                        start: x.start,
                        end: x.end
                    }]));
                    const [first, last] = sels.reduce<[SubtitleEntry, SubtitleEntry]>(
                        ([pf, pl], current) => [
                            current.start < pf.start ? current : pf,
                            current.end > pl.end ? current : pf], 
                        [sels[0], sels[0]]);
                    const distL = (origPos - first.start) * this.#scale, 
                          distR = (last.end - origPos) * this.#scale;

                    if (distL > TimelineConfig.data.dragResizeArea 
                     && distR > TimelineConfig.data.dragResizeArea)
                    {
                        // drag-move
                        let dragged = false;
                        const one = underMouse.find((x) => this.#selection.has(x))!;
                        const points = 
                              TimelineConfig.data.multiselectDragReference == 'eachStyleofWhole' 
                            ? [...new Set([...sels.reduce(
                                (prev, current) => {
                                    const start = current.start;
                                    const end = current.end;
                                    current.texts.forEach((x) => {
                                        let tuple = prev.get(x.style.name);
                                        if (tuple) {
                                            if (start < tuple[0]) tuple[0] = start;
                                            if (end > tuple[1]) tuple[1] = end;
                                        } else
                                            prev.set(x.style.name, [start, end]);
                                    });
                                    return prev;
                                }, 
                                new Map<string, [number, number]>()).values()].flat())]
                            : TimelineConfig.data.multiselectDragReference == 'whole' 
                            ? [first.start, last.end]
                            : [one.start, one.end];
                        const origStart = Math.min(...points);
                        const firstStart = first.start;
                        onMove = (e1) => {
                            const newPos = 
                                e1.offsetX / this.#scale + this.#offset;
                            let dval = newPos - origPos;
                            if (e1.altKey !== TimelineConfig.data.enableSnap)
                                dval = this.#snapMove(
                                    points, origStart, firstStart + dval) - firstStart;
                            dragged = newPos != origPos;
                            for (const [ent, pos] of origPositions.entries()) {
                                ent.start = pos.start + dval;
                                ent.end = pos.end + dval;
                            }
                            this.#manager.requestRender();
                        };
                        onUp = () => {
                            this.#alignmentLine = null;
                            this.#manager.requestRender();
                            if (dragged) {
                                Source.markChanged(ChangeType.Times);
                            } else afterUp();
                        };
                    } else {
                        // drag-resize
                        const isStart = distL <= TimelineConfig.data.dragResizeArea;
                        const origVal = isStart ? first.start : last.end;
                        const firstStart = first.start;
                        const lastEnd = last.end;
                        let dragged = false;
                        onMove = (e1) => {
                            const newPos = 
                                e1.offsetX / this.#scale + this.#offset;
                            let val = origVal + newPos - origPos;
                            if (e1.altKey !== TimelineConfig.data.enableSnap)
                                val = this.#snapEnds(firstStart, lastEnd, val, isStart);
                            let newStart: number, newEnd: number;
                            if (isStart) {
                                newStart = Math.min(lastEnd, val);
                                newEnd = lastEnd;
                            } else {
                                newStart = firstStart;
                                newEnd = Math.max(firstStart, val);
                            }
                            // transform selection
                            const factor = (newEnd - newStart) / (lastEnd - firstStart);
                            for (const [ent, pos] of origPositions.entries()) {
                                ent.start = (pos.start - firstStart) * factor + newStart;
                                ent.end = (pos.end - firstStart) * factor + newStart;
                            }
                            dragged = val != origVal;
                            this.#keepPosInSafeArea(val);
                            this.#manager.requestRender();
                        };
                        onUp = () => {
                            this.#alignmentLine = null;
                            this.#manager.requestRender();
                            if (dragged) {
                                Source.markChanged(ChangeType.Times);
                            } else afterUp();
                        };
                    }
                }
            }
        };

        const handler = (ev: MouseEvent) => {
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
            if (Editing.getFocusedEntry() == one)
                Editing.startEditingFocusedEntry();
        }
    }

    #processWheel(tr: TranslatedWheelEvent, e: WheelEvent) {
        if (tr.isZoom) {
            const origPos = this.#offset + e.offsetX / this.#scale;
            this.setViewScale(this.#scale / Math.pow(1.03, tr.amount));
            this.setViewOffset(origPos - e.offsetX / this.#scale);
        } else {
            const amount = 
                tr.isTrackpad ? tr.amountX :
                tr.amountX == 0 ? tr.amountY : tr.amountX;
            this.setViewOffset(this.#offset + amount / this.#scale);
        }
    }

    #dispatchSelectionChanged() {
        Editing.clearFocus();
        Editing.selection.submitted = new Set(this.#selection);
        if (this.#selection.size == 1) {
            let array = [...this.#selection.values()];
            Editing.selection.currentGroup = array;
            Editing.selection.focused = array[0];
        } else {
            Editing.selection.currentGroup = [];
            Editing.selection.focused = null;
        }
        Editing.onSelectionChanged.dispatch(ChangeCause.Timeline);
    }

    #samplerMedia?: MMedia;

    async close() {
        assert(this.#samplerMedia !== undefined && !this.#samplerMedia.isClosed);
        await this.#samplerMedia?.close();
        this.#samplerMedia = undefined;
        this.#sampler = null;
        this.setCursorPosPassive(0);
        this.#manager.requestRender();
    }

    async load(rawurl: string) {
        if (this.#samplerMedia !== undefined && !this.#samplerMedia.isClosed) {
            await this.close();
        }
        if (DebugConfig.data.disableWaveform) return;

        this.#samplerMedia = await MMedia.open(rawurl);
        this.#sampler = await AudioSampler.open(
            this.#samplerMedia, TimelineConfig.data.waveformResolution);
        this.#sampler.onProgress = () => this.#manager.requestRender();
        this.setViewScale(Math.max(this.#width / this.#sampler.duration, 10));
        this.setViewOffset(0);
        this.#cursorPos = 0; // or setCursorPos?
        this.#requestedSampler = true;
        this.#manager.requestRender();
        console.log('Timeline.load: done');
    }

    // view & sampling

    get #maxPosition() {
        return this.#sampler 
            ? this.#sampler.duration 
            : Math.max(...Source.subs.entries.map((x) => x.end)) + 20;
    }

    #processSampler() {
        if (!this.#sampler) return;

        let start = this.#offset;
        let end = this.#offset + this.#width / this.#scale;
        const preload = Math.min(PRELOAD_MARGIN, (end - start) * PRELOAD_MARGIN_FACTOR);
        if (this.#sampler.isSampling) {
            if (this.#sampler.sampleProgress + preload < this.#offset 
                || this.#sampler.sampleProgress > end + preload) 
                    this.#sampler.tryCancelSampling();
            else if (this.#sampler.sampleEnd < end + preload) {
                // console.log('extending to', end);
                this.#sampler.extendSampling(end + preload);
            }
        }
        if (this.#sampler.isSampling)
            return;

        const resolution = this.#sampler.resolution;
        const i = Math.floor(this.#offset * resolution),
              i_end = Math.ceil(end * resolution);
        const subarray = this.#sampler.detail.subarray(i, i_end);
        const first0 = subarray.findIndex((x) => x == 0);
        if (Playback.isPlaying) {
            if (first0 < 0) {
                this.#requestedSampler = false;
                return;
            }
        } else {
            this.#requestedSampler = false;
            if (first0 < 0) {
                return;
            }
        }
        start = (first0 + i) / resolution;
        let end0 = subarray.findIndex((x, i) => i > first0 && x > 0);
        if (end0 > 0) end = (end0 + i) / resolution;

        end += preload;
        if (start < 0) start = 0;
        if (end > this.#sampler.duration) end = this.#sampler.duration;
        if (end <= start) {
            // console.log(start, '>=', end);
            return;
        }

        // console.log('sampling', start, end);
        this.#sampler.startSampling(start, end);
        this.#manager.requestRender();
    }

    setViewOffset(v: number) {
        if (v < 0) v = 0;
        v = Math.min(v, this.#maxPosition - this.#width / this.#scale);
        this.#manager.setScroll({x: v * this.#scale});
        this.#manager.requestRender();
        this.#requestedSampler = true;
    }

    setCursorPosPassive(pos: number) {
        if (pos == this.#cursorPos) return;
        if (pos < 0) pos = 0;
        pos = Math.min(pos, this.#maxPosition);
        this.#cursorPos = pos;
        this.#keepPosInSafeArea(pos);
        this.#manager.requestRender();
    }

    async setCursorPos(pos: number) {
        if (pos == this.#cursorPos) return;
        // this.setCursorPosPassive(pos);
        Playback.setPosition(pos);
    }

    setViewScale(v: number) {
        assert(v > 0);
        v = Math.max(v, this.#width / this.#maxPosition, 0.15);
        v = Math.min(v, 500);
        if (v == this.#scale) return;
        this.#scale = v;
        this.#manager.setContentRect({r: this.#maxPosition * this.#scale})
        this.#manager.requestRender();
        this.#requestedSampler = true;
    }

    requestRender() {
        this.#manager.requestRender();
    }

    // rendering
    // TODO: it's timeline rendering that takes the most CPU time when playing video,
    // and there's a lot we can do to optimize it.
    //
    // 1. Make the pointer a separate sprite, or equivalently, render waveform on a 
    //    background canvas
    // 2. Render incrementally when scrolling
    #renderWaveform(ctx: CanvasRenderingContext2D) {
        if (!this.#sampler) return;

        const resolution = this.#sampler.resolution;
        const pointsPerPixel = Math.max(1, Math.floor(resolution / this.#scale / devicePixelRatio));
        const step = 2 ** Math.floor(Math.log2(pointsPerPixel));
        const data = this.#sampler.data.getLevel(step);
        
        const start = Math.max(0, Math.floor(this.#offset * resolution / step));
        const end = Math.min(
            Math.ceil((this.#offset + this.#width / this.#scale) * resolution / step),
            data.length - 1);
        const width = 1 / resolution * this.#scale * step;
        const drawWidth = Math.max(1 / devicePixelRatio, width);

        let points: {x: number, y: number}[] = [];
        ctx.fillStyle = PENDING_WAVEFORM_COLOR;
        for (let i = start; i < end; i++) {
            const detail = this.#sampler.detail[i * step];
            const x = i * width;

            if (detail == 0) {
                ctx.fillRect(x, 0, drawWidth, this.#height);
                this.#requestedSampler = true;
            }

            let value = detail == 0 
                ? 0 
                : data[i] * (this.#height - HEADER_HEIGHT);
            const point = {x, y: value / 2};
            points.push(point);
        }
        const baseline = (this.#height - HEADER_HEIGHT) / 2 + HEADER_HEIGHT;
        ctx.beginPath();
        ctx.moveTo(start * width, baseline);
        points.forEach(
            ({x, y}) => ctx.lineTo(x, baseline + 0.5 / devicePixelRatio + y));
        ctx.lineTo(end * width, baseline);
        points.reverse().forEach(
            ({x, y}) => ctx.lineTo(x, baseline - 0.5 / devicePixelRatio - y));
        ctx.closePath();
        ctx.fillStyle = WAVEFORM_COLOR;
        ctx.fill();

        if (TimelineConfig.data.showDebug) {
            ctx.font = `${fontSize(8)}px Courier, monospace`;
            ctx.fillText(`using step=${step}`, this.#manager.scroll[0] + 120, 35);
        }

        if (this.#requestedSampler) this.#processSampler();
    }

    #renderRulerAndScroller(ctx: CanvasRenderingContext2D) {
        let line = (pos: number, height: number) => {
            ctx.beginPath();
            ctx.moveTo(pos, 0);
            ctx.lineTo(pos, height);
            ctx.stroke();
        };
        const [small, nMed, nBig] = getTick(this.#scale);
        const start = Math.floor(this.#offset / small / nBig) * small * nBig, 
              end = this.#offset + this.#width / this.#scale;
        const n = Math.ceil((end - start) / small);
        ctx.fillStyle = HEADER_BACK;
        ctx.fillRect(this.#manager.scroll[0], 0, this.#width, HEADER_HEIGHT);

        ctx.fillStyle = RULER_TEXT;
        ctx.lineWidth = 0.5;
        for (let i = 0; i < n; i++) {
            let t = start + i * small;
            let pos = Math.round(t * this.#scale);
            let height = 5;
            if (i % nBig == 0) {
                height = HEADER_HEIGHT;
                ctx.strokeStyle = LINE_BIG_COLOR;
                line(pos, this.#height);
            } else if (i % nMed == 0) {
                height = HEADER_HEIGHT * 0.5;
                ctx.strokeStyle = LINE_MED_COLOR;
                line(pos, this.#height);
            } else {
                height = HEADER_HEIGHT * 0.2;
            }
            ctx.strokeStyle = TICK_COLOR;
            line(pos, height);
        }
        ctx.font = font(HEADER_HEIGHT * 0.8);
        ctx.textBaseline = 'bottom';
        for (let t = start; t < end; t += nBig * small) {
            const pos = Math.round(t * this.#scale);
            ctx.fillText(SubtitleUtil.formatTimestamp(t, 2), 
                pos + 5, HEADER_HEIGHT);
        }
    }

    #renderTracks(ctx: CanvasRenderingContext2D) {
        ellipsisWidth = -1;
        ctx.textBaseline = 'top';
        ctx.font = font(TimelineConfig.data.fontSize);
        for (let ent of this.#getVisibleEntries()) {
            this.#getEntryPositions(ent).forEach((b) => {
                ctx.fillStyle = ent.label === 'none' 
                    ? ENTRY_BACK 
                    : LabelColor(ent.label, ENTRY_BACK_OPACITY);
                if (this.#selection.has(ent)) {
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
                        ellipsisText(ctx, b.channel!.text, b.w - 8), 
                        b.x + 4, b.y + 4);
                }
            });
        }
    }

    #renderCursor(ctx: CanvasRenderingContext2D) {
        let pos = this.#cursorPos * this.#scale;
        if (this.#selectBox) {
            ctx.fillStyle = BOXSELECT_BACK;
            ctx.strokeStyle = BOXSELECT_BORDER;
            ctx.lineWidth = BOXSELECT_WIDTH;
            ctx.beginPath();
            ctx.roundRect(
                this.#selectBox.x, this.#selectBox.y, 
                this.#selectBox.w, this.#selectBox.h, 2);
            ctx.fill();
            ctx.stroke();
        }
        if (this.#alignmentLine) {
            ctx.strokeStyle = ALIGNLINE_COLOR;
            ctx.lineWidth = ALIGNLINE_WIDTH;
            ctx.beginPath();
            ctx.moveTo(this.#alignmentLine.x - 5, this.#alignmentLine.y1 - 5);
            ctx.lineTo(this.#alignmentLine.x, this.#alignmentLine.y1);
            ctx.lineTo(this.#alignmentLine.x + 5, this.#alignmentLine.y1 - 5);

            ctx.moveTo(this.#alignmentLine.x - 5, this.#alignmentLine.y2 + 5);
            ctx.lineTo(this.#alignmentLine.x, this.#alignmentLine.y2);
            ctx.lineTo(this.#alignmentLine.x + 5, this.#alignmentLine.y2 + 5);

            ctx.moveTo(this.#alignmentLine.x, HEADER_HEIGHT);
            ctx.lineTo(this.#alignmentLine.x, this.#height);
            ctx.stroke();
        }

        // In-out area
        const area = Playback.playArea;
        const scrollX = this.#manager.scroll[0];
        if (area.start !== undefined) {
            const start = area.start * this.#scale;
            ctx.fillStyle = INOUT_AREA_OUTSIDE;
            ctx.fillRect(scrollX, 0, start - scrollX, this.#height);
        }
        if (area.end !== undefined) {
            const end = area.end * this.#scale;
            ctx.fillStyle = INOUT_AREA_OUTSIDE;
            ctx.fillRect(end, 0, this.#width + scrollX - end, this.#height);
        }

        ctx.fillStyle = CURSOR_COLOR;
        ctx.beginPath();
        ctx.moveTo(pos + 4, 0);
        ctx.lineTo(pos - 4, 0);
        ctx.lineTo(pos - 1, 10);
        ctx.lineTo(pos - 1, this.#height);
        ctx.lineTo(pos + 1, this.#height);
        ctx.lineTo(pos + 1, 10);
        ctx.lineTo(pos + 4, 0);
        ctx.fill();
    }

    #render(ctx: CanvasRenderingContext2D) {
        const t0 = Date.now();

        this.#renderRulerAndScroller(ctx);
        this.#renderWaveform(ctx);
        this.#renderTracks(ctx);
        this.#renderCursor(ctx);

        ctx.font = 'bold ' + font(TimelineConfig.data.fontSize);
        ctx.fillStyle = INOUT_TEXT;
        ctx.textBaseline = 'top';
        const area = Playback.playArea;
        const status = (area.start === undefined ? '' : 'IN ')
                     + (area.end === undefined ? '' : 'OUT ')
                     + (area.loop ? 'LOOP ' : '');
        const statusWidth = ctx.measureText(status).width;
        ctx.fillText(status, 
            this.#width - statusWidth - 5 + this.#manager.scroll[0], HEADER_HEIGHT + 5);
        
        if (!TimelineConfig.data.showDebug) return;
        ctx.translate(this.#manager.scroll[0], 0);
        ctx.font = `${fontSize(8)}px Courier, monospace`;
        ctx.fillStyle = theme.isDark ? 'white' : 'black';
        ctx.fillText(`offset=${this.#offset.toFixed(2)}`, 5, 15);
        ctx.fillText(`scale=${this.#scale.toFixed(2)}`, 5, 25);
        ctx.fillText(`render time=${(Date.now() - t0).toFixed(1)}`, 80, 15);
        ctx.fillText(`dpr=${devicePixelRatio}`, 80, 25);
    }
}