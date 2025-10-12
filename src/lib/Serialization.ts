import * as z from "zod/v4-mini";

export class DeserializationError extends Error {
    constructor(msg: string) {
        super(msg);
        this.name = 'DeserializationError';
    }
}

export function parseObjectZ<Z extends z.core.$ZodType>(obj: object, ztype: Z) {
    const result = z.safeParse(ztype, obj);
    if (result.success) return result.data;
    throw new DeserializationError(z.prettifyError(result.error));
}