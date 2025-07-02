import * as z from "zod/v4-mini";
import { Memorized } from "../config/MemorizedValue.svelte";
import { Debug } from "../Debug";
import { fetch } from "@tauri-apps/plugin-http";

const zRStringSubstitute = z.union([
    z.object({
        type: z.literal('keyword')
    }),
    z.object({
        type: z.literal('variable'),
        name: z.string()
    })
]);

const zRString = z.array(z.union([z.string(), zRStringSubstitute]));

export type ReferenceString = z.infer<typeof zRString>;

const zRSource = z.object({
    name: z.string(),
    url: zRString,
    selector: z.optional(zRString),
    variables: z.array(z.object({
        name: z.string(),
        defaultValue: z.string()
    }))
});

export type ReferenceSource = z.infer<typeof zRSource>;

export type ReferenceContext = {
    keyword: string,
    variables: Map<string, string>
};

function substitute(str: ReferenceString, ctx: ReferenceContext, encoder = (s: string) => s) {
    let result = '';
    for (const elem of str) {
        if (typeof elem === 'string')
            result += elem;
        else if (elem.type == 'keyword')
            result += encoder(ctx.keyword);
        else if (elem.type == 'variable')
            result += encoder(ctx.variables.get(elem.name) ?? '');
        else
            Debug.never(elem);
    }
    return result;
}

const defaultSources: ReferenceSource[] = [
    {
        name: 'Wiktionary',
        url: ['https://en.wiktionary.org/wiki/', { type: 'keyword' }, '#', { type: 'variable', name: 'language' }],
        variables: [ { name: 'language name', defaultValue: 'English' } ]
    },
    {
        name: 'Google Translate',
        url: [
            'https://translate.google.com/',
            '?sl=', { type: 'variable', name: 'original language code' },
            '&tl=', { type: 'variable', name: 'target language code' },
            '&text=', { type: 'keyword' },
            '&op=translate'
        ],
        variables: [ 
            { name: 'original language code', defaultValue: 'auto' },
            { name: 'target language code', defaultValue: 'en' }
        ]
    },
    {
        name: '法语助手',
        url: ['https://www.frdic.com/dicts/fr/', { type: 'keyword' }],
        selector: ['.dict-body-main'],
        variables: []
    },
    {
        name: '德语助手',
        url: ['https://www.godic.net/dicts/de/', { type: 'keyword' }],
        selector: ['.dict-body-main'],
        variables: []
    },
    {
        name: 'Reverso',
        url: [
            'https://www.reverso.net/text-translation',
            '#sl=', { type: 'variable', name: 'original language code' },
            '&tl=', { type: 'variable', name: 'target language code' },
            '&text=', { type: 'keyword' }
        ],
        variables: [ 
            { name: 'original language code', defaultValue: 'eng' },
            { name: 'target language code', defaultValue: 'chi' }
        ]
    },
    {
        name: 'The Free Dictionary',
        url: [
            'https://www.thefreedictionary.com/', { type: 'keyword' }],
        selector: ['.content-holder'],
        variables: []
    },
];

export const Reference = {
    sources: Memorized.$('referenceSources', z.array(zRSource), [...defaultSources]),

    async fetch(source: ReferenceSource, ctx: ReferenceContext) {
        const url = new URL(substitute(source.url, ctx, encodeURIComponent));
        const response = await fetch(url);
        const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
        // const elem = doc.querySelector(substitute(source.selector, ctx));
        return doc.documentElement.outerHTML;
    }
}