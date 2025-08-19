import { Debug } from "../Debug";
import { parseSubtitleStyle, SubtitleEntry, Subtitles, ZMetadata, type SubtitleFormat, type SubtitleStyle, type SubtitleParser } from "./Subtitles.svelte";
import { DeserializationError, parseObjectZ } from "../Serialization";
import { Metrics } from "./Filter";
import { SvelteSet } from "svelte/reactivity";

import * as z from "zod/v4-mini";

/**
 * Version details:
 *  - 000400 (major) styles includes defaultStyle, which is just a name; channels are unordered
 *  - 000402 (minor) styles have validators
 *  - 000403 (minor) scaling factor in metadata
 *  - 000404 (minor) view in archive
 *  - 000501 (minor) timelineActiveChannel in view
 *  - 000502 (minor) uiState structure in metadata
 */
export const SubtitleFormatVersion = '000502';
export const SubtitleCompatibleVersion = '000400';

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

function serializeEntry(entry: SubtitleEntry) {
    return {
        start: entry.start,
        end: entry.end,
        label: entry.label,
        texts: [...[...entry.texts.entries()]
            .map(([style, text]) => [style.name, text] as const)]
    }
}

export class JSONParser implements SubtitleParser {
    #version: string;
    #obj: any;
    #messages: JSONParseMessage[] = [];
    #subs: Subtitles;

    #duplicatedStyles = new Map<SubtitleStyle, SubtitleStyle[]>();
    
    get messages() {
        return this.#messages;
    }

    constructor(source: string) {
        this.#obj = JSON.parse(source);
        this.#version = this.#obj.version ?? '0';
        this.#subs = new Subtitles();

        if (this.#version > SubtitleFormatVersion) {
            this.#subs.migrated = 'newerVersion';
            this.#messages.push({
                type: 'migrated-newer',
                category: 'migrated',
                from: this.#version
            });
        } else if (this.#version < SubtitleCompatibleVersion) {
            this.#messages.push({
                type: 'migrated-older',
                category: 'migrated',
                from: this.#version
            });
        }

        if (this.#obj.metadata) {
            if (!this.#obj.metadata.uiState)
                this.#obj.metadata.uiState = {};
            this.#subs.metadata = parseObjectZ(this.#obj.metadata, ZMetadata);
        }
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
        let sv = parseObjectZ(this.#obj.view, ZView);
        // currently this doesn't detect whether the metrics are really valid
        // e.g. entry columns should not be channel metrics
        this.#subs.view.perEntryColumns = sv.perEntryColumns.filter((x) => 
            x in Metrics && Metrics[x as keyof typeof Metrics]);
        this.#subs.view.perChannelColumns = sv.perChannelColumns.filter((x) => 
            x in Metrics && Metrics[x as keyof typeof Metrics]);
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
        if (defaultStyle === undefined || !Array.isArray(styles))
            throw new DeserializationError('missing properties');

        if (this.#version < '000400') {
            // pre 0.4: the default style is defined outside the styles array
            let def = $state(parseSubtitleStyle(this.#obj.defaultStyle))
            this.#subs.defaultStyle = def;
            this.#subs.styles = [def, ...styles.map((x) => {
                let style = $state(parseSubtitleStyle(x));
                return style;
            })];
            this.#subs.migrated = 'olderVersion';
        } else {
            if (typeof defaultStyle !== 'string')
                throw new DeserializationError('invalid default style');
            this.#subs.styles = styles.map((x) => {
                let style = $state(parseSubtitleStyle(x));
                return style;
            });
            const def = this.#subs.styles.find((x) => x.name == defaultStyle);
            if (def === undefined)
                throw new DeserializationError('invalid default style name');
            this.#subs.defaultStyle = def;
        }
    }

    #createDuplicateStyle(from: SubtitleStyle) {
        for (let i = 1; ; i++) {
            const name = from.name + ` (${i})`;
            if (!this.#subs.styles.find((x) => x.name == name)) {
                const copy = $state.snapshot(from);
                const style = $state(copy);
                style.name = name;
                this.#subs.styles.push(style);
                return style;
            }
        }
    }

    #parseEntry(o: any): SubtitleEntry {
        let entry = new SubtitleEntry(o.start, o.end);
        if (o.label) entry.label = o.label;

        for (const [styleName, text] of o.texts) {
            let style = this.#subs.styles.find((x) => x.name == styleName);
            if (!style) throw new DeserializationError(`invalid style name: ${styleName}`);

            if (entry.texts.has(style)) {
                if (this.#version >= '000400') Debug.warn(
                    `note: style appeared multiple time in one entry: ${styleName}: in`, o);

                // migrate pre-0.4 styles
                let duplicated = this.#duplicatedStyles.get(style);
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
        } catch (_) {
            return false;
        }
    },

    parse(source) {
        return new JSONParser(source);
    },

    write(subs) {
        let options = {useEntries: undefined as SubtitleEntry[] | undefined};
        let obj = {
            useEntries(e: SubtitleEntry[]) {
                options.useEntries = e;
                return obj;
            },
            toString: () => JSON.stringify({
                version: SubtitleFormatVersion,
                metadata: subs.metadata,
                defaultStyle: subs.defaultStyle.name,
                styles: subs.styles,
                view: serializeView(subs.view),
                entries: (options.useEntries ?? subs.entries)
                    .map((x) => serializeEntry(x)),
            }, undefined, 2)
        }
        return obj;
    }
} satisfies SubtitleFormat;