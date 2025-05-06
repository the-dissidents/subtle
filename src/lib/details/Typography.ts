import { Debug } from "../Debug";

const RealDims = new Map<string, number>();

export const Typography = {
    getRealDimFactor(
        fontFamily: string, 
        ctx?: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
    ) {
        if (RealDims.has(fontFamily))
            return RealDims.get(fontFamily)!;

        if (!ctx) {
            const offscreen = new OffscreenCanvas(1000, 1000);
            ctx = offscreen.getContext("2d") ?? undefined;
            Debug.assert(ctx !== undefined);
        }

        const testPxSize = 500;
        const testString = 'Mgjpq';
        ctx.font = `${testPxSize}px ${fontFamily}`;
        const metrics = ctx.measureText(testString);
        console.log(metrics);
        const result = testPxSize / 
            (metrics.fontBoundingBoxAscent + metrics.fontBoundingBoxDescent);
        RealDims.set(fontFamily, result);
        return result;
    }
}