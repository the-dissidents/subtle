import { Debug } from "../../Debug";
import type { CanvasManager } from "../../CanvasManager";
import { Filter, type SimpleMetricFilter } from "../../core/Filter";
import { SubtitleEntry } from "../../core/Subtitles.svelte";
import { Editing, getSelectMode, SelectMode } from "../../frontend/Editing";
import { ChangeCause, Source } from "../../frontend/Source";
import type { PopupHandler } from "../../ui/Popup.svelte";

import type { TableLayout, TextLayout } from "./Layout.svelte";
import { TableConfig } from "./Config";

import { _ } from 'svelte-i18n';

import { get } from "svelte/store";
import { Playback } from "../../frontend/Playback";
import { Frontend } from "../../frontend/Frontend";
import { contextMenu } from "./Menu";

export const SubtitleTableHandle = {
    processDoubleClick: undefined as (undefined | (() => Promise<void>)),
};

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
        this.manager.onMouseMove.bind(this, (ev) => this.#onMouseMove(ev));
        this.manager.onMouseDown.bind(this, (ev) => this.#onMouseDown(ev));
        this.manager.onDrag.bind(this, (x, y) => this.#onDrag(x, y));
        this.manager.onDragEnd.bind(this, () => this.#onDragEnd());

        Editing.onSelectionChanged.bind(this, () => this.manager.requestRender());

        Editing.onKeepEntryAtPosition.bind(this, (ent, old) => {
            if (this.manager.dragType !== 'none') return;

            const posNew = layout.lineMap.get(ent);
            const posOld = layout.lineMap.get(old);
            if (posNew === undefined || posOld === undefined) {
                // Debug.warn('?!row', ent, old);
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
                    // Debug.warn('?!row', ent);
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

        SubtitleTableHandle.processDoubleClick = () => this.#handleDoubleClick();

        Source.onSubtitleObjectReload.bind(this, (newFile) => {
            const state = Source.subs.metadata.uiState;
            if (!state || !newFile) return;
            requestAnimationFrame(() => {
                if (state.tableScrollIndex >= layout.lines.length) return;
                const entryLayout = layout.lines[state.tableScrollIndex];
                this.manager.setScroll({y: entryLayout.line * layout.lineHeight})
                this.manager.requestRender();
            })
        });
        Source.onSubtitleWillSave.bind(this, () => {
            const i = this.#getLineFromOffset(0);
            const result = layout.lines.findIndex((x) => x.line > i);
            Source.subs.metadata.uiState.tableScrollIndex = Math.max(0, result);
        });

        this.manager.canvas.addEventListener('dblclick', () => this.#handleDoubleClick());
        this.manager.canvas.addEventListener('contextmenu', (ev) => {
            ev.preventDefault();
            contextMenu();
        });
    }
    
    focus() {
        Frontend.uiFocus.set('Table');
    }

    async #handleDoubleClick() {
        this.focus();
        const focused = Editing.getFocusedEntry();
        Debug.assert(focused !== null);
        if (focused == 'virtual') {
            if (TableConfig.data.doubleClickStartEdit)
            Editing.startEditingNewVirtualEntry();
        } else {
            switch (TableConfig.data.doubleClickPlaybackBehavior) {
                case 'none': break;
                case 'seek':
                    Playback.setPosition(focused.start);
                    break;
                case 'play':
                    await Playback.forceSetPosition(focused.start);
                    if (Playback.loaded) Playback.play(true);
                    break;
                default:
                    Debug.never(<never>TableConfig.data.doubleClickPlaybackBehavior);
            }
            if (TableConfig.data.doubleClickStartEdit)
                Editing.startEditingFocusedEntry();
        }
    }

    #getLineFromOffset(y: number) {
        return (y / this.manager.scale + this.manager.scroll[1] - this.layout.headerHeight) 
            / this.layout.lineHeight;
    }

    #getTextFromLineIndex(i: number) {
        let result: [TextLayout, SubtitleEntry] | [undefined, undefined] = [undefined, undefined];
        if (this.layout.totalLines < i) return result;
        outer: for (const entryLayout of this.layout.lines) {
            for (const text of entryLayout.texts) {
                if (text.line > i) break outer;
                result = [text, entryLayout.entry];
            }
        }
        return result;
    }

    #onMouseMove(ev: MouseEvent) {
        if (ev.offsetY < this.layout.headerHeight / this.manager.scale) return;
        
        const [cx, _cy] = this.manager.convertPosition('offset', 'canvas', ev.offsetX, ev.offsetY);
        const channelColumnStart = this.layout.channelColumns[0].layout?.position ?? Infinity;
        const currentLine = this.#getLineFromOffset(ev.offsetY);
        const currentText = cx > channelColumnStart 
            ? this.#getTextFromLineIndex(currentLine)?.[0]
            : undefined;

        if (currentText?.failed !== this.currentFails) {
            this.currentFails = currentText?.failed ?? [];
            if (this.validationMessagePopup.isOpen!())
                this.validationMessagePopup.close!();
            if (this.currentFails.length > 0) {
                Debug.assert(currentText !== undefined);
                this.popupMessage = 
                    get(_)('table.requirement-not-met', {values: {n: this.currentFails.length}})
                    + '\n'
                    + this.currentFails.map((x) => Filter.describe(x)).join('\n');
                const [left, top] = this.manager.convertPosition('canvas', 'client', 
                    channelColumnStart, 
                    currentText.line * this.layout.lineHeight + this.layout.headerHeight);
                this.validationMessagePopup.open!({left, top, width: 0, 
                    height: currentText.height * 0.5 * this.layout.lineHeight / this.manager.scale});
            }
        }
    }

    #onMouseDown(ev: MouseEvent) {
        this.focus();
        // don't do anything if mouse is within header area
        if (ev.offsetY < this.layout.headerHeight / this.manager.scale) return;

        if (ev.button == 0) {
            this.currentLine = this.#getLineFromOffset(ev.offsetY);
            if (this.currentLine > this.layout.totalLines) {
                Editing.selectVirtualEntry();
                return;
            } else {
                const [_, entry] = this.#getTextFromLineIndex(this.currentLine);
                if (entry) Editing.toggleEntry(entry, getSelectMode(ev), ChangeCause.UIList);
            }
        }
    }

    #requestAutoScroll() {
        const doAutoScroll = () => {
            if (this.autoScrollY == 0) {
                this.lastAnimateFrameTime = -1;
                return;
            }
            const time = performance.now();
            this.manager.setScroll({ y: this.manager.scroll[1] 
                + this.autoScrollY * (time - this.lastAnimateFrameTime) * 0.001 });
            this.lastAnimateFrameTime = time;

            const line = this.#getLineFromOffset((this.autoScrollY < 0) ? 0 : this.manager.size[1]);
            if (line != this.currentLine && this.layout.lines.length > 0) {
                this.currentLine = line;
                const [_, entry] = this.#getTextFromLineIndex(line);
                if (entry) Editing.selectEntry(entry, SelectMode.Sequence);
            }

            this.manager.requestRender();
            requestAnimationFrame(() => doAutoScroll());
        }
        if (this.lastAnimateFrameTime < 0)
            this.lastAnimateFrameTime = performance.now();
        requestAnimationFrame(() => doAutoScroll());
    }

    #onDrag(_: number, offsetY: number) {
        function powWithSign(x: number, y: number) {
            return Math.sign(x) * Math.pow(Math.abs(x), y);
        }

        // auto scroll if pointing outside
        const speed = TableConfig.data.autoScrollSpeed;
        const exponent = TableConfig.data.autoScrollExponent;
        if (offsetY < this.layout.headerHeight) {
            if (this.autoScrollY == 0) this.#requestAutoScroll();
            this.autoScrollY = powWithSign((offsetY - this.layout.headerHeight) * speed, exponent);
        } else if (offsetY > this.manager.size[1]) {
            if (this.autoScrollY == 0) this.#requestAutoScroll();
            this.autoScrollY = powWithSign((offsetY - this.manager.size[1]) * speed, exponent);
        } else {
            this.autoScrollY = 0;
        }

        const line = this.#getLineFromOffset(offsetY);
        if (line != this.currentLine && this.layout.lines.length > 0) {
            this.currentLine = line;
            const [_, entry] = this.#getTextFromLineIndex(line);
            if (entry) Editing.selectEntry(entry, SelectMode.Sequence);
        }
    }

    #onDragEnd() {
        this.autoScrollY = 0;
    }
}
