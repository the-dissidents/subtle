import * as z from "zod/v4-mini";
import { Debug } from "./Debug";

export class DeserializationError extends Error {
    constructor(msg: string) {
        super(msg);
        this.name = 'DeserializationError';
    }
}

export function parseObjectZ<Z extends z.core.$ZodType>(obj: unknown, ztype: Z, name: string) {
    const result = z.safeParse(ztype, obj, {reportInput: true});
    if (result.success) return result.data;
    Debug.info(result.error);
    throw new DeserializationError(`parsing ${name}: ` + z.prettifyError(result.error));
}