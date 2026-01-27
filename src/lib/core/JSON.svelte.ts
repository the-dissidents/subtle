import { Debug } from "../Debug";
import { SubtitleEntry, Subtitles, SubtitleStyle, ZMetadata, type SubtitleFormat, type SubtitleParser, ZStyleBase } from "./Subtitles.svelte";
import { LABEL_TYPES } from "./Labels";
import { DeserializationError, parseObjectZ } from "../Serialization";
import { Filter, Metrics } from "./Filter";
import { SvelteSet } from "svelte/reactivity";

import * as z from "zod/v4-mini";
import { ZRichText } from "./RichText";

/**
 * Version details:
 *  - 000400 (major) styles includes defaultStyle, which is just a name; channels are unordered
 *  - 000402 (minor) styles have validators
 *  - 000403 (minor) scaling factor in metadata
 *  - 000404 (minor) view in archive
 *  - 000501 (minor) timelineActiveChannel in view
 *  - 000502 (minor) uiState structure in metadata
 *  - 000503 (minor) shadow color in style
 *  - 000700 (major) inline formatting through RichText
 *                   wrapStyle in style
 */
export const SubtitleFormatVersion = '000700';
export const SubtitleCompatibleVersion = '000700';

export type JSONParseMessage = {
    type: 'fixed-style',
    category: 'fixed',
    name: string,
    occurrence: number
} | {
    type: 'migrated-older',
    category: 'migrated',
    from: string,
} | {
    type: 'migrated-newer',
    category: 'migrated',
    from: string
};

const ZView = z.object({
    perEntryColumns: z.array(z.string()),
    perChannelColumns: z.array(z.string()),
    timelineExcludeStyles: z.array(z.string()),
    timelineActiveChannel: z._default(z.nullable(z.string()), null)
});

function serializeView(view: Subtitles['view']) {
    return {
        perEntryColumns: view.perEntryColumns,
        perChannelColumns: view.perChannelColumns,
        timelineExcludeStyles: [...view.timelineExcludeStyles].map((x) => x.name),
        timelineActiveChannel: view.timelineActiveChannel?.name ?? null
    };
}

const ZEntry = z.object({
    start: z.number(),
    end: z.number(),
    label: z.enum(LABEL_TYPES),
    texts: z.array(z.readonly(z.tuple([
        z.string(), 
        ZRichText
    ])))
});

function serializeEntry(entry: SubtitleEntry): z.infer<typeof ZEntry> {
    return {
        start: entry.start,
        end: entry.end,
        label: entry.label,
        texts: [...entry.texts.entries()]
            .map(([style, text]) => [style.name, text] as const)
    }
}

const ZDocument = z.object({
    version: z.string(),
    metadata: ZMetadata,
    view: ZView,
    defaultStyle: z.string(),
    styles: z.array(ZStyleBase),
    entries: z.array(ZEntry)
});

export class JSONParser implements SubtitleParser {
    #obj: z.infer<typeof ZDocument>;
    #messages: JSONParseMessage[] = [];
    #subs: Subtitles;

    #duplicatedStyles = new Map<SubtitleStyle, SubtitleStyle[]>();
    
    get messages() {
        return this.#messages;
    }

