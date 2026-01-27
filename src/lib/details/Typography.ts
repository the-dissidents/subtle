import { Debug } from "../Debug";

const RealDims = new Map<string, number>();

export const Typography = {
    getRealDimFactor(
        fontFamily: string
    ) {
        if (RealDims.has(fontFamily))
            return RealDims.get(fontFamily)!;

        const offscreen = new OffscreenCanvas(1000, 1000);
        const ctx = offscreen.getContext("2d") ?? undefined;
        Debug.assert(ctx !== undefined);

        const testPxSize = 500;
        const testString = 'Mgjpq';
        ctx.font = `${testPxSize}px "${fontFamily}"`;
        const metrics = ctx.measureText(testString);
        const result = testPxSize / 
            (metrics.fontBoundingBoxAscent + metrics.fontBoundingBoxDescent);
        RealDims.set(fontFamily, result);

        console.log(fontFamily, result);
        
        return result;
    }
}