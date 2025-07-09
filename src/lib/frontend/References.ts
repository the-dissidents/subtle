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

// const ZRStrategy = z.enum(['iframe-load'])

const zRSource = z.object({
    name: z.string(),
    url: zRString,
    scrollTo: z.optional(zRString),
    selector: z.optional(zRString),
    patchStyle: z.optional(z.array(z.object({
        selector: zRString,
        patches: z.array(z.tuple([z.string(), z.string()]))
    }))),
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

function substitute(
    str: ReferenceString, 
    source: ReferenceSource, 
    ctx: ReferenceContext, 
    encoder = (s: string) => s
) {
    let result = '';
    for (const elem of str) {
        if (typeof elem === 'string')
            result += elem;
        else if (elem.type == 'keyword')
            result += encoder(ctx.keyword);
        else if (elem.type == 'variable')
            result += encoder(
                   ctx.variables.get(elem.name) 
                ?? source.variables.find((x) => x.name == elem.name)?.defaultValue 
                ?? '');
        else
            Debug.never(elem);
    }
    return result;
}

const defaultSources: ReferenceSource[] = [
    {
        name: 'Wiktionary',
        url: ['https://en.wiktionary.org/wiki/', { type: 'keyword' }],
        scrollTo: ['#', { type: 'variable', name: 'language name' }],
        selector: ['.mw-body-content'],
        variables: [ { name: 'language name', defaultValue: 'English' } ]
    },
    {
        name: '有道词典',
        url: ['https://dict.youdao.com/result?word=', { type: 'keyword' }, '&lang=en'],
        selector: ['div.search_result'],
        patchStyle: [{
            selector: ['#searchLayout'],
            patches: [['min-width', '0']]
        }, {
            selector: ['div.search_result'],
            patches: [['min-width', '0'], ['padding', '0 10px 0 10px'], ['width', 'auto'], ['margin', '0']]
        }, {
            selector: ['div.search_result-dict'],
            patches: [['width', 'auto']]
        }],
        variables: []
    },
    {
        name: '法语助手',
        url: ['https://www.frdic.com/dicts/fr/', { type: 'keyword' }],
        selector: ['#translate'],
        patchStyle: [{
            selector: ['#bodycontent'],
            patches: [['min-width', '0'], ['padding', '0 10px 0 10px']]
        }],
        variables: []
    },
    {
        name: '德语助手',
        url: ['https://www.godic.net/dicts/de/', { type: 'keyword' }],
        selector: ['#translate'],
        patchStyle: [{
            selector: ['#bodycontent'],
            patches: [['min-width', '0'], ['padding', '0 10px 0 10px']]
        }],
        variables: []
    },
    {
        name: 'The Free Dictionary',
        url: [
            'https://www.thefreedictionary.com/', { type: 'keyword' }],
        selector: ['#MainTxt'],
        variables: []
    },
];

export const Reference = {
    sources: Memorized.$('referenceSources', z.array(zRSource), [...defaultSources]),

    get defaultSources() {
        return defaultSources;
    },

    async getUrl(source: ReferenceSource, ctx: ReferenceContext) {
        const url = new URL(substitute(source.url, source, ctx, encodeURIComponent));
        return url;
    },

    async fetch(source: ReferenceSource, ctx: ReferenceContext) {
        const url = new URL(substitute(source.url, source, ctx, encodeURIComponent));
        const response = await fetch(url);
        const doc = new DOMParser().parseFromString(await response.text(), 'text/html');

        const selected = source.selector 
            ? doc.querySelector(substitute(source.selector, source, ctx)) : null;

        const attrs = ['src', 'href'];
        doc.querySelectorAll<HTMLElement>('*').forEach((x) => {
            for (const attr of attrs) {
                const original = x.getAttribute(attr);
                if (original) try {
                    x.setAttribute(attr, new URL(original, url).toString());
                } catch (_) {}
            }
            if (selected) {
                if (!x.contains(selected) && !selected.contains(x)) {
                    x.style.display = 'none';
                }
            }
        });
        if (source.patchStyle) for (const s of source.patchStyle) {
            doc.querySelectorAll<HTMLElement>(substitute(s.selector, source, ctx)).forEach((x) => {
                for (const [k, v] of s.patches)
                    x.style.setProperty(k, v, 'important');
                console.log(x);
            });
        }
        doc.querySelectorAll('script').forEach((x) => 
            x.parentNode?.removeChild(x));
        return doc.documentElement.outerHTML;
    },

    async displayInFrame(
        source: ReferenceSource, ctx: ReferenceContext, iframe: HTMLIFrameElement
    ) {
        const html = await Reference.fetch(source, ctx);
        const scrollTo = source.scrollTo ? substitute(source.scrollTo, source, ctx) : '';
        iframe.srcdoc = html;
        iframe.onload = () => {
            if (scrollTo) iframe.contentDocument
                ?.querySelector(scrollTo)
                ?.scrollIntoView(true);
        };
    }
}