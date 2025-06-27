import { Debug } from "../../Debug";
import type { CanvasManager } from "../../CanvasManager";
import { filterDescription, type SimpleMetricFilter } from "../../core/Filter";
import { SubtitleEntry } from "../../core/Subtitles.svelte";
import { Editing, getSelectMode, SelectMode } from "../../frontend/Editing";
import { Interface } from "../../frontend/Interface";
import { ChangeCause } from "../../frontend/Source";
import type { PopupHandler } from "../../ui/Popup.svelte";

import type { TableLayout, TextLayout } from "./Layout.svelte";
import { TableConfig } from "./Config";

import { _ } from 'svelte-i18n';
import { get } from "svelte/store";

export class TableInput {
    private manager: CanvasManager;
    private currentFails: SimpleMetricFilter[] = [];

    private currentLine = -1;
    private autoScrollY = 0;
    private lastAnimateFrameTime = -1;

    popupMessage = $state('');

    constructor(
        private layout: TableLayout,
        private validationMessagePopup: PopupHandler,
    ) {
        this.manager = layout.manager;
        this.manager.onMouseMove.bind(this, (ev) => this.onMouseMove(ev));
        this.manager.onMouseDown.bind(this, (ev) => this.onMouseDown(ev));
        this.manager.onDrag.bind(this, (x, y) => this.onDrag(x, y));

        Editing.onSelectionChanged.bind(this, () => this.manager.requestRender());

        Editing.onKeepEntryAtPosition.bind(this, (ent, old) => {
            if (this.manager.dragType !== 'none') return;

            const posNew = layout.lineMap.get(ent);
            const posOld = layout.lineMap.get(old);
            if (posNew === undefined || posOld === undefined) {
                Debug.warn('?!row', ent, old);
                return;
            }
            const sy = (posNew.line - posOld.line) * layout.lineHeight + this.manager.scroll[1];
            layout.manager.setScroll({y: sy})
            Editing.onKeepEntryInView.dispatch(ent);
        });

        Editing.onKeepEntryInView.bind(this, (ent) => {
            // otherwise dragging outside/auto scrolling becomes unusable
            if (this.manager.dragType !== 'none') return;

            if (ent instanceof SubtitleEntry) {
                const pos = layout.lineMap.get(ent);
                if (pos === undefined) {
                    Debug.warn('?!row', ent);
                    return;
                }
                const sy = Math.max(
                    (pos.line + pos.height + 1) * layout.lineHeight 
                        - this.manager.size[1] / this.manager.scale, 
                    Math.min(this.manager.scroll[1], pos.line * layout.lineHeight));
                this.manager.setScroll({y: sy})
                this.manager.requestRender();
            } else {
                const sy = this.manager.contentRect.b - this.manager.size[1] / this.manager.scale;
                this.manager.setScroll({y: sy})
                this.manager.requestRender();
            }
        });
    }

