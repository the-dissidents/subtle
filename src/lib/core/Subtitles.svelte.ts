import { Ajv, type JSONSchemaType, type ValidateFunction } from "ajv";
import { assert } from "../Basic";
import { SvelteMap } from "svelte/reactivity";

const SubtitleFormatVersion = '000400';

const ajv = new Ajv({
    removeAdditional: true,
    useDefaults: true
});

export class SubtitlesParseError extends Error {
    constructor(msg: string) {
        super(msg);
        this.name = 'SubtitlesParseError';
    }
}

export const Labels = ['none', 'red', 'orange', 'yellow', 'green', 'blue', 'purple'] as const;
export type LabelTypes = typeof Labels[number];

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
    margin: {top: number, bottom: number, left: number, right: number};
    alignment: AlignMode;
}

const StyleSchema: JSONSchemaType<SubtitleStyle> = {
    type: 'object',
    properties: {
        name: { type: 'string' },
        font: { type: 'string', default: '' },
        size: { type: 'number', exclusiveMinimum: 0, default: 72 },
        color: { type: 'string', default: 'white' },
        outlineColor: { type: 'string', default: 'black' },
        outline: { type: 'number', minimum: 0, default: 1 },
        shadow: { type: 'number', minimum: 0, default: 0 },
        styles: {
            type: 'object',
            properties: {
                bold: { type: 'boolean', default: false },
                italic: { type: 'boolean', default: false },
                underline: { type: 'boolean', default: false },
                strikethrough: { type: 'boolean', default: false },
            },
            required: []
        },
        margin: {
            type: 'object', 
            properties: {
                top: { type: 'number', default: 10 },
                bottom: { type: 'number', default: 10 },
                left: { type: 'number', default: 10 },
                right: { type: 'number', default: 10 },
            },
            required: []
        },
        alignment: { type: 'integer', minimum: 1, maximum: 9, default: 2 }
    },
    required: ['name', 'styles', 'margin']
};

export interface SubtitleMetadata {
    title: string,
    language: string,
    width: number,
    height: number,
    mediaWidth?: number | null,
    mediaHeight?: number | null,
    special: {
        untimedText: string
    }
}

const MetadataSchema: JSONSchemaType<SubtitleMetadata> = {
    type: 'object',
    properties: {
        title: { type: 'string', default: '' },
        language: { type: 'string', default: '' },
        width: { type: 'number', exclusiveMinimum: 0, default: 1920 },
        height: { type: 'number', exclusiveMinimum: 0, default: 1080 },
        mediaWidth: { type: 'number', nullable: true, exclusiveMinimum: 0, default: null },
        mediaHeight: { type: 'number', nullable: true, exclusiveMinimum: 0, default: null },
        special: {
            type: 'object',
            properties: {
                untimedText: { type: 'string', default: '' }
            },
            required: []
        }
    },
    required: []
}

const validateStyle = ajv.compile(StyleSchema);
const validateMetadata = ajv.compile(MetadataSchema);

function parseObject<T>(obj: {}, validator: ValidateFunction<T>): T {
    if (!validator(obj)) {
        console.log(validator.errors);
        throw new SubtitlesParseError(validator.errors!.map((x) => x.message).join('; '));
    }
    return obj;
}

const MigrationDuplicatedStyles = new WeakMap<SubtitleStyle, SubtitleStyle[]>();

export class SubtitleEntry {
    label: LabelTypes = $state('none');
    texts = new SvelteMap<SubtitleStyle, string>();
    start: number = $state(0);
    end: number = $state(0);

    constructor(
        start: number,
        end: number) 
    {
        this.start = start;
        this.end = end;
    }

    toSerializable() {
        return {
            start: this.start,
            end: this.end,
            label: this.label,
            texts: [...[...this.texts.entries()]
                .map(([style, text]) => [style.name, text] as const)]
        }
    }

