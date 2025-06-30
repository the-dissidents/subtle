import { Debug } from "../Debug";
import { MigrationDuplicatedStyles, parseSubtitleStyle, SubtitleEntry, Subtitles, ZMetadata, type SubtitleFormat, type SubtitleStyle } from "./Subtitles.svelte";
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
 */
export const SubtitleFormatVersion = '000404';

const ZView = z.object({
    perEntryColumns: z.array(z.string()),
    perChannelColumns: z.array(z.string()),
    timelineExcludeStyles: z.array(z.string())
});

function serializeView(view: Subtitles['view']) {
    return {
        perEntryColumns: view.perEntryColumns,
        perChannelColumns: view.perChannelColumns,
        timelineExcludeStyles: [...view.timelineExcludeStyles].map((x) => x.name)
    };
}

function parseView(o: any, subs: Subtitles, version: string) {
    let sv = parseObjectZ(o, ZView);
    // currently this doesn't detect whether the metrics are really valid
    // e.g. entry columns should not be channel metrics
    subs.view.perEntryColumns = sv.perEntryColumns.filter((x) => 
        x in Metrics && Metrics[x as keyof typeof Metrics]);
    subs.view.perChannelColumns = sv.perChannelColumns.filter((x) => 
        x in Metrics && Metrics[x as keyof typeof Metrics]);
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
        const o = JSON.parse(source);
        const version = o.version ?? '0';
        let subs = new Subtitles();

        if (o.metadata) subs.metadata = parseObjectZ(o.metadata, ZMetadata);

        const styles = o.styles, entries = o.entries;
        if (o.defaultStyle === undefined || !Array.isArray(styles) || !Array.isArray(entries))
            throw new DeserializationError('missing properties');

        if (version < '000400') {
            // pre 0.4: the default style is defined outside the styles array
            let defaultStyle = $state(parseSubtitleStyle(o.defaultStyle))
            subs.defaultStyle = defaultStyle;
            subs.styles = [defaultStyle, ...styles.map((x) => {
                let style = $state(parseSubtitleStyle(x));
                return style;
            })];
            subs.migrated = 'olderVersion';
        } else {
            if (version > SubtitleFormatVersion) {
                subs.migrated = 'newerVersion';
            }
            subs.styles = styles.map((x) => {
                let style = $state(parseSubtitleStyle(x));
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

        return { done: () => subs };
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