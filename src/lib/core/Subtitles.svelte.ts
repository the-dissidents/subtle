console.info('core/Subtitles loading');

import { Debug } from "../Debug";
import { SvelteMap, SvelteSet } from "svelte/reactivity";
import { parseFilter, type MetricFilter } from "./Filter";
import { parseObjectZ } from "../Serialization";

export const Labels = ['none', 'red', 'orange', 'yellow', 'green', 'blue', 'purple'] as const;
export type LabelType = typeof Labels[number];

export enum AlignMode {
    BottomLeft = 1, BottomCenter, BottomRight,
    CenterLeft, Center, CenterRight,
    TopLeft, TopCenter, TopRight,
}

import * as z from "zod/v4-mini";
import Color from "colorjs.io";

const ZColor = z.codec(z.union([
    z.string(),
    z.tuple([z.number(), z.number(), z.number(), z.number()])
]), z.instanceof(Color), {
    decode: (x) => {
        if (typeof x == 'string') {
            try {
                return new Color(x);
            } catch (e) {
                Debug.info('error parsing color:', e);
                return new Color('black');
            }
        } else {
            let [r, g, b, a] = x;
            return new Color('srgb', [r, g, b], a);
        }
    },
    encode: (x) => {
        return [
            // NB components can be `undefined` for colorjs.io `Color`s
            x.r ?? 0, x.g ?? 0, x.b ?? 0, x.a ?? 1
        ] satisfies [number, number, number, number]
    }
});

const ZStyleBase = z.object({
  name:                    z.string(),
  font:         z._default(z.string(), ''),
  size:         z._default(z.number().check(z.positive()), 72),
  color:        z._default(ZColor, new Color('white')),
  outlineColor: z._default(ZColor, new Color('black')),
  outline:      z._default(z.number().check(z.gte(0)), 1),
  shadowColor:  z._default(ZColor, new Color('black')),
  shadow:       z._default(z.number().check(z.gte(0)), 0),
  styles: z.object({
    bold:          z._default(z.boolean(), false),
    italic:        z._default(z.boolean(), false),
    underline:     z._default(z.boolean(), false),
    strikethrough: z._default(z.boolean(), false),
  }),
  margin: z.object({
    top:           z._default(z.number(), 10),
    bottom:        z._default(z.number(), 10),
    left:          z._default(z.number(), 10),
    right:         z._default(z.number(), 10),
  }),
  alignment:       z._default(z.enum(AlignMode), AlignMode.BottomCenter),
});

export const ZMetadata = z.object({
  title:         z._default(z.string(), ''),
  language:      z._default(z.string(), ''),
  width:         z._default(z.int().check(z.positive()), 1920),
  height:        z._default(z.int().check(z.positive()), 1080),
  scalingFactor: z._default(z.number().check(z.positive()), 1),
  special: z.object({
    untimedText: z._default(z.string(), ''),
  }),
  uiState: z.object({
    tableScrollIndex:   z._default(z.int().check(z.nonnegative()), 0),
    timelineOffset:     z._default(z.nullable(z.number().check(z.nonnegative())), null),
    timelineScale:      z._default(z.nullable(z.number().check(z.positive())), null)
  })
});

export type SubtitleStyle = z.infer<typeof ZStyleBase> & {
    validator: MetricFilter | null
};

export type SerializedSubtitleStyle = ReturnType<typeof serializeSubtitleStyle>;

export function serializeSubtitleStyle(s: SubtitleStyle) {
    return {
        ...z.encode(ZStyleBase, s),
        validator: $state.snapshot(s.validator)
    }
}

export function parseSubtitleStyle(obj: any): SubtitleStyle {
    const base = parseObjectZ(obj, ZStyleBase);
    const validator = obj.validator ? parseFilter(obj.validator) : null;
    return { ...base, validator };
}

