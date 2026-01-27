import { get } from "svelte/store";
import { CanvasManager } from "../../CanvasManager";
import { InterfaceConfig, MainConfig } from "../../config/Groups";
import { Filter, Metrics, type SimpleMetricFilter } from "../../core/Filter";
import type { SubtitleEntry, SubtitleStyle } from "../../core/Subtitles.svelte";
import { Debug } from "../../Debug";
import { ChangeType, Source } from "../../frontend/Source";
import { TableConfig } from "./Config";
import { _ } from "svelte-i18n";
import { applyStyle, layoutText, toCSSStyle, WarpStyle, type EvaluatedStyle, type Line } from "../../details/TextLayout";

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

export type ChannelLayout = {
    style: SubtitleStyle,
    line: number, height: number,
    failed: SimpleMetricFilter[],
    cells: Line[][],
};

type LineLayout = {
    entry: SubtitleEntry, 
    line: number, 
    height: number,
    texts: ChannelLayout[],
    cells: Line[][],
}

export class TableLayout {
    readonly linePadding   = $derived(InterfaceConfig.data.fontSize * 0.35);
    readonly lineHeight    = $derived(InterfaceConfig.data.fontSize + this.linePadding * 2);
    readonly headerHeight  = $derived(this.lineHeight);
    readonly cellPadding   = $derived(InterfaceConfig.data.fontSize * 0.4);

    readonly baseStyle: EvaluatedStyle = $derived({
        size: InterfaceConfig.data.fontSize,
        fontFamily: InterfaceConfig.data.fontFamily
    });
    readonly baseStyleCSS = $derived(toCSSStyle(this.baseStyle));

    readonly baseStyleMonospace: EvaluatedStyle = $derived({
        size: InterfaceConfig.data.fontSize,
        fontFamily: InterfaceConfig.data.monospaceFontFamily
    });
    readonly baseStyleMonospaceCSS = $derived(toCSSStyle(this.baseStyleMonospace));

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
        this.manager.onDisplaySizeChanged.bind(this, () => {
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
        });

        $inspect(this.baseStyleCSS);
    }

    layout(ctx: CanvasRenderingContext2D) {
        this.requestedLayout = false;
        const startTime = performance.now();
        ctx.resetTransform();
        ctx.scale(devicePixelRatio, devicePixelRatio);

        applyStyle(this.baseStyleCSS, ctx);

        for (const col of [...this.entryColumns, ...this.channelColumns]) {
            const metric = Metrics[col.metric];
            const name = metric.shortName();
            col.layout = {
                name, align: 'start',
                position: -1, 
                width: ctx.measureText(name).width + this.cellPadding * 2, 
                textX: -1
            };
        }

        this.lines = []; this.totalLines = 0;
        for (const entry of Source.subs.entries) {
            let entryColumnsHeight = 1;

            let cells = this.entryColumns.map((col) => {
                const metric = Metrics[col.metric];
                const value = metric.textValue(entry, Source.subs.defaultStyle);
                const layout = layoutText(value, ctx, {
                    baseStyle: metric.type.isMonospace
                        ? this.baseStyleMonospace : this.baseStyle,
                    warpStyle: WarpStyle.NoWrap,
                    disableSize: true,
                });
                const w = Math.max(...layout.map((x) => x.width)) + this.cellPadding * 2;

                col.layout!.width = Math.max(col.layout!.width, w);
                entryColumnsHeight = Math.max(entryColumnsHeight, layout.length);
                return layout;
            });

            let entryHeight = 0;
            const texts: ChannelLayout[] = [];
            for (const style of Source.subs.styles) {
                const text = entry.texts.get(style);
                if (text === undefined) continue;

                let lineHeight = 1;
                let cells = this.channelColumns.map((col) => {
                    const value = Metrics[col.metric].textValue(entry, style);

                    const layout = layoutText(value, ctx, {
                        baseStyle: this.baseStyle,
                        warpStyle: WarpStyle.NoWrap,
                        disableSize: true,
                    });
                    const w = Math.max(...layout.map((x) => x.width)) + this.cellPadding * 2;

                    col.layout!.width = Math.max(col.layout!.width, w);
                    lineHeight = Math.max(lineHeight, layout.length);
                    return layout;
                });

                texts.push({
                    style, height: lineHeight,
                    line: this.totalLines + entryHeight, cells,
                    failed: style.validator === null 
                        ? [] : Filter.evaluate(style.validator, entry, style).failed
                });
                entryHeight += lineHeight;
            }

            this.lines.push({entry, line: this.totalLines, height: entryHeight, texts, cells});
            this.lineMap.set(entry, {line: this.totalLines, height: entryHeight});
            this.totalLines += Math.max(entryHeight, entryColumnsHeight);
        }

        applyStyle(this.baseStyleMonospaceCSS, ctx);

        let pos = 0;
        this.indexColumnLayout.position = 0;
        this.indexColumnLayout.width = this.cellPadding * 2 
            + ctx.measureText(`${Math.max(this.lines.length+1, 100)}`).width;
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
        const elapsed = performance.now() - startTime;
        if (elapsed > 50)
            Debug.debug(`layout took ${elapsed.toFixed(1)}ms`);
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
        Source.markChanged(ChangeType.View, get(_)('c.column-view'));
        this.requestedLayout = true;
        this.manager.requestRender();
    }
}