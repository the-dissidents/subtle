import Ajv, { type ValidateFunction } from "ajv";
import { Debug } from "./Debug";
import { z } from "zod/v4";

export const ajv = new Ajv({
    removeAdditional: true,
    useDefaults: true
});

export class DeserializationError extends Error {
    constructor(msg: string) {
        super(msg);
        this.name = 'DeserializationError';
    }
}

export function parseObjectZ<Z extends z.core.$ZodType>(obj: {}, ztype: Z) {
    let result = z.safeParse(ztype, z);
    if (result.success) return result.data;
    throw new DeserializationError(z.prettifyError(result.error));
} 

export function parseObject<T>(obj: {}, validator: ValidateFunction<T>): T {
    if (!validator(obj)) {
        Debug.debug(validator.errors);
        throw new DeserializationError(validator.errors!.map((x) => x.message).join('; '));
    }
    return obj;
}