export function cloneSubtitleStyle(s: SubtitleStyle): SubtitleStyle {
    let x = structuredClone(z.encode(ZStyleBase, s));
    return {
        ...z.decode(ZStyleBase, x),
        validator: $state.snapshot(s.validator)
    };
}

export type SubtitleMetadata = z.infer<typeof ZMetadata>;

export class SubtitleEntry {
    label: LabelType = $state('none');
    texts = new SvelteMap<SubtitleStyle, string>();
    start: number = $state(0);
    end: number = $state(0);

    constructor(start: number, end: number) 
    {
        this.start = start;
        this.end = end;
    }
}

type MigrationInfo = 'none' | 'ASS' | 'text' | 'olderVersion' | 'newerVersion';

export class Subtitles {
    metadata: SubtitleMetadata = $state(Subtitles.#createMetadata());
    /** Must be set to one of `styles` */
    defaultStyle: SubtitleStyle = $state(Subtitles.createStyle('default'));
    /** The order of the styles should be strictly the reverse of the ASS display order */
    styles: SubtitleStyle[] = $state([this.defaultStyle]);
    entries: SubtitleEntry[] = [];
    migrated: MigrationInfo = 'none';

    view = $state({
        perEntryColumns: ['startTime', 'endTime'],
        perChannelColumns: ['style', 'content'],
        timelineExcludeStyles: new SvelteSet<SubtitleStyle>(),
        timelineActiveChannel: null as SubtitleStyle | null
    });

    static createStyle(name: string): SubtitleStyle {
        return parseSubtitleStyle({ name, styles: {}, margin: {} });
    };

    static #createMetadata(): SubtitleMetadata {
        return ZMetadata.parse({ special: {}, uiState: {} });
    }

    /** Note: only copies styles from base */
    constructor(base?: Subtitles) {
        if (base) {
            let def: SubtitleStyle | undefined;
            this.styles = base.styles.map((x) => {
                let clone = $state(cloneSubtitleStyle(x));
                if (x == base.defaultStyle) def = clone;
                return clone;
            });
            Debug.assert(def !== undefined);
            this.defaultStyle = def;
        }
    }

    debugTestIntegrity() {
        const isProxy = (suspect: any) => {
            const randField = crypto.randomUUID();
            const obj = {};
            suspect[randField] = obj;
            
            const result = suspect[randField] !== obj;
            delete suspect[randField];
    
            return result;
        }

        let ok = true;
        for (let style of this.styles) {
            if (!isProxy(style)) {
                Debug.warn(`debugTestIntegrity: style is not a proxy: ${style.name}`);
                console.log(style);
                ok = false;
            }
        }
        if (!this.styles.includes(this.defaultStyle)) {
            Debug.warn(`debugTestIntegrity: defaultStyle not found in styles`);
            console.log(this.defaultStyle);
            ok = false;
        }
        const map = new Map<SubtitleStyle, number>();
        for (const ent of this.entries) {
            for (const [style, _] of ent.texts) {
                if (!this.styles.includes(style)) {
                    map.set(style, (map.get(style) ?? 0) + 1);
                    ok = false;
                }
            }
        }
        for (const [style, n] of map) {
            Debug.warn(`debugTestIntegrity: entry style not found in styles: ${style.name}${n > 1 ? ` [${n} times]` : ''}`);
            console.log(style);
        }
        return ok;
    }
}

export interface SubtitleWritableFormat {
    write(subs: Subtitles): SubtitleWriter;
}

export interface SubtitleParseMessage {
    type: string,
    category: string
}

export interface SubtitleParsableFormat {
    /**
     * Detects if a source string is of this format. Returns `null` if uncertain.
     */
    detect(source: string): boolean | null;
    parse(source: string): SubtitleParser;
}

export type SubtitleFormat = SubtitleWritableFormat & SubtitleParsableFormat;

export interface SubtitleParser {
    done(): Subtitles;
    update(): void;
    messages: readonly SubtitleParseMessage[];
}

export interface SubtitleWriter {
    toString(): string
    // toBinary?
}