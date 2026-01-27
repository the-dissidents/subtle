console.info('core/Subtitles loading');

import { Debug } from "../Debug";
import { SvelteMap, SvelteSet } from "svelte/reactivity";
import { Filter, type MetricFilter } from "./Filter";
import { AlignMode, type LabelType } from "./Labels";
import { parseObjectZ } from "../Serialization";

import * as z from "zod/v4-mini";
import { ZColor } from "./Serialization";
import * as Color from "colorjs.io/fn";
import type { RichText } from "./RichText";
import { WrapStyle } from "../details/TextLayout";

export const ZStyleBase = z.object({
    name:                         z.string(),
    font:              z._default(z.string(), ''),
    size:              z._default(z.number().check(z.positive()), 72),
    color:             z._default(ZColor, Color.getColor('white')),
    outlineColor:      z._default(ZColor, Color.getColor('black')),
    outline:           z._default(z.number().check(z.gte(0)), 1),
    shadowColor:       z._default(ZColor, Color.getColor('black')),
    shadow:            z._default(z.number().check(z.gte(0)), 0),
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
    alignment:         z._default(z.enum(AlignMode), AlignMode.BottomCenter),
    wrapStyle:         z._default(z.enum(WrapStyle), WrapStyle.Balanced),
    validator:         z._default(z.nullable(z.unknown()), null)
});

export const ZMetadata = z.object({
    title:         z._default(z.string(), ''),
    language:      z._default(z.string(), ''),
    width:         z._default(z.int().check(z.positive()), 1920),
    height:        z._default(z.int().check(z.positive()), 1080),
    scalingFactor: z._default(z.number().check(z.positive()), 1),
    special: z.object({
        untimedText:        z._default(z.string(), ''),
    }),
    uiState: z.object({
        tableScrollIndex:   z._default(z.int().check(z.nonnegative()), 0),
        timelineOffset:     z._default(z.nullable(z.number().check(z.nonnegative())), null),
        timelineScale:      z._default(z.nullable(z.number().check(z.positive())), null)
    }),
});

export type SubtitleStyle = Omit<z.infer<typeof ZStyleBase>, 'validator'> & {
    validator: MetricFilter | null
};

export type SerializedSubtitleStyle = ReturnType<typeof SubtitleStyle.serialize>;

export const SubtitleStyle = {
    serialize(s: SubtitleStyle) {
        return {
            ...z.encode(ZStyleBase, s),
            validator: s.validator ? Filter.serialize(s.validator) : null
        }
    },
    deserializeWithoutValidator(obj: unknown) {
        const base = parseObjectZ(obj, ZStyleBase, "ZStyleBase");
        return { ...base, validator: null };
    },
    clone(s: SubtitleStyle) {
        // is this structuredClone unnecessary?
        const x = structuredClone(z.encode(ZStyleBase, s));
        return {
            ...z.decode(ZStyleBase, x),
            validator: s.validator ? Filter.clone(s.validator) : null
        };
    },
    new(name: string) {
        return SubtitleStyle.deserializeWithoutValidator({ name, styles: {}, margin: {} });
    }
};

export type SubtitleMetadata = z.infer<typeof ZMetadata>;

export class SubtitleEntry {
    label: LabelType = $state('none');
    texts = new SvelteMap<SubtitleStyle, RichText>();
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
    defaultStyle: SubtitleStyle = $state(SubtitleStyle.new('default'));
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

    static #createMetadata(): SubtitleMetadata {
        return ZMetadata.parse({ special: {}, uiState: {} });
    }

    /** Note: only copies styles from base */
    constructor(base?: Subtitles) {
        if (base) {
            let def: SubtitleStyle | undefined;
            this.styles = base.styles.map((x) => {
                const clone = $state(SubtitleStyle.clone(x));
                if (x == base.defaultStyle) def = clone;
                return clone;
            });
            Debug.assert(def !== undefined);
            this.defaultStyle = def;
        }
    }

    debugTestIntegrity() {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const isProxy = (suspect: any) => {
            const randField = crypto.randomUUID();
            const obj = {};
            suspect[randField] = obj;
            
            const result = suspect[randField] !== obj;
            delete suspect[randField];
    
            return result;
        }

        let ok = true;
        for (const style of this.styles) {
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
        this.entries.forEach((ent, i) => {
            if (ent.texts.size == 0)
                Debug.warn(`debugTestIntegrity: entry with no channels at ${i}`);
            for (const [style, _] of ent.texts) {
                if (!this.styles.includes(style)) {
                    map.set(style, (map.get(style) ?? 0) + 1);
                    ok = false;
                }
            }
        });
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