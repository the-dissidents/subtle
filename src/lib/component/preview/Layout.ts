import { CanvasManager } from "../../CanvasManager";
import { Playback } from "../../frontend/Playback";
import { ChangeType, Source } from "../../frontend/Source";
import { SubtitleRenderer } from "./SubtitleRenderer";
import { MediaConfig } from "./Config";
import { MediaPlayer } from "./MediaPlayer";

import { unwrapFunctionStore, _ } from "svelte-i18n";
import type { Positioning, SubtitleEntry } from "../../core/Subtitles.svelte";

const $_ = unwrapFunctionStore(_);

export class PreviewLayout {
    #manager: CanvasManager;
    #subsRenderer: SubtitleRenderer;

    get manager() {
        return this.#manager;
    }
    
    get subsRenderer() {
        return this.#subsRenderer;
    }

    constructor(
        readonly canvas: HTMLCanvasElement,
        readonly overlay: HTMLElement,
    ) {
        this.#manager = new CanvasManager(canvas);
        this.#manager.doNotPrescaleHighDPI = true;
        this.#manager.onDisplaySizeChanged.bind(this, () => this.#updateContentRect());
        this.#manager.setMaxZoom(MediaConfig.data.maxZoom);
        this.#manager.onUserZoom.bind(this, () => {
            this.#manager.setMaxZoom(MediaConfig.data.maxZoom);
            this.#updateContentRect();
        });
        this.#manager.renderer = (ctx) => this.#render(ctx);

        canvas.ondblclick = () => {
            this.#manager.setScroll({x: 0, y: 0});
            this.#manager.setScale(1);
        };

        this.#subsRenderer = new SubtitleRenderer(this.#manager, Source.subs);
        Source.onSubtitlesChanged.bind(this, (type) => {
            if (type == ChangeType.Metadata)
                this.#subsRenderer.updateResolution();
            if (type == ChangeType.Times || type == ChangeType.General)
                this.#subsRenderer.updateTimes();
            this.#manager.requestRender();
        });
        Source.onSubtitleObjectReload.bind(this, () => {
            this.#subsRenderer.changeSubtitles(Source.subs);
            this.#manager.requestRender();
        });

        Playback.onLoad.bind(this, async (rawurl, id) => {
            Playback.player = await MediaPlayer.create(this.#manager, rawurl, id);
        });
        Playback.onClose.bind(this, async () => {
            await Playback.player!.close();
            Playback.player = null;
        });
        Playback.onPositionChanged.bind(this, (pos) => {
            this.#subsRenderer.setTime(pos);
            this.#manager.requestRender();
        });

        this.#manager.onMouseMove.bind(this, (ev) => {
            let [x, y] = this.#manager.convertPosition(
                'offset', 'canvas', ev.offsetX, ev.offsetY);
            x *= devicePixelRatio;
            y *= devicePixelRatio;
            const h = this.#subsRenderer.layout.find((b) => 
                b.x <= x && b.y <= y && b.x + b.line.width >= x && b.y + b.line.height >= y);
            if (h !== this.#hovering) {
                if (h) {
                    this.#hovering = h.entry;
                    this.#startPos = [h.refX, h.refY];
                } else {
                    this.#hovering = undefined;
                }
                this.#manager.requestRender();
            }
        });

        this.#manager.canBeginDrag = (ev) => {
            if (this.#hovering) {
                this.#startMousePos = [ev.offsetX, ev.offsetY];
                this.#originalPositioning = this.#hovering.positioning;
                return true;
            }
            return false;
        };

        this.#manager.onDrag.bind(this, (ox, oy) => {
            const dx = ox - this.#startMousePos[0];
            const dy = oy - this.#startMousePos[1];
            const scale = devicePixelRatio / this.#subsRenderer.scale / this.manager.scale;
            this.#hovering!.positioning = {
                type: 'absolute',
                x: Math.round(this.#startPos[0] + dx * scale),
                y: Math.round(this.#startPos[1] + dy * scale),
            };
            this.manager.requestRender();
        });

        this.#manager.onDragEnd.bind(this, () => {
            Source.markChanged(ChangeType.InPlace, $_('c.positioning'));
        });

        this.manager.onDragInterrupted.bind(this, () => {
            this.#hovering!.positioning = this.#originalPositioning;
        });
    }

    #hovering?: SubtitleEntry;
    #startPos: [number, number] = [0, 0];
    #startMousePos: [number, number] = [0, 0];
    #originalPositioning: Positioning = null;
    #debug = '';

    #render(ctx: CanvasRenderingContext2D) {
        ctx.fillStyle = 'white';
        ctx.font = '30px sans-serif'
        ctx.fillText(this.#debug, 100, 100);

        Playback.player?.renderTo(ctx);
        this.#subsRenderer.render(ctx);

        if (this.#hovering) {
            ctx.strokeStyle = '2px solid white';
            this.#subsRenderer.layout
                .filter((x) => x.entry == this.#hovering)
                .forEach((box) => {
                    ctx.strokeRect(box.x, box.y, box.line.width, box.line.height);
                });
        }
    }

    #updateContentRect() {
        const [w, h] = this.#manager.size;
        const scale = this.#manager.scale;
        const wmargin = w / scale / 2;
        const hmargin = h / scale / 2;
        this.#manager.setContentRect({
            l: -wmargin, t: -hmargin, r: w + wmargin, b: h + hmargin
        });
    }
}