    #getLineFromOffset(y: number) {
        return (y / this.manager.scale + this.manager.scroll[1] - this.layout.headerHeight) 
            / this.layout.lineHeight;
    }
    
    focus() {
        Interface.uiFocus.set('Table');
    }

    onMouseMove(ev: MouseEvent) {
        if (ev.offsetY < this.layout.headerHeight / this.manager.scale) return;
        
        const [cx, cy] = this.manager.convertPosition('offset', 'canvas', ev.offsetX, ev.offsetY);
        const currentLine = Math.floor((cy - this.layout.headerHeight) / this.layout.lineHeight);

        let channelColumnStart = this.layout.channelColumns[0].layout?.position ?? Infinity;
        let currentText: TextLayout | undefined;
        if (currentLine <= this.layout.totalLines && cx > channelColumnStart) {
            outer: for (const {texts} of this.layout.lines) {
                for (const text of texts) {
                    if (currentLine < text.line)
                    break outer;
                    currentText = text;
                }
            }
        }

        if (currentText?.failed !== this.currentFails) {
            this.currentFails = currentText?.failed ?? [];
            if (this.validationMessagePopup.isOpen!())
                this.validationMessagePopup.close!();
            if (this.currentFails.length > 0) {
                Debug.assert(currentText !== undefined);
                this.popupMessage = 
                    get(_)('table.requirement-not-met', {values: {n: this.currentFails.length}})
                    + '\n'
                    + this.currentFails.map(filterDescription).join('\n');
                let [left, top] = this.manager.convertPosition('canvas', 'client', 
                    channelColumnStart, 
                    currentText.line * this.layout.lineHeight + this.layout.headerHeight);
                this.validationMessagePopup.open!({left, top, width: 0, 
                    height: currentText.height * 0.5 * this.layout.lineHeight / this.manager.scale});
            }
        }
    }

    onMouseDown(ev: MouseEvent) {
        this.focus();
        // don't do anything if mouse is within header area
        if (ev.offsetY < this.layout.headerHeight / this.manager.scale) return;

        if (ev.button == 0) {
            this.currentLine = this.#getLineFromOffset(ev.offsetY);
            if (this.currentLine > this.layout.totalLines) {
                Editing.selectVirtualEntry();
                return;
            } else if (this.layout.lines.length > 0) {
                let i = 1;
                for (; i < this.layout.lines.length 
                    && this.layout.lines[i].line <= this.currentLine; i++);
                Editing.toggleEntry(this.layout.lines[i-1].entry, getSelectMode(ev), ChangeCause.UIList);
            }
        }
    }

    requestAutoScroll() {
        const doAutoScroll = () => {
            if (this.autoScrollY == 0) {
                this.lastAnimateFrameTime = -1;
                return;
            }
            let time = performance.now();
            this.manager.setScroll({ y: this.manager.scroll[1] 
                + this.autoScrollY * (time - this.lastAnimateFrameTime) * 0.001 });
            this.lastAnimateFrameTime = time;

            const line = this.#getLineFromOffset((this.autoScrollY < 0) ? 0 : this.manager.size[1]);
            if (line != this.currentLine && this.layout.lines.length > 0) {
                this.currentLine = line;
                let i = 1;
                for (; i < this.layout.lines.length 
                    && this.layout.lines[i].line < this.currentLine; i++);
                Editing.selectEntry(this.layout.lines[i-1].entry, SelectMode.Sequence);
            }

            this.manager.requestRender();
            requestAnimationFrame(() => doAutoScroll());
        }
        if (this.lastAnimateFrameTime < 0)
            this.lastAnimateFrameTime = performance.now();
        requestAnimationFrame(() => doAutoScroll());
    }

    onDrag(_: number, offsetY: number) {
        function powWithSign(x: number, y: number) {
            return Math.sign(x) * Math.pow(Math.abs(x), y);
        }

        // auto scroll if pointing outside
        const speed = TableConfig.data.autoScrollSpeed;
        const exponent = TableConfig.data.autoScrollExponent;
        if (offsetY < this.layout.headerHeight) {
            if (this.autoScrollY == 0) this.requestAutoScroll();
            this.autoScrollY = powWithSign((offsetY - this.layout.headerHeight) * speed, exponent);
        } else if (offsetY > this.manager.size[1]) {
            if (this.autoScrollY == 0) this.requestAutoScroll();
            this.autoScrollY = powWithSign((offsetY - this.manager.size[1]) * speed, exponent);
        } else {
            this.autoScrollY = 0;
        }

        const line = this.#getLineFromOffset(offsetY);
        if (line != this.currentLine && this.layout.lines.length > 0) {
            this.currentLine = line;
            let i = 1;
            for (; i < this.layout.lines.length 
                && this.layout.lines[i].line < this.currentLine; i++);
            Editing.selectEntry(this.layout.lines[i-1].entry, SelectMode.Sequence);
        }
    }
}