import { SvelteMap, SvelteSet } from "svelte/reactivity";
import { Debug } from "../Debug";
import type { LinearFormatCombineStrategy } from "./SubtitleUtil.svelte";
import type { MetricFilter, MetricName } from "./Filter";

export const Labels = ['none', 'red', 'orange', 'yellow', 'green', 'blue', 'purple'] as const;
export type LabelType = typeof Labels[number];

export enum AlignMode {
    BottomLeft = 1, BottomCenter, BottomRight,
    CenterLeft, Center, CenterRight,
    TopLeft, TopCenter, TopRight,
}

export interface SubtitleStyle {
    name: string;
    font: string;
    size: number;
    color: string;
    outlineColor: string;
    outline: number;
    shadow: number;
    styles: {
        bold: boolean,
        italic: boolean,
        underline: boolean,
        strikethrough: boolean
    };
    margin: { top: number, bottom: number, left: number, right: number };
    alignment: AlignMode;
    validator: MetricFilter | null;
}

export interface SubtitleMetadata {
    title: string,
    language: string,
    width: number,
    height: number,
    scalingFactor: number,
    special: {
        untimedText: string,
    }
}

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
        perEntryColumns: ['startTime', 'endTime'] as MetricName[],
        perChannelColumns: ['style', 'content'] as MetricName[],
        timelineExcludeStyles: new SvelteSet<SubtitleStyle>()
    });

    static createStyle(name: string): SubtitleStyle {
        return {
            name,
            font: '', size: 72,
            color: 'white',
            outlineColor: 'black',
            outline: 1,
            shadow: 0,
            styles: {
                bold: false,
                italic: false,
                underline: false,
                strikethrough: false
            },
            margin: { top: 10, bottom: 10, left: 10, right: 10 },
            alignment: 2,
            validator: null
        }
    };

    static #createMetadata(): SubtitleMetadata {
        return {
            title: '',
            language: '',
            width: 1920,
            height: 1080,
            scalingFactor: 1,
            special: {
                untimedText: ''
            }
        }
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