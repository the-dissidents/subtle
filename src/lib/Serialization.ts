import Ajv, { type ValidateFunction } from "ajv";
import { Debug } from "./Debug";

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

export function parseObject<T>(obj: {}, validator: ValidateFunction<T>): T {
    if (!validator(obj)) {
        Debug.debug(validator.errors);
        throw new DeserializationError(validator.errors!.map((x) => x.message).join('; '));
    }
    return obj;
}
