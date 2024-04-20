import { assert } from "./Basic";

export interface WithCanvas {
    setDisplaySize(w: number, h: number, rw: number, rh: number): void;
}

export class CanvasKeeper {
    cxt: CanvasRenderingContext2D;
    #binds: Set<WithCanvas> = new Set();

    constructor(public canvas: HTMLCanvasElement, resizing: HTMLElement) 
    {
        let context = canvas.getContext('2d');
        assert(context !== null);
        this.cxt = context;
        this.#handler();
        new ResizeObserver(() => this.#handler()).observe(resizing);
    }

    #handler() {
        let factor = window.devicePixelRatio;
        let cw = this.canvas.clientWidth;
        let ch = this.canvas.clientHeight;
        this.canvas.width = Math.floor(cw * factor);
        this.canvas.height = Math.floor(ch * factor);
        this.#binds.forEach((x) => 
            x.setDisplaySize(cw, ch, cw * factor, ch * factor));
    }

    bind(elem: WithCanvas) {
        this.#binds.add(elem);
        this.#handler();
    }

    unbind(elem: WithCanvas) {
        this.#binds.delete(elem);
    }
}