    static deserialize(
        o: ReturnType<SubtitleEntry['toSerializable']>, 
        subs: Subtitles, version: string
    ): SubtitleEntry {
        function createDuplicateStyle(from: SubtitleStyle) {
            for (let i = 1; ; i++) {
                const name = from.name + ` (${i})`;
                if (!subs.styles.find((x) => x.name == name)) {
                    let duplicate = structuredClone(from);
                    duplicate.name = name;
                    subs.styles.push(duplicate);
                    return duplicate;
                }
            }
        }

        let entry = new SubtitleEntry(o.start, o.end);
        if (o.label) entry.label = o.label;

        for (const [styleName, text] of o.texts) {
            let style = subs.styles.find((x) => x.name == styleName);
            if (!style) throw new Error(`invalid style name: ${styleName}`);

            if (entry.texts.has(style)) {
                if (version >= '000400') throw new SubtitlesParseError(
                    `style appeared multiple time in one entry: ${styleName}`);

                // migrate pre-0.4 styles
                let duplicated = MigrationDuplicatedStyles.get(style);
                let found: SubtitleStyle | undefined;
                if (duplicated) {
                    found = duplicated.find((x) => !entry.texts.has(x));
                    if (!found) {
                        found = createDuplicateStyle(style);
                        duplicated.push(found);
                        console.log('migrate: new duplicate style:', found.name);
                    }
                } else {
                    found = createDuplicateStyle(style);
                    MigrationDuplicatedStyles.set(style, [found]);
                    console.log('migrate: new duplicate style:', found.name);
                }
                style = found;
            }
            entry.texts.set(style, text);
        }
        return entry;
    }
}

export class Subtitles {
    metadata: SubtitleMetadata = $state(Subtitles.#createMetadata());
    /** Must be set to one of `styles` */
    defaultStyle: SubtitleStyle = $state(Subtitles.createStyle('default'));
    styles: SubtitleStyle[] = $state([this.defaultStyle]);
    entries: SubtitleEntry[] = [];
    migrated = false;

    static createStyle(name: string) {
        let data = {name, styles: {}, margin: {}};
        return parseObject(data, validateStyle);
    }

    static #createMetadata() {
        return parseObject({}, validateMetadata);
    }

    /** Note: only copies styles from base */
    constructor(base?: Subtitles) {
        if (base) {
            let def: SubtitleStyle | undefined;
            this.styles = base.styles.map((x) => {
                let clone = structuredClone(x);
                if (x == base.defaultStyle) def = clone;
                return clone;
            });
            assert(def !== undefined);
            this.defaultStyle = def;
        }
    }

    toSerializable() {
        return {
            version: SubtitleFormatVersion,
            metadata: this.metadata,
            defaultStyle: this.defaultStyle.name,
            styles: this.styles,
            entries: this.entries.map((x) => x.toSerializable()),
        }
    }

    static deserialize(o: ReturnType<Subtitles['toSerializable']>) {
        const version = o.version ?? '0';
        let subs = new Subtitles();
        if (o.metadata) {
            subs.metadata = parseObject(o.metadata, validateMetadata);
        }

        if (o.defaultStyle === undefined || o.styles === undefined || !Array.isArray(o.entries))
            throw new SubtitlesParseError('missing properties');

        if (version < '000400') {
            // pre 0.4: the default style is defined outside the styles array
            subs.defaultStyle = parseObject(o.defaultStyle, validateStyle);
            subs.styles = [subs.defaultStyle, 
                ...o.styles.map((x) => parseObject(x, validateStyle))];
            subs.migrated = true;
        } else {
            subs.styles = o.styles.map((x) => parseObject(x, validateStyle));
            const def = subs.styles.find((x) => x.name == o.defaultStyle);
            if (def === undefined) throw new SubtitlesParseError('invalid default style name');
        }

        subs.entries = o.entries
            .map((x) => SubtitleEntry.deserialize(x, subs, version))
            .filter((x) => x.texts.size > 0);
        return subs;
    }
}