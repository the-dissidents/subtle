import { type JSONSchemaType } from "ajv";
import { Debug } from "../Debug";
import { MigrationDuplicatedStyles, SubtitleEntry, Subtitles, type SubtitleFormat, type SubtitleMetadata, type SubtitleStyle } from "./Subtitles.svelte";
import { ajv, DeserializationError, parseObject } from "../Serialization";
import { FilterSchema, Metrics, type MetricName } from "./Filter";
import { SvelteSet } from "svelte/reactivity";

/**
 * Version details:
 *  - 000400 (major) styles includes defaultStyle, which is just a name; channels are unordered
 *  - 000402 (minor) styles have validators
 *  - 000403 (minor) scaling factor in metadata
 *  - 000404 (minor) view in archive
 */
export const SubtitleFormatVersion = '000404';

// FIXME: should not repeat the default values here, already defined in Subtitle.svelte.ts
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
        alignment: { type: 'integer', minimum: 1, maximum: 9, default: 2 },
        validator: { 
            anyOf: [FilterSchema, { type: 'null' }],
            default: null
        } as any
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
        scalingFactor: { type: 'number', exclusiveMinimum: 0, default: 1 },
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

type SerializedView = {
    perEntryColumns: string[],
    perChannelColumns: string[],
    timelineExcludeStyles: string[]
}

const ViewSchema: JSONSchemaType<SerializedView> = {
    type: 'object',
    properties: {
        perEntryColumns: { 
            type: 'array', items: { type: 'string' }, 
            default: ['startTime', 'endTime'] 
        },
        perChannelColumns: { 
            type: 'array', items: { type: 'string' }, 
            default: ['style', 'content'] 
        },
        timelineExcludeStyles: { 
            type: 'array', items: { type: 'string' }, 
            default: [] 
        }
    },
    required: []
}

const validateStyle = ajv.compile(StyleSchema);
const validateMetadata = ajv.compile(MetadataSchema);
const validateView = ajv.compile(ViewSchema);

function serializeView(view: Subtitles['view']) {
    return {
        perEntryColumns: view.perEntryColumns,
        perChannelColumns: view.perChannelColumns,
        timelineExcludeStyles: [...view.timelineExcludeStyles].map((x) => x.name)
    };
}

function parseView(o: any, subs: Subtitles, version: string) {
    let sv = parseObject(o, validateView);
    subs.view.perEntryColumns = sv.perEntryColumns.filter((x) => 
        x in Metrics && Metrics[x as MetricName].per == 'entry') as MetricName[];
    subs.view.perChannelColumns = sv.perChannelColumns.filter((x) => 
        x in Metrics && Metrics[x as MetricName].per == 'channel') as MetricName[];
    const styleMap = new Map(subs.styles.map((x) => [x.name, x]));
    if (sv.timelineExcludeStyles.some((x) => !styleMap.has(x)))
        throw new DeserializationError('invalid item in timelineExcludeStyles');
    subs.view.timelineExcludeStyles = 
        new SvelteSet(sv.timelineExcludeStyles.map((x) => styleMap.get(x)!));
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
        if (!style) throw new DeserializationError(`invalid style name: ${styleName}`);

        if (entry.texts.has(style)) {
            if (version >= '000400') throw new DeserializationError(
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

        if (o.metadata) subs.metadata = parseObject(o.metadata, validateMetadata);

        const styles = o.styles, entries = o.entries;
        if (o.defaultStyle === undefined || !Array.isArray(styles) || !Array.isArray(entries))
            throw new DeserializationError('missing properties');

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
            if (version > SubtitleFormatVersion) {
                subs.migrated = 'newerVersion';
            }
            subs.styles = styles.map((x) => {
                let style = $state(parseObject(x, validateStyle));
                return style;
            });
            const def = subs.styles.find((x) => x.name == o.defaultStyle);
            if (def === undefined) throw new DeserializationError('invalid default style name');
            subs.defaultStyle = def;
        }

        if (o.view) parseView(o.view, subs, version);

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
            view: serializeView(subs.view),
            entries: (options?.useEntries ?? subs.entries)
                .map((x) => serializeEntry(x)),
        }, undefined, 2);
    },
}