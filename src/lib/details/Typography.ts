import { Debug } from "../Debug";

const RealDims = new Map<string, number>();

export const Typography = {
    getRealDimFactor(
        fontFamily: string,
        weight?: number,
        italic?: boolean
    ) {
        const cacheKey = `${italic ? 'i' : ''}:${weight ?? 400}:${fontFamily}`;
        if (RealDims.has(cacheKey))
            return RealDims.get(cacheKey)!;

        const offscreen = new OffscreenCanvas(1000, 1000);
        const ctx = offscreen.getContext("2d") ?? undefined;
        Debug.assert(ctx !== undefined);

        const testPxSize = 500;
        const testString = 'Mgjpq';
        const stylePrefix = `${italic ? 'italic ' : ''}${weight && weight !== 400 ? `${Math.round(weight)} ` : ''}`;
        ctx.font = `${stylePrefix}${testPxSize}px "${fontFamily.replaceAll('"', '\\"')}"`;
        const metrics = ctx.measureText(testString);
        const result = testPxSize /
            (metrics.fontBoundingBoxAscent + metrics.fontBoundingBoxDescent);
        RealDims.set(cacheKey, result);

        return result;
    }
}
