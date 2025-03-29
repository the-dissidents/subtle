import { assert } from "./Basic";
import { InterfaceConfig } from "./config/Groups";
import { EventHost, translateWheelEvent } from "./frontend/Frontend";
import { theme } from "./Theming.svelte";

const scrollerColorRgb = () => theme.isDark ? '255 255 255' : '0 0 0';

const scrollerSize = 6;
const scrollerFade = 1500;
const scrollerFadeStart = 1000;

export class CanvasManager {
    #cxt: CanvasRenderingContext2D;
    #requestedRender = false;
    #width = 0; #height = 0;

    #scale = 1;
    #maxZoom = 1;
    #scrollX = 0; #scrollY = 0;
    #maxX = -1; #maxY = -1;

    #dragStartX = 0; #dragStartY = 0;
    #dragStartScrollX = 0; #dragStartScrollY = 0;
    #centerX: number | undefined;
    #centerY: number | undefined;

    #dragType: 'none' | 'custom' | 'vscroll' | 'hscroll' = 'none';
    #scrollerHighlight: 'v' | 'h' | 'none' = 'none';
    #scrollerFadeStartTime = 0;

    readonly onDisplaySizeChanged = 
        new EventHost<[w: number, h: number, rw: number, rh: number]>();
    readonly onMouseDown =
        new EventHost<[ev: MouseEvent]>();
    // readonly onMouseMove =
    //     new EventHost<[ev: MouseEvent]>();
    readonly onDrag =
        new EventHost<[offsetX: number, offsetY: number, ev: MouseEvent]>();

    renderer?: (ctx: CanvasRenderingContext2D) => void;
    doNotPrescaleHighDPI = false;

    get context() {
        return this.#cxt;
    }

