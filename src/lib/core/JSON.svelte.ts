import { Ajv, type JSONSchemaType, type ValidateFunction } from "ajv";
import { Debug } from "../Debug";
import { MigrationDuplicatedStyles, SubtitleEntry, SubtitleFormatVersion, Subtitles, SubtitlesParseError, type SubtitleFormat, type SubtitleMetadata, type SubtitleStyle } from "./Subtitles.svelte";

const ajv = new Ajv({
    removeAdditional: true,
    useDefaults: true
});

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
    required: ['special']
}

const validateStyle = ajv.compile(StyleSchema);
const validateMetadata = ajv.compile(MetadataSchema);

function parseObject<T>(obj: {}, validator: ValidateFunction<T>): T {
    if (!validator(obj)) {
        Debug.debug(validator.errors);
        throw new SubtitlesParseError(validator.errors!.map((x) => x.message).join('; '));
    }
    return obj;
}

function serializeEntry(entry: SubtitleEntry) {
    return {
        start: entry.start,
        end: entry.end,
        label: entry.label,
        texts: [...[...entry.texts.entries()]
            .map(([style, text]) => [style.name, text] as const)]
    }
}

function parseEntry(
    o: any, subs: Subtitles, version: string
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
        if (!style) throw new SubtitlesParseError(`invalid style name: ${styleName}`);

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
                    Debug.debug('migrate: new duplicate style:', found.name);
                }
            } else {
                found = createDuplicateStyle(style);
                MigrationDuplicatedStyles.set(style, [found]);
                Debug.debug('migrate: new duplicate style:', found.name);
            }
            style = found;
        }
        entry.texts.set(style, text);
    }
    return entry;
}

export const JSONSubtitles: SubtitleFormat = {
    parse(source) {
        const o = globalThis.JSON.parse(source);
        const version = o.version ?? '0';
        let subs = new Subtitles();
        if (o.metadata) {
            subs.metadata = parseObject(o.metadata, validateMetadata);
        }

        const styles = o.styles, entries = o.entries;
        if (o.defaultStyle === undefined || !Array.isArray(styles) || !Array.isArray(entries))
            throw new SubtitlesParseError('missing properties');

        if (version < '000400') {
            // pre 0.4: the default style is defined outside the styles array
            let defaultStyle = $state(parseObject(o.defaultStyle, validateStyle))
            subs.defaultStyle = defaultStyle;
            subs.styles = [defaultStyle, ...styles.map((x) => {
                let style = $state(parseObject(x, validateStyle));
                return style;
            })];
            subs.migrated = 'olderVersion';
        } else {
            subs.styles = styles.map((x) => {
                let style = $state(parseObject(x, validateStyle));
                return style;
            });
            const def = subs.styles.find((x) => x.name == o.defaultStyle);
            if (def === undefined) throw new SubtitlesParseError('invalid default style name');
            subs.defaultStyle = def;
        }

        subs.entries = entries
            .map((x) => parseEntry(x, subs, version))
            .filter((x) => x.texts.size > 0);
        return subs;
    },

    write(subs, options) {
        return globalThis.JSON.stringify({
            version: SubtitleFormatVersion,
            metadata: subs.metadata,
            defaultStyle: subs.defaultStyle.name,
            styles: subs.styles,
            entries: (options?.useEntries ?? subs.entries)
                .map((x) => serializeEntry(x)),
        }, undefined, 2);
    },
}