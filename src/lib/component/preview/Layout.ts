import { CanvasManager } from "../../CanvasManager";
import { Playback } from "../../frontend/Playback";
import { ChangeType, Source } from "../../frontend/Source";
import { SubtitleRenderer } from "./SubtitleRenderer";
import { MediaConfig } from "./Config";
import { MediaPlayer2 } from "./MediaPlayer2";

export class PreviewLayout {
    #manager: CanvasManager;
    #subsRenderer: SubtitleRenderer;

    get manager() {
        return this.#manager;
    }
    
    get subsRenderer() {
        return this.#subsRenderer;
    }

    constructor(public readonly canvas: HTMLCanvasElement) {
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
            Playback.player = await MediaPlayer2.create(this.#manager, rawurl, id);
        });
        Playback.onClose.bind(this, async () => {
            await Playback.player!.close();
            Playback.player = null;
        });
        Playback.onPositionChanged.bind(this, (pos) => {
            this.#subsRenderer.setTime(pos);
            this.#manager.requestRender();
        });
    }

    #render(ctx: CanvasRenderingContext2D) {
        Playback.player?.renderTo(ctx);
        this.#subsRenderer.render(ctx);
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