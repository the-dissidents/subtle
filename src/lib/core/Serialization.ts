import * as z from "zod/v4-mini";
import * as Color from "colorjs.io/fn";
import { Debug } from "../Debug";

export const ZColor = z.codec(z.string(), z.custom<Color.PlainColorObject>(),
{
    decode: (x, _cxt) => {
        try {
            return Color.getColor(x);
        } catch {
            // cxt.issues.push({
            //     input: x,
            //     code: "custom",
            //     message: `error parsing color: ${e}`,
            //     continue: true
            // });
            return Color.getColor('white');
        }
    },
    encode: (x) => Color.serialize(x)
});
export class DeserializationError extends Error {
    constructor(msg: string) {
        super(msg);
        this.name = 'DeserializationError';
    }
}

export function parseObjectZ<Z extends z.core.$ZodType>(obj: unknown, ztype: Z, name: string) {
    const result = z.safeParse(ztype, obj, { reportInput: true });
    if (result.success) return result.data;
    void Debug.info(result.error);
    throw new DeserializationError(`parsing ${name}: ` + z.prettifyError(result.error));
}