    get size(): readonly [number, number] {
        return [this.#width, this.#height];
    }

    get physicalSize(): readonly [number, number] {
        return [
            this.#width * window.devicePixelRatio, 
            this.#height * window.devicePixelRatio
        ];
    }

    get contentSize(): readonly [number, number] {
        return [
            this.#maxX < 0 ? this.#width : this.#maxX,
            this.#maxY < 0 ? this.#height : this.#maxY,
        ];
    }

    setContentSize(p: {w?: number, h?: number}) {
        if (p.w !== undefined) this.#maxX = p.w;
        if (p.h !== undefined) this.#maxY = p.h;
        this.#constrainScroll();
        this.requestRender();
    }

    get scroll(): readonly [number, number] {
        return [this.#scrollX, this.#scrollY];
    }
    
    setScroll(p: {x?: number, y?: number}) {
        if (p.x !== undefined) this.#scrollX = p.x;
        if (p.y !== undefined) this.#scrollY = p.y;
        this.#constrainScroll();
        this.requestRender();
    }

    get scale() {
        return this.#scale;
    }

    setScale(s: number) {
        assert(s > 0);
        this.#scale = s;
        this.#constrainScroll();
        this.requestRender();
    }

    get maxZoom() {
        return this.#maxZoom;
    }

    setMaxZoom(x: number) {
        assert(x > 0);
        this.#maxZoom = x;
        if (this.#scale > x)
            this.setScale(x);
    }

    get hasScrollers(): readonly [boolean, boolean] {
        return [
            this.#maxX > this.#width / this.#scale,
            this.#maxY > this.#height / this.#scale
        ];
    }

    get scrollerSize() {
        return scrollerSize;
    }

    get dragType() {
        return this.#dragType;
    }

    constructor(public canvas: HTMLCanvasElement)  {
        let context = canvas.getContext('2d', { alpha: false });
        assert(context !== null);
        this.#cxt = context;

        new ResizeObserver(() => this.#update()).observe(canvas);
        this.#update();
        this.requestRender();

        canvas.addEventListener('mousedown', (ev) => this.#onMouseDown(ev));
        canvas.addEventListener('mousemove', (ev) => this.#onMouseMove(ev));
        canvas.addEventListener('wheel', (ev) => this.#onMouseWheel(ev));
    }

    requestRender() {
        if (this.#requestedRender) return;
        this.#requestedRender = true;
        requestAnimationFrame(() => this.#render());
    }

    get #hscrollerLength () { 
        return Math.max(InterfaceConfig.data.minScrollerLength, 
            this.#width ** 2 / this.#scale / this.#maxX);
    }
      
    get #vscrollerLength () { 
        return Math.max(InterfaceConfig.data.minScrollerLength, 
            this.#height ** 2 / this.#scale / this.#maxY);
    }

    get #hscrollSpace() {
        return this.#maxX - this.#width / this.#scale;
    } 

    get #vscrollSpace() {
        return this.#maxY - this.#height / this.#scale;
    } 

    #onMouseDown(ev: MouseEvent) {
        let handled = false;
        if (ev.button == 0) {
            [this.#dragStartX, this.#dragStartY] = [ev.offsetX, ev.offsetY];
            [this.#dragStartScrollX, this.#dragStartScrollY] = [this.#scrollX, this.#scrollY];
            if (ev.offsetX > this.#width - scrollerSize) {
                this.#dragType = 'vscroll';
                handled = true;
            } else if (ev.offsetY > this.#height - scrollerSize) {
                this.#dragType = 'hscroll';
                handled = true;
            } else {
                this.#dragType = 'custom';
            }
        
            const handler = (ev: MouseEvent) => this.#onDrag(ev);
            document.addEventListener('mousemove', handler);
            document.addEventListener('mouseup', () => {
                document.removeEventListener('mousemove', handler);
                this.#dragType = 'none';
            }, { once: true });
        }

        if (!handled) this.onMouseDown.dispatch(ev);
    }

    #onDrag(ev: MouseEvent) {
        const rect = this.canvas.getBoundingClientRect();
        const offsetX = ev.clientX - rect.left;
        const offsetY = ev.clientY - rect.top;
        
        if (ev.buttons == 1) {
            if (this.#dragType == 'hscroll') {
                this.#scrollX = this.#dragStartScrollX + 
                    (offsetX - this.#dragStartX) 
                    / (this.#width - this.#hscrollerLength) * this.#hscrollSpace;
                this.#constrainScroll();
                this.requestRender();
                return;
            } else if (this.#dragType == 'vscroll') {
                this.#scrollY = this.#dragStartScrollY + 
                    (offsetY - this.#dragStartY) 
                    / (this.#height - this.#vscrollerLength) * this.#vscrollSpace;
                this.#constrainScroll();
                this.requestRender();
                return;
            }
        }
        this.onDrag.dispatch(offsetX, offsetY, ev);
    }

    #onMouseMove(ev: MouseEvent) {
        this.#centerX = undefined;
      
        if (ev.buttons == 0) {
            let oldHighlight = this.#scrollerHighlight;
            if (ev.offsetY > this.#height - scrollerSize) {
                this.#scrollerHighlight = 'h';
            } else if (ev.offsetX > this.#width - scrollerSize) {
                this.#scrollerHighlight = 'v';
            } else {
                this.#scrollerHighlight = 'none';
                return;
            }
            const now = performance.now();
            if (now - this.#scrollerFadeStartTime > scrollerFadeStart 
                || oldHighlight != this.#scrollerHighlight) this.requestRender();
            this.#scrollerFadeStartTime = now;
            return;
        }
    }

    #onMouseWheel(ev: WheelEvent) {
        const tr = translateWheelEvent(ev);
        if (tr.isZoom) {
            if (!this.#centerX || !this.#centerY) {
                this.#centerX = ev.offsetX / this.#scale + this.#scrollX;
                this.#centerY = ev.offsetY / this.#scale + this.#scrollY;
            }
            this.#scale = Math.min(this.#maxZoom, 
                Math.max(1, this.#scale / Math.pow(1.01, tr.amount)));
            this.#scrollX = this.#centerX - ev.offsetX / this.#scale;
            this.#scrollY = this.#centerY - ev.offsetY / this.#scale;
        } else {
            this.#scrollX += tr.amountX * 0.1;
            this.#scrollY += tr.amountY * 0.1;
        }
        this.#constrainScroll();
        this.requestRender();
    }

    #render() {
        this.#requestedRender = false;
        if (!this.renderer) return;

        this.#cxt.resetTransform();
        if (this.doNotPrescaleHighDPI) {
            this.#cxt.clearRect(0, 0, 
                this.#width * devicePixelRatio, 
                this.#height * devicePixelRatio);
            this.#cxt.scale(this.#scale, this.#scale);
            this.#cxt.translate(
                -this.#scrollX * devicePixelRatio, 
                -this.#scrollY * devicePixelRatio);
        } else {
            this.#cxt.scale(devicePixelRatio, devicePixelRatio);
            this.#cxt.clearRect(0, 0, this.#width, this.#height);
            this.#cxt.scale(this.#scale, this.#scale);
            this.#cxt.translate(-this.#scrollX, -this.#scrollY);
        }
        this.renderer(this.#cxt);

        // for scrollers, draw in screen space again
        this.#cxt.resetTransform();
        this.#cxt.scale(devicePixelRatio, devicePixelRatio);

        const now = performance.now();
        const fade = 
            1 - Math.max(0, now - this.#scrollerFadeStartTime - scrollerFadeStart) 
            / (scrollerFade - scrollerFadeStart);

        // horizontal
        if (this.#maxX > this.#width / this.#scale) {
            const len = this.#hscrollerLength;
            const highlight = this.#dragType == 'hscroll' || this.#scrollerHighlight == 'h';
            this.#cxt.fillStyle = `rgb(${scrollerColorRgb()} / ${highlight ? 100 : 40 * fade}%)`;
            this.#cxt.fillRect(
                this.#scrollX / this.#hscrollSpace * (this.#width - len), 
                this.#height - scrollerSize, 
                len, scrollerSize);
        }
        // vertical
        if (this.#maxY > this.#height / this.#scale) {
            const len = this.#vscrollerLength;
            const highlight = this.#dragType == 'vscroll' || this.#scrollerHighlight == 'v';
            this.#cxt.fillStyle = `rgb(${scrollerColorRgb()} / ${highlight ? 100 : 40 * fade}%)`;
            this.#cxt.fillRect(
                this.#width - scrollerSize, 
                this.#scrollY / this.#vscrollSpace * (this.#height - len),
                scrollerSize, len);
        }

        if (now - this.#scrollerFadeStartTime < scrollerFadeStart) {
            setTimeout(() => this.requestRender(), 
                scrollerFadeStart - now + this.#scrollerFadeStartTime);
        } else if (now - this.#scrollerFadeStartTime < scrollerFade) {
            this.requestRender();
        }
    }

    #update() {
        let factor = window.devicePixelRatio;
        this.#width = this.canvas.clientWidth;
        this.#height = this.canvas.clientHeight;
        this.canvas.width = Math.floor(this.#width * factor);
        this.canvas.height = Math.floor(this.#height * factor);
        this.onDisplaySizeChanged.dispatch(
            this.#width, this.#height, 
            this.#width * factor, this.#height * factor);
    }

    #constrainScroll() {
        this.#scrollerFadeStartTime = performance.now();
        this.#scrollX = Math.max(0, 
            Math.min(this.#maxX - this.#width / this.#scale, this.#scrollX));
        this.#scrollY = Math.max(0, 
            Math.min(this.#maxY - this.#height / this.#scale, this.#scrollY));
    }
}