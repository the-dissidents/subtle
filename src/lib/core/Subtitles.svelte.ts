import { Ajv, type JSONSchemaType, type ValidateFunction } from "ajv";

const SubtitleFormatVersion = '000303';

export const Labels = ['none', 'red', 'orange', 'yellow', 'green', 'blue', 'purple'] as const;
export type LabelTypes = typeof Labels[number];

export enum AlignMode {
    BottomLeft = 1, BottomCenter, BottomRight,
    CenterLeft, Center, CenterRight,
    TopLeft, TopCenter, TopRight,
}

const ajv = new Ajv({
    removeAdditional: true,
    useDefaults: true
});

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
        throw new Error();
    }
    return obj;
}

export type SubtitleChannel = {
    style: SubtitleStyle,
    text: string,
    // FIXME: I don't consider this a good practice, but we have to store which channel corresponds to which text area, if any
    gui?: HTMLTextAreaElement
}

export class SubtitleEntry {
    label: LabelTypes = $state('none');
    texts: SubtitleChannel[] = $state([]);
    start: number = $state(0);
    end: number = $state(0);

    static #counter = 0;
    readonly uniqueID: number;

    constructor(
        start: number,
        end: number,
        ...text: SubtitleChannel[]) 
    {
        this.start = start;
        this.end = end;
        this.texts = text;
        this.uniqueID = SubtitleEntry.#counter;
        SubtitleEntry.#counter++;
    }

    toSerializable() {
        return {
            start: this.start,
            end: this.end,
            label: this.label,
            texts: this.texts.map((x) => [x.style.name, x.text])
        }
    }

    static deserialize(o: ReturnType<SubtitleEntry['toSerializable']>, subs: Subtitles) {
        let entry = new SubtitleEntry(o.start, o.end, 
            ...o.texts.map((x) => ({
                style: subs.styles.find((s) => s.name == x[0]) ?? subs.defaultStyle, 
                text: x[1]
            })));
        if (o.label) entry.label = o.label;
        return entry;
    }
}

export class Subtitles {
    metadata: SubtitleMetadata = $state(Subtitles.#createMetadata());
    defaultStyle: SubtitleStyle = $state(Subtitles.createStyle('default'));
    styles: SubtitleStyle[] = $state([]);
    entries: SubtitleEntry[] = [];

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
            this.defaultStyle = structuredClone(base.defaultStyle);
            this.styles = base.styles.map((x) => structuredClone(x));
        }
    }

    toSerializable() {
        return {
            version: SubtitleFormatVersion,
            metadata: this.metadata,
            defaultStyle: this.defaultStyle,
            styles: this.styles,
            entries: this.entries.map((x) => x.toSerializable()),
        }
    }

    static deserialize(o: ReturnType<Subtitles['toSerializable']>) {
        let subs = new Subtitles();
        if (o.metadata) {
            if (!validateMetadata(o.metadata)) {
                console.log(validateMetadata.errors);
                throw new Error();
            }
            subs.metadata = o.metadata;
        }

        subs.defaultStyle = parseObject(o.defaultStyle, validateStyle);
        subs.styles = o.styles.map((x) => parseObject(x, validateStyle));
        subs.entries = o.entries
            .map((x) => SubtitleEntry.deserialize(x, subs))
            .filter((x) => x.texts.length > 0);
        return subs;
    }
}