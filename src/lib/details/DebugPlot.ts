import { Debug } from "$lib/Debug";

export function barPlot(
    ctx: OffscreenCanvasRenderingContext2D,
    values: [number, number][], x: number, y: number, w: number, h: number
) {
    if (values.length == 0) return;
    const n = values.length;
    const lo = Math.min(...values.map((x) => x[1]));
    let hi = Math.max(...values.map((x) => x[1]));

    if (!isFinite(lo) || !isFinite(hi))
        void Debug.warn(values);

    if (hi <= lo) hi = lo + 1;
    const ref = (lo < 0 && hi > 0) ? 0 : lo;

    function xi(xi: number) {
        return w * (xi / n) + x;
    }

    function yi(yi: number) {
        return y + h - (yi - lo) / (hi - lo) * h;
    }

    // reference line
    const refy = yi(ref);
    ctx.fillRect(x, refy, w, 1);

    // bars
    values.forEach(([_, b], i) => {
        const y1 = refy, y2 = yi(b);
        ctx.fillRect(xi(i), Math.min(y1, y2), 1, Math.abs(y1 - y2))
    });

    // texts
    ctx.textAlign = 'right';
    ctx.fillText(hi.toFixed(0), x, y);
    ctx.fillText(lo.toFixed(0), x, y + h);
}
