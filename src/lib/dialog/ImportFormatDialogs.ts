import { type ImportFormat } from "./ImportFormatDialog.svelte";
import type { SubtitleParser } from "../core/Subtitles.svelte";
import { ASSParser, type ASSParseMessage } from "../core/ASS.svelte";
import { Debug } from "../Debug";

import { _, unwrapFunctionStore } from 'svelte-i18n';
import type { SRTParseMessage, SRTParser } from "../core/SRT.svelte";
import type { JSONParseMessage, JSONParser } from "../core/JSON.svelte";
import { openDialog } from "../DialogOutlet.svelte";
const $_ = unwrapFunctionStore(_);

async function show<P extends SubtitleParser>(
    parser: P, skippable: boolean, format: ImportFormat<P>
) {
    parser.update();
    if (parser.messages.length == 0 && skippable)
        return parser.done();

    return await openDialog(
        (await import('./ImportFormatDialog.svelte')).default<P>, parser, format);
}

export const ImportFormatDialogs = {
    JSON: (p: JSONParser) => show(p, true, {
        header: $_('jsonimport.header'),
        formatMessage(type, group) {
            const map = <Ty extends JSONParseMessage['type']>(
                f: (x: Extract<JSONParseMessage, { type: Ty; }>) => string
            ) => // @ts-expect-error -- well, help me clean this up
                group.map(f);

            const one = <Ty extends JSONParseMessage['type']>(
                f: (x: Extract<JSONParseMessage, { type: Ty; }>) => string
            ) => // @ts-expect-error -- the same
                f(group[0]);

            switch (type) {
                case 'fixed-style': return {
                    heading: $_('jsonimport.fixed-style'),
                    description: $_('jsonimport.fixed-style-d'),
                    items: map<'fixed-style'>((x) => 
                        $_('jsonimport.fixed-style-item', {values: {a: x.name, b: x.occurrence}}))
                };
                case 'migrated-newer': return {
                    heading: $_('jsonimport.migrated-newer-from', 
                        {values: {from: one<'migrated-newer'>((x) => x.from)}}),
                    description: $_('jsonimport.migrated-newer-from-d')
                };
                case 'migrated-older': return {
                    heading: $_('jsonimport.migrated-older', 
                        {values: {from: one<'migrated-older'>((x) => x.from)}}),
                    description: $_('jsonimport.migrated-older-d')
                };
            }
        },
        categoryDescription() {
            return undefined;
        },
    }),

    SRT: (p: SRTParser) => show(p, true, {
        header: $_('srtimport.header'),
        formatMessage(type, group) {
            const one = <Ty extends SRTParseMessage['type']>(
                f: (x: Extract<SRTParseMessage, { type: Ty; }>) => string
            ) => // @ts-expect-error -- ...
                f(group[0]);

            switch (type) {
                case 'ignored-coordinates': return {
                    heading: $_('srtimport.ignored-coordinates') + ' '
                        + one<'ignored-coordinates'>((x) => 
                            $_('assimport.occurred-n-times', {values: {n: x.occurrence}})),
                    description: $_('srtimport.coordinates-info')
                };
                case 'ignored-format-tags': return {
                    heading: $_('srtimport.ignored-format-tags') + ' '
                        + one<'ignored-coordinates'>((x) => 
                            $_('assimport.occurred-n-times', {values: {n: x.occurrence}})),
                    description: $_('srtimport.info')
                };
                default:
                    Debug.never(type);
            }
        },
        categoryDescription: () => undefined,
        options: [
            {
                type: 'boolean',
                name: $_('assimport.preserve-tags'),
                getValue: (p) => p.preserveTags,
                setValue: (p, v) => p.preserveTags = v
            },
        ]
    }),

    ASS: (p: ASSParser) => show(p, false, {
        header: $_('assimport.header'),
        formatMessage(type, group) {
            const map = <Ty extends ASSParseMessage['type']>(
                f: (x: Extract<ASSParseMessage, { type: Ty; }>) => string
            ) => // @ts-expect-error -- ...
                group.map(f);
            
            const one = <Ty extends ASSParseMessage['type']>(
                f: (x: Extract<ASSParseMessage, { type: Ty; }>) => string
            ) => // @ts-expect-error -- ...
                f(group[0]);

            switch (type) {
                case 'duplicate-style-definition': return {
                    heading: $_('assimport.duplicate-style-definition'),
                    items: map<'duplicate-style-definition'>((x) => x.name)
                };
                case 'undefined-style': return {
                    heading: $_('assimport.undefined-style'),
                    items: map<'undefined-style'>((x) => x.name)
                };
                case 'no-styles': return {
                    heading: $_('assimport.no-styles')
                };
                case 'invalid-style-field': return {
                    heading: $_('assimport.invalid-style-field'),
                    items: map<'invalid-style-field'>((w) => $_('assimport.in-a-b-equals-c', 
                        {values: {a: w.name, b: w.field, c: w.value}}))
                };
                case 'invalid-event-field': return {
                    heading: $_('assimport.invalid-event-field'),
                    items: map<'invalid-event-field'>((w) => 
                        $_('assimport.in-line-a-b-equals-c', 
                            {values: {a: w.line, b: w.field, c: w.value}}))
                };
                
                case 'ignored-style-field': return {
                    heading: $_('assimport.ignored-style-field'),
                    items: map<'invalid-style-field'>((w) => 
                        $_('assimport.in-a-b-equals-c', 
                            {values: {a: w.name, b: w.field, c: w.value}}))
                };
                case 'ignored-event-field': return {
                    heading: $_('assimport.ignored-event-field'),
                    items: map<'invalid-event-field'>((w) => 
                        $_('assimport.in-line-a-b-equals-c', 
                            {values: {a: w.line, b: w.field, c: w.value}}))
                };
                case 'ignored-special-character': return {
                    heading: $_('assimport.ignored-special-character') + ' '
                        + one<'ignored-special-character'>((x) => 
                            $_('assimport.occurred-n-times', {values: {n: x.occurrence}})),
                };
                case 'ignored-drawing-command': return {
                    heading: $_('assimport.ignored-drawing-command') + ' '
                        + one<'ignored-drawing-command'>((x) => 
                            $_('assimport.occurred-n-times', {values: {n: x.occurrence}})),
                };
                case 'ignored-override-tag': return {
                    heading: $_('assimport.ignored-override-tag') + ' '
                        + one<'ignored-override-tag'>((x) => 
                            $_('assimport.occurred-n-times', {values: {n: x.occurrence}})),
                    description: $_('assimport.info-override-tag')
                };
                case 'ignored-embedded-fonts': return {
                    heading: $_('assimport.ignored-embedded-fonts'),
                };
                default:
                    Debug.never(type);
            }
        },
        categoryDescription(category) {
            switch (category) {
                case "invalid":
                    return $_('assimport.info-invalid');
                case "unsupported":
                    return $_('assimport.info-ignored');
            }
        },
        options: [
            {
                type: 'boolean',
                name: $_('assimport.preserve-inlines'),
                getValue: (p) => p.preserveInlines,
                setValue: (p, v) => p.preserveInlines = v
            },
            {
                type: 'boolean',
                name: $_('assimport.transform-inline-multichannel'),
                description: $_('assimport.transform-info'),
                getValue: (p) => p.transformInlineMultichannel,
                setValue: (p, v) => p.transformInlineMultichannel = v
            }
        ]
    })
};