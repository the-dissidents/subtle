import * as z from "zod/v4-mini";
import * as Color from "colorjs.io/fn";

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