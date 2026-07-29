import { Debug } from "$lib/Debug";

export function barPlot(
    ctx: OffscreenCanvasRenderingContext2D,
    values: readonly (readonly [number, readonly number[]])[],
    x: number, y: number, w: number, h: number
) {
    if (values.length == 0) return;
    const n = values.length;
    const lo = Math.min(...values.flatMap((x) => x[1]));
    let hi = Math.max(...values.flatMap((x) => x[1]));

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
    ctx.fillStyle = '#00FFFF';
    ctx.fillRect(x, refy, w, 1);

    // bars
    values.forEach(([_, b], i) => b.forEach((bj, j) => {
        const y1 = refy, y2 = yi(bj);
        ctx.fillStyle = generateSeriesColor('#00FFFF', b.length, j);
        ctx.fillRect(xi(i) + j * 1.5, Math.min(y1, y2), 1, Math.abs(y1 - y2));
    }));

    // texts
    ctx.fillStyle = '#00FFFF';
    ctx.textAlign = 'right';
    ctx.fillText(hi.toFixed(0), x, y);
    ctx.fillText(lo.toFixed(0), x, y + h);
}

type Hsl = {
    h: number;
    s: number;
    l: number;
};

export function generateSeriesColor(
    firstColor: string,
    totalSeries: number,
    index: number,
): string {
    if (totalSeries <= 1) return firstColor;

    const { h, s, l } = hexToHsl(firstColor);
    const hue = (h + (360 * index) / totalSeries) % 360;
    return hslToHex(hue, s, l);
}

function hexToHsl(hex: string): Hsl {
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);

    let h = 0;
    let s = 0;
    const l = (max + min) / 2;

    if (max !== min) {
        const d = max - min;

        s = l > 0.5
            ? d / (2 - max - min)
            : d / (max + min);

        switch (max) {
            case r:
                h = (g - b) / d + (g < b ? 6 : 0);
                break;
            case g:
                h = (b - r) / d + 2;
                break;
            case b:
                h = (r - g) / d + 4;
                break;
        }

        h *= 60;
    }

    return { h, s, l };
}

function hslToHex(h: number, s: number, l: number): string {
    h /= 360;

    const hue2rgb = (p: number, q: number, t: number): number => {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1 / 6) return p + (q - p) * 6 * t;
        if (t < 1 / 2) return q;
        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
        return p;
    };

    let r: number;
    let g: number;
    let b: number;

    if (s === 0) {
        r = g = b = l;
    } else {
        const q = l < 0.5
            ? l * (1 + s)
            : l + s - l * s;
        const p = 2 * l - q;

        r = hue2rgb(p, q, h + 1 / 3);
        g = hue2rgb(p, q, h);
        b = hue2rgb(p, q, h - 1 / 3);
    }

    const toHex = (x: number): string =>
        Math.round(x * 255)
            .toString(16)
            .padStart(2, "0");

    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}
