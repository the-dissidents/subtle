console.info('core/Subtitles loading');

import { Debug } from "../Debug";
import { SvelteMap } from "svelte/reactivity";
import { Filter, type MetricFilter } from "./Filter";
import { AlignMode, type LabelType } from "./Labels";
import { parseObjectZ } from "./Serialization";

import * as z from "zod/v4-mini";
import { ZColor } from "./Serialization";
import * as Color from "colorjs.io/fn";
import type { RichText } from "./RichText";
import { WrapStyle } from "../details/TextLayout";
import { LintProfile } from "./LintProfile";

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

    // Special members.
    // We allow the value these two properties to be incompatible with the
    // current version when deserializing
    validator:         z._default(z.nullable(z.unknown()), null),
    lintProfile:       z._default(z.nullable(z.unknown()), null),
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

const ZStyleBaseWithoutSpecial = z.omit(ZStyleBase, { validator: true, lintProfile: true });

export type SubtitleStyle = z.infer<typeof ZStyleBaseWithoutSpecial> & {
    validator: MetricFilter | null,
    lintProfile: LintProfile | null,
};

export type SerializedSubtitleStyle = ReturnType<typeof SubtitleStyle.serialize>;

export const SubtitleStyle = {
    serialize(s: SubtitleStyle) {
        return {
            ...z.encode(ZStyleBaseWithoutSpecial, s),
            validator: s.validator ? Filter.serialize(s.validator) : null,
            lintProfile: s.lintProfile ? z.encode(LintProfile, s.lintProfile) : null,
        }
    },
    deserializeWithoutSpecial(obj: unknown) {
        const base = parseObjectZ(obj, ZStyleBaseWithoutSpecial, "ZStyleBase");
        return { ...base, validator: null, lintProfile: null };
    },
    clone(s: SubtitleStyle) {
        // is this structuredClone unnecessary?
        const x = structuredClone(z.encode(ZStyleBaseWithoutSpecial, s));
        return {
            ...z.decode(ZStyleBaseWithoutSpecial, x),
            validator: s.validator ? Filter.clone(s.validator) : null,
            lintProfile: s.lintProfile,
        };
    },
    new(name: string) {
        return SubtitleStyle.deserializeWithoutSpecial({ name, styles: {}, margin: {} });
    }
};

export type SubtitleMetadata = z.infer<typeof ZMetadata>;

export const ZPositioning = z._default(z.union([
    z.null(),
    z.object({
        type: z.literal('absolute'),
        x: z.number(), y: z.number(),
    }),
]), null);

export type Positioning = z.infer<typeof ZPositioning>;

export class SubtitleEntry {
    label: LabelType = $state('none');
    texts = new SvelteMap<SubtitleStyle, RichText>();
    start: number = $state(0);
    end: number = $state(0);
    positioning: Positioning = $state(null);
    alignment: AlignMode | null = $state(null);

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
        timelineExcludeStyles: new WeakSet<SubtitleStyle>(),
        timelineActiveChannel: null as WeakRef<SubtitleStyle> | null
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
                void Debug.warn(`debugTestIntegrity: style is not a proxy: ${style.name}`);
                console.log(style);
                ok = false;
            }
        }
        if (!this.styles.includes(this.defaultStyle)) {
            void Debug.warn(`debugTestIntegrity: defaultStyle not found in styles`);
            console.log(this.defaultStyle);
            ok = false;
        }
        const map = new Map<SubtitleStyle, number>();
        this.entries.forEach((ent, i) => {
            if (ent.texts.size == 0)
                void Debug.warn(`debugTestIntegrity: entry with no channels at ${i}`);
            for (const [style, _] of ent.texts) {
                if (!this.styles.includes(style)) {
                    map.set(style, (map.get(style) ?? 0) + 1);
                    ok = false;
                }
            }
        });
        for (const [style, n] of map) {
            void Debug.warn(`debugTestIntegrity: entry style not found in styles: ${style.name}${n > 1 ? ` [${n} times]` : ''}`);
            console.log(style);
        }
        return ok;
    }
}
