import { mount, tick, unmount } from "svelte";
import AssImportDialog, { type ImportFormat } from "./ImportFormatDialog.svelte";
import { DialogHandler } from "../frontend/Dialogs";
import type { SubtitleParser } from "../core/Subtitles.svelte";
import { ASSParser, type ASSParseMessage } from "../core/ASS.svelte";
import { Debug } from "../Debug";

import { _, unwrapFunctionStore } from 'svelte-i18n';
import type { SRTParseMessage, SRTParser } from "../core/SRT.svelte";
const $_ = unwrapFunctionStore(_);

async function show<P extends SubtitleParser>(
    parser: P, skippable: boolean, format: ImportFormat<P>
) {
    parser.update();
    if (parser.messages.length == 0 && skippable)
        return parser.done();

    const handler = new DialogHandler<[P, ImportFormat<P>], boolean>();
    const dialog = mount(AssImportDialog<P>, {
        target: document.getElementById('app')!,
        props: {handler}
    });
    await tick();
    const result = await handler.showModal!([parser, format]);
    unmount(dialog);
    return result;
}

export const ImportFormatDialogs = {
    SRT: (p: SRTParser) => show(p, true, {
        header: $_('srtimport.header'),
        formatMessage(type, group) {
            const one = <Ty extends SRTParseMessage['type']>(
                f: (x: Extract<SRTParseMessage, { type: Ty; }>) => string
            ) => // @ts-expect-error
                f(group[0]);

            switch (type) {
                case 'ignored-coordinates': return {
                    heading: $_('srtimport.ignored-coordinates') + ' '
                        + one<'ignored-coordinates'>((x) => 
                            $_('assimportdialog.occurred-n-times', {values: {n: x.occurrence}})),
                    description: $_('srtimport.coordinates-info')
                };
                case 'ignored-format-tags': return {
                    heading: $_('srtimport.ignored-format-tags') + ' '
                        + one<'ignored-coordinates'>((x) => 
                            $_('assimportdialog.occurred-n-times', {values: {n: x.occurrence}})),
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
                name: $_('assimportdialog.preserve-tags'),
                getValue: (p) => p.preserveTags,
                setValue: (p, v) => p.preserveTags = v
            },
        ]
    }),

    ASS: (p: ASSParser) => show(p, false, {
        header: $_('assimportdialog.header'),
        formatMessage(type, group) {
            const map = <Ty extends ASSParseMessage['type']>(
                f: (x: Extract<ASSParseMessage, { type: Ty; }>) => string
            ) => // @ts-expect-error
                group.map(f);
            
            const one = <Ty extends ASSParseMessage['type']>(
                f: (x: Extract<ASSParseMessage, { type: Ty; }>) => string
            ) => // @ts-expect-error
                f(group[0]);

            switch (type) {
                case 'duplicate-style-definition': return {
                    heading: $_('assimportdialog.duplicate-style-definition'),
                    items: map<'duplicate-style-definition'>((x) => x.name)
                };
                case 'undefined-style': return {
                    heading: $_('assimportdialog.undefined-style'),
                    items: map<'undefined-style'>((x) => x.name)
                };
                case 'no-styles': return {
                    heading: $_('assimportdialog.no-styles')
                };
                case 'invalid-style-field': return {
                    heading: $_('assimportdialog.invalid-style-field'),
                    items: map<'invalid-style-field'>((w) => $_('assimportdialog.in-a-b-equals-c', 
                        {values: {a: w.name, b: w.field, c: w.value}}))
                };
                case 'invalid-event-field': return {
                    heading: $_('assimportdialog.invalid-event-field'),
                    items: map<'invalid-event-field'>((w) => 
                        $_('assimportdialog.in-line-a-b-equals-c', 
                            {values: {a: w.line, b: w.field, c: w.value}}))
                };
                
                case 'ignored-style-field': return {
                    heading: $_('assimportdialog.ignored-style-field'),
                    items: map<'invalid-style-field'>((w) => 
                        $_('assimportdialog.in-a-b-equals-c', 
                            {values: {a: w.name, b: w.field, c: w.value}}))
                };
                case 'ignored-event-field': return {
                    heading: $_('assimportdialog.ignored-event-field'),
                    items: map<'invalid-event-field'>((w) => 
                        $_('assimportdialog.in-line-a-b-equals-c', 
                            {values: {a: w.line, b: w.field, c: w.value}}))
                };
                case 'ignored-special-character': return {
                    heading: $_('assimportdialog.ignored-special-character') + ' '
                        + one<'ignored-special-character'>((x) => 
                            $_('assimportdialog.occurred-n-times', {values: {n: x.occurrence}})),
                };
                case 'ignored-drawing-command': return {
                    heading: $_('assimportdialog.ignored-drawing-command') + ' '
                        + one<'ignored-drawing-command'>((x) => 
                            $_('assimportdialog.occurred-n-times', {values: {n: x.occurrence}})),
                };
                case 'ignored-override-tag': return {
                    heading: $_('assimportdialog.ignored-override-tag') + ' '
                        + one<'ignored-override-tag'>((x) => 
                            $_('assimportdialog.occurred-n-times', {values: {n: x.occurrence}})),
                    description: $_('assimportdialog.info-override-tag')
                };
                case 'ignored-embedded-fonts': return {
                    heading: $_('assimportdialog.ignored-embedded-fonts'),
                };
                default:
                    Debug.never(type);
            }
        },
        categoryDescription(category) {
            switch (category) {
                case "invalid":
                    return $_('assimportdialog.info-invalid');
                case "unsupported":
                    return $_('assimportdialog.info-ignored');
            }
        },
        options: [
            {
                type: 'boolean',
                name: $_('assimportdialog.preserve-inlines'),
                getValue: (p) => p.preserveInlines,
                setValue: (p, v) => p.preserveInlines = v
            },
            {
                type: 'boolean',
                name: $_('assimportdialog.transform-inline-multichannel'),
                description: $_('assimportdialog.transform-info'),
                getValue: (p) => p.transformInlineMultichannel,
                setValue: (p, v) => p.transformInlineMultichannel = v
            }
        ]
    })
};