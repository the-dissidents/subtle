console.info('core/Subtitles loading');

import { Debug } from "../Debug";
import { SvelteMap, SvelteSet } from "svelte/reactivity";
import type { LinearFormatCombineStrategy } from "./SubtitleUtil.svelte";
import { parseFilter, type MetricFilter } from "./Filter";
import { parseObjectZ } from "../Serialization";

import z from "zod/v4";

export const Labels = ['none', 'red', 'orange', 'yellow', 'green', 'blue', 'purple'] as const;
export type LabelType = typeof Labels[number];

export enum AlignMode {
    BottomLeft = 1, BottomCenter, BottomRight,
    CenterLeft, Center, CenterRight,
    TopLeft, TopCenter, TopRight,
}

const ZStyleBase = z.object({
    name: z.string(),
    font: z.string().default(''),
    size: z.number().positive().default(72),
    color: z.string().default('white'),
    outlineColor: z.string().default('black'),
    outline: z.number().min(0).default(1),
    shadow: z.number().min(0).default(0),
    styles: z.object({
        bold: z.boolean().default(false),
        italic: z.boolean().default(false),
        underline: z.boolean().default(false),
        strikethrough: z.boolean().default(false)
    }),
    margin: z.object({
        top: z.number().default(10),
        bottom: z.number().default(10),
        left: z.number().default(10),
        right: z.number().default(10),
    }),
    alignment: z.int().min(1).max(9).default(2),
});

export type SubtitleStyle = z.infer<typeof ZStyleBase> & {
    validator: MetricFilter | null
};

export function parseSubtitleStyle(obj: any): SubtitleStyle {
    const base = parseObjectZ(obj, ZStyleBase);
    const validator = obj.validator ? parseFilter(obj.validator) : null;
    return { ...base, validator };
}

export const ZMetadata = z.object({
    title: z.string().default(''),
    language: z.string().default(''),
    width: z.int().positive().default(1920),
    height: z.int().positive().default(1080),
    scalingFactor: z.number().positive().default(1),
    special: z.object({
        untimedText: z.string().default('')
    })
});

export type SubtitleMetadata = z.infer<typeof ZMetadata>;

export const MigrationDuplicatedStyles = new WeakMap<SubtitleStyle, SubtitleStyle[]>();

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
        timelineExcludeStyles: new SvelteSet<SubtitleStyle>()
    });

    static createStyle(name: string): SubtitleStyle {
        return parseSubtitleStyle({ name, styles: {}, margin: {} });
    };

    static #createMetadata(): SubtitleMetadata {
        return ZMetadata.parse({ special: {} });
    }

    /** Note: only copies styles from base */
    constructor(base?: Subtitles) {
        if (base) {
            let def: SubtitleStyle | undefined;
            this.styles = base.styles.map((x) => {
                let clone = $state($state.snapshot(x));
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

export interface SubtitleFormat {
    parse(source: string): Subtitles;
    write(subs: Subtitles, options?: {
        headerless?: boolean,
        useEntries?: SubtitleEntry[],
        combine?: LinearFormatCombineStrategy
    }): string;
    // TODO: detect?
}