    constructor(source: string) {
        const jsonObj = JSON.parse(source);
        this.#obj = parseObjectZ(jsonObj, ZDocument, 'JSON document');

        this.#subs = new Subtitles();

        if (this.#obj.version > SubtitleFormatVersion) {
            this.#subs.migrated = 'newerVersion';
            this.#messages.push({
                type: 'migrated-newer',
                category: 'migrated',
                from: this.#obj.version
            });
        } else if (this.#obj.version < SubtitleCompatibleVersion) {
            this.#messages.push({
                type: 'migrated-older',
                category: 'migrated',
                from: this.#obj.version
            });
        }
        
        this.#subs.metadata = this.#obj.metadata;
        this.#parseStyles();
        this.#parseView();

        const entries = this.#obj.entries;
        if (!Array.isArray(entries))
            throw new DeserializationError('missing properties');
        this.#subs.entries = entries
            .map((x) => this.#parseEntry(x))
            .filter((x) => x.texts.size > 0);

        for (const [k, v] of this.#duplicatedStyles)
            this.#messages.push({
                type: 'fixed-style',
                category: 'fixed',
                name: k.name,
                occurrence: v.length
            });
    }

    done(): Subtitles {
        return this.#subs;
    }

    update(): void { }

    #parseView() {
        if (!this.#obj.view) return;
        const sv = this.#obj.view;
        this.#subs.view.perEntryColumns = sv.perEntryColumns.filter(
            (x) => x in Metrics && Metrics[x].context == 'entry');
        this.#subs.view.perChannelColumns = sv.perChannelColumns.filter(
            (x) => x in Metrics && 
                (Metrics[x].context == 'channel' || Metrics[x].context == 'style'));

        const styleMap = new Map(this.#subs.styles.map((x) => [x.name, x]));
        if (sv.timelineExcludeStyles.some((x) => !styleMap.has(x)))
            throw new DeserializationError('invalid item in timelineExcludeStyles');
        this.#subs.view.timelineExcludeStyles = 
            new SvelteSet(sv.timelineExcludeStyles.map((x) => styleMap.get(x)!));
        
        if (sv.timelineActiveChannel) {
            if (!styleMap.has(sv.timelineActiveChannel))
                throw new DeserializationError('invalid timelineActiveChannel');
            this.#subs.view.timelineActiveChannel = styleMap.get(sv.timelineActiveChannel)!;
        }
    }

    #parseStyles() {
        const styles = this.#obj.styles;
        const defaultStyle = this.#obj.defaultStyle;
        
        this.#subs.styles = styles.map((x) => {
            const style = $state({...x, validator: null});
            return style;
        });
        const def = this.#subs.styles.find((x) => x.name == defaultStyle);
        if (def === undefined)
            throw new DeserializationError('invalid default style name');
        this.#subs.defaultStyle = def;

        // now go back and add validators 
        // since parsing filters requires access to all the styles
        styles.forEach((x) => {
            if (!x.validator) return;
            this.#subs.styles.find((x) => x.name == x.name)!.validator = 
                Filter.deserialize(x.validator, this.#subs);
        });
    }

    #createDuplicateStyle(from: SubtitleStyle) {
        for (let i = 1; ; i++) {
            const name = from.name + ` (${i})`;
            if (!this.#subs.styles.find((x) => x.name == name)) {
                const style = $state(SubtitleStyle.clone(from));
                style.name = name;
                this.#subs.styles.push(style);
                return style;
            }
        }
    }

    #parseEntry(obj: z.infer<typeof ZEntry>): SubtitleEntry {
        const entry = new SubtitleEntry(obj.start, obj.end);
        entry.label = obj.label;

        for (const [styleName, text] of obj.texts) {
            let style = this.#subs.styles.find((x) => x.name == styleName);
            if (!style) throw new DeserializationError(`invalid style name: ${styleName}`);

            if (entry.texts.has(style)) {
                Debug.warn(`note: style appeared multiple times in one entry: ${styleName}: in`, obj);

                const duplicated = this.#duplicatedStyles.get(style);
                let found: SubtitleStyle | undefined;
                if (duplicated) {
                    found = duplicated.find((x) => !entry.texts.has(x));
                    if (!found) {
                        found = this.#createDuplicateStyle(style);
                        duplicated.push(found);
                        Debug.debug('migrate: new duplicate style:', found.name);
                    }
                } else {
                    found = this.#createDuplicateStyle(style);
                    this.#duplicatedStyles.set(style, [found]);
                    Debug.debug('migrate: new duplicate style:', found.name);
                }
                style = found;
            }
            entry.texts.set(style, text);
        }
        return entry;
    }
}

export const JSONSubtitles = {
    detect(source) {
        try {
            JSON.parse(source);
            return true;
        } catch {
            return false;
        }
    },

    parse(source) {
        return new JSONParser(source);
    },

    write(subs) {
        const options = {useEntries: undefined as SubtitleEntry[] | undefined};
        const obj = {
            useEntries(e: SubtitleEntry[]) {
                options.useEntries = e;
                return obj;
            },
            toString: () => JSON.stringify({
                version: SubtitleFormatVersion,
                metadata: subs.metadata,
                defaultStyle: subs.defaultStyle.name,
                styles: subs.styles.map((x) => SubtitleStyle.serialize(x)),
                view: serializeView(subs.view),
                entries: (options.useEntries ?? subs.entries)
                    .map((x) => serializeEntry(x)),
            }, undefined, 2)
        }
        return obj;
    }
} satisfies SubtitleFormat;