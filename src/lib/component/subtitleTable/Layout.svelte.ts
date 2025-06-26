import { CanvasManager } from "../../CanvasManager";
import { InterfaceConfig, MainConfig } from "../../config/Groups";
import { evaluateFilter, Metrics, type SimpleMetricFilter } from "../../core/Filter";
import type { SubtitleEntry, SubtitleStyle } from "../../core/Subtitles.svelte";
import { Debug } from "../../Debug";
import { ChangeType, Source } from "../../frontend/Source";
import { TableConfig } from "./Config";

export type Column = {
  metric: keyof typeof Metrics,
  layout?: ColumnLayout
};

type ColumnLayout = {
  name: string,
  align: 'start' | 'center' | 'end',
  position: number,
  textX: number
  width: number
};

export type TextLayout = {
  style: SubtitleStyle,
  text: string,
  line: number, height: number,
  failed: SimpleMetricFilter[],
};

type LineLayout = {
    entry: SubtitleEntry, 
    line: number, 
    height: number,
    texts: TextLayout[]
}

export class TableLayout {
    readonly linePadding   = $derived(InterfaceConfig.data.fontSize * 0.35);
    readonly lineHeight    = $derived(InterfaceConfig.data.fontSize + this.linePadding * 2);
    readonly headerHeight  = $derived(this.lineHeight);
    readonly cellPadding   = $derived(InterfaceConfig.data.fontSize * 0.4);
    readonly font = $derived(
        `${InterfaceConfig.data.fontSize}px ${InterfaceConfig.data.fontFamily}`);

    manager: CanvasManager;
    entryColumns = $state<Column[]>([{ metric: 'startTime' }, { metric: 'endTime' }]);
    channelColumns = $state<Column[]>([{ metric: 'style' }, { metric: 'content' }]);
    indexColumnLayout: ColumnLayout = 
        { name: '#', align: 'end', position: 0, textX: -1, width: -1 };

    lines: LineLayout[] = [];
    lineMap = new WeakMap<SubtitleEntry, {line: number, height: number}>();
    totalLines = 0;

    requestedLayout = true;

    constructor(canvas: HTMLCanvasElement) {
        this.manager = new CanvasManager(canvas);
        this.manager.onDisplaySizeChanged.bind(this, (w, h) => {
            this.manager.requestRender();
        });
        this.manager.canBeginDrag = (ev) => ev.offsetY > this.headerHeight / this.manager.scale;

        MainConfig.hook(
            () => [InterfaceConfig.data.fontSize, InterfaceConfig.data.fontFamily], 
            () => {
                this.requestedLayout = true;
                this.manager.requestRender();
            });
        MainConfig.hook(
            () => TableConfig.data.maxZoom, 
            (zoom) => this.manager.setMaxZoom(zoom));

        Source.onSubtitleObjectReload.bind(this, () => {
            this.#updateColumns();
        });

        Source.onSubtitlesChanged.bind(this, (t) => {
            // TODO: can we optimize this by not re-layouting everything on every edit?
            if (t == ChangeType.View) {
                // the only way columns are updated is through the subtitle table
                // updateColumns();
            } else if (t !== ChangeType.Metadata) {
                this.requestedLayout = true;
                this.manager.requestRender();
            }
        })
    }

    layout(cxt: CanvasRenderingContext2D) {
        this.requestedLayout = false;
        const startTime = performance.now();
        cxt.resetTransform();
        cxt.scale(devicePixelRatio, devicePixelRatio);
        cxt.font = this.font;

        for (const col of [...this.entryColumns, ...this.channelColumns]) {
            const metric = Metrics[col.metric];
            const name = metric.shortName();
            col.layout = {
            name, align: 'start',
            position: -1, 
            width: cxt.measureText(name).width + this.cellPadding * 2, 
            textX: -1
            };
        }

        this.lines = []; this.totalLines = 0;
        for (const entry of Source.subs.entries) {
            for (const col of this.entryColumns) {
                // FIXME: we assume no string metrics here
                const metric = Metrics[col.metric];
                const value = metric.stringValue(entry, Source.subs.defaultStyle);
                col.layout!.width = Math.max(col.layout!.width, 
                    cxt.measureText(value).width + this.cellPadding * 2);
            }

            let entryHeight = 0;
            const texts: TextLayout[] = [];
            for (const style of Source.subs.styles) {
                const text = entry.texts.get(style);
                if (text === undefined) continue;

                let lineHeight = 1;
                for (const col of this.channelColumns) {
                    const value = Metrics[col.metric].stringValue(entry, style);
                    const splitLines = value.split('\n');
                    const w = Math.max(...splitLines.map((x) => cxt.measureText(x).width)) 
                        + this.cellPadding * 2;
                    col.layout!.width = Math.max(col.layout!.width, w);
                    lineHeight = Math.max(lineHeight, splitLines.length);
                }

                texts.push({
                    style, text: text,
                    height: lineHeight,
                    line: this.totalLines + entryHeight,
                    failed: style.validator === null 
                    ? [] : evaluateFilter(style.validator, entry, style).failed
                });
                entryHeight += lineHeight;
            }
            this.lines.push({entry, line: this.totalLines, height: entryHeight, texts});
            this.lineMap.set(entry, {line: this.totalLines, height: entryHeight});
            this.totalLines += entryHeight;
        }

        let pos = 0;
        this.indexColumnLayout.position = 0;
        this.indexColumnLayout.width = this.cellPadding * 2 
            + cxt.measureText(`${Math.max(this.lines.length+1, 100)}`).width;
        this.indexColumnLayout.textX = this.indexColumnLayout.width - this.cellPadding;
        pos += this.indexColumnLayout.width;

        for (const col of [...this.entryColumns, ...this.channelColumns]) {
            col.layout!.position = pos;
            col.layout!.textX = 
                  col.layout!.align == 'start'  ? col.layout!.position + this.cellPadding
                : col.layout!.align == 'end'    ? col.layout!.position + col.layout!.width - this.cellPadding
                : col.layout!.align == 'center' ? col.layout!.position + col.layout!.width * 0.5
                : Debug.never(col.layout!.align);
            pos += col.layout!.width;
        }

        this.manager.setContentRect({
            r: pos + this.manager.scrollerSize,
            b: (this.totalLines + 1) * this.lineHeight + this.headerHeight + this.manager.scrollerSize
            // add 1 for virtual entry
        });
        Debug.debug(`layout took ${performance.now() - startTime}ms`);
    }

    #updateColumns() {
        this.entryColumns = Source.subs.view.perEntryColumns
            .map((x) => ({metric: x as keyof typeof Metrics, layout: undefined}));
        this.channelColumns = Source.subs.view.perChannelColumns
            .map((x) => ({metric: x as keyof typeof Metrics, layout: undefined}));
        this.requestedLayout = true;
        this.manager.requestRender();
    }

    changeColumns() {
        Source.subs.view.perEntryColumns = this.entryColumns.map((x) => x.metric);
        Source.subs.view.perChannelColumns = this.channelColumns.map((x) => x.metric);
        Source.markChanged(ChangeType.View);
        this.requestedLayout = true;
        this.manager.requestRender();
    }
}