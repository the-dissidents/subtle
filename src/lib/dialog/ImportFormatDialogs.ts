import type { ImportFormat } from "./ImportFormatDialog.svelte";
import type { SubtitleParser } from "../core/formats/Format";
import { ASSParser, type ASSParseMessage } from "../core/formats/ASS.svelte";
import type { SRTParseMessage, SRTParser } from "../core/formats/SRT.svelte";
import { STLParser, type STLParseMessage } from "../core/formats/STL.svelte";
import { Debug } from "../Debug";

import type { JSONParseMessage, JSONParser } from "../core/JSON.svelte";
import { openDialog } from "../DialogOutlet.svelte";
import { _, unwrapFunctionStore } from 'svelte-i18n';
import { Basic } from "../Basic";
const $_ = unwrapFunctionStore(_);

async function show<P extends SubtitleParser>(
    parser: P, skippable: boolean, format: ImportFormat<P>
) {
    const ret = await parser.decode();
    if (ret.messages.length == 0 && skippable)
        return ret.subs;

    return await openDialog(
        (await import('./ImportFormatDialog.svelte')).default<P>, parser, format);
}

export const ImportFormatDialogs = {
    JSON: (p: JSONParser, skippable = true) => show(p, skippable, {
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
                case 'incompatible-filter': return {
                    heading: $_('jsonimport.incompatible-filter'),
                    items: map<'incompatible-filter'>((x) => $_('jsonimport.in-style') + x.name)
                };
                case 'incompatible-linter': return {
                    heading: $_('jsonimport.incompatible-linter'),
                    items: map<'incompatible-filter'>((x) => $_('jsonimport.in-style') + x.name)
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
        categoryDescription: (x) =>
            x == 'incompatible' ? $_('jsonimport.incompatible')
            : undefined,
    }),

    SRT: (p: SRTParser, skippable = false) => show(p, skippable, {
        header: $_('srtimport.header'),
        formatMessage(type, group) {
            const map = <Ty extends SRTParseMessage['type']>(
                f: (x: Extract<SRTParseMessage, { type: Ty; }>) => string
            ) => // @ts-expect-error -- ...
                group.map(f);

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
                case 'ignored-format-tag': return {
                    heading: $_('srtimport.ignored-format-tags'),
                    items: map<'unsupported-override-tag'>((x) =>
                          x.name + $_('assimport.occurred-n-times', {values: {n: x.occurrence}})),
                    description: $_('srtimport.info')
                };
                case 'unsupported-override-tag': return {
                    heading: $_('assimport.unsupported-override-tag'),
                    items: map<'unsupported-override-tag'>((x) =>
                          x.name + $_('assimport.occurred-n-times', {values: {n: x.occurrence}})),
                };
                case 'ignored-special-character': return {
                    heading: $_('assimport.ignored-special-character'),
                    items: map<'ignored-special-character'>((x) =>
                          x.name + $_('assimport.occurred-n-times', {values: {n: x.occurrence}})),
                };
                case 'invalid-color-name': return {
                    heading: $_('srtimport.invalid-color') + ' '
                        + one<'invalid-color-name'>((x) =>
                            $_('assimport.occurred-n-times', {values: {n: x.occurrence}})),
                };
                default:
                    Debug.never(type);
            }
        },
        categoryDescription: () => undefined,
    }),

    ASS: (p: ASSParser, skippable = false) => show(p, skippable, {
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
                    heading: $_('assimport.ignored-special-character'),
                    items: map<'ignored-special-character'>((x) =>
                          x.name + $_('assimport.occurred-n-times', {values: {n: x.occurrence}})),
                };
                case 'ignored-drawing-command': return {
                    heading: $_('assimport.ignored-drawing-command') + ' '
                        + one<'ignored-drawing-command'>((x) =>
                            $_('assimport.occurred-n-times', {values: {n: x.occurrence}})),
                };
                case 'unsupported-override-tag': return {
                    heading: $_('assimport.unsupported-override-tag'),
                    items: map<'unsupported-override-tag'>((x) =>
                          x.name + $_('assimport.occurred-n-times', {values: {n: x.occurrence}})),
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
    }),

    STL: (p: STLParser, skippable = false) => show(p, skippable, {
        header: $_('stlimport.header'),
        formatMessage(type, group) {
            const map = <Ty extends STLParseMessage['type']>(
                f: (x: Extract<STLParseMessage, { type: Ty; }>) => string
            ) => // @ts-expect-error -- ...
                group.map(f);

            const one = <Ty extends STLParseMessage['type']>(
                f: (x: Extract<STLParseMessage, { type: Ty; }>) => string
            ) => // @ts-expect-error -- ...
                f(group[0]);

            switch (type) {
                case 'unknown-control-byte': return {
                    heading: $_('stlimport.unknown-control-byte'),
                    items: map<'unknown-control-byte'>((x) =>
                        `0x${x.byte.toString(16).toUpperCase().padStart(2, '0')} `
                        + $_('assimport.occurred-n-times', {values: {n: x.occurrence}})),
                };
                case 'ignored-color-code': return {
                    heading: $_('stlimport.ignored-color-code') + ' '
                        + one<'ignored-color-code'>((x) =>
                            $_('assimport.occurred-n-times', {values: {n: x.occurrence}})),
                };
                case 'user-data-block': return {
                    heading: $_('stlimport.user-data-block') + ' '
                        + one<'user-data-block'>((x) =>
                            $_('assimport.occurred-n-times', {values: {n: x.occurrence}})),
                };
                case 'timecode-starts-at-1h': return {
                    heading: $_('stlimport.timecode-starts-at') + ' '
                        + one<'timecode-starts-at-1h'>((x) =>
                            Basic.formatTimestamp(x.start, 0, '.')),
                    description: $_('stlimport.timecode-starts-at-d')
                }
                default:
                    Debug.never(type);
            }
        },
        categoryDescription(category) {
            switch (category) {
                case "unsupported":
                    return $_('stlimport.info-unsupported');
            }
        },
        options: [
            {
                type: 'boolean',
                name: $_('stilimport.shift-1h'),
                disabled: (p) => !p.canShift1h,
                getValue: (p) => p.isShift1h,
                setValue: (p, v) => p.shift1h(v)
            }
        ]
    })
};
