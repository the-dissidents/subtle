import * as z from "zod/v4-mini";
import { Debug } from "../Debug";
// import { ZColor } from "./Serialization";

import { zx } from '@traversable/zod';

export const ZRtAttr = z.union([
    z.literal('bold'),
    z.literal('italic'),
    z.literal('underline'),
    z.literal('strikethrough'),
    z.object({
        type: z.literal('size'),
        value: z.number()
    }),
    // z.object({
    //     type: z.literal('color'),
    //     value: ZColor
    // }),
]);

export type RichTextAttr = z.infer<typeof ZRtAttr>;

export const ZRtNode = z.union([
    z.string(),
    z.object({
        type: z.literal('leaf'),
        content: z.string(),
        attrs: z.array(ZRtAttr)
    }),
    // z.object({
    //     type: 'ruby',
    //     content: z.string(),
    //     ruby: z.string(),
    // })
]);

export type RichTextNode = z.infer<typeof ZRtNode>;

export const ZRichText = z.union([
    z.string(),
    z.array(ZRtNode),
]);

export type RichText = z.infer<typeof ZRichText>;

const eq = zx.deepEqual(ZRichText);

const attrEq = zx.deepEqual(ZRtAttr);

function sameAttrs(x: RichTextAttr[], y: RichTextAttr[]) {
    if (x.length !== y.length) return false;
    return !x.find((a) => !y.find((b) => attrEq(a, b)));
}

export namespace RichText {
    export function equals(a: RichText, b: RichText) {
        return eq(a, b);
    }

    export function toString(rt: RichText) {
        function node(n: RichTextNode) {
            if (typeof n == 'string') return n;
            return n.content;
        }
        if (Array.isArray(rt))
            return rt.map(node).join('');
        return node(rt);
    }

    export function length(rt: RichText) {
        if (typeof rt === 'string') {
            return rt.length;
        }
        return rt.reduce((p, node) => 
            p + (typeof node === 'string' ? node : node.content).length, 0);
    }

    export function split(rt: RichText, pattern: string | RegExp): RichText[] {
        if (typeof rt === 'string')
            return rt.split(pattern);

        const split = RichText.toString(rt).split(pattern);
        if (split.length <= 1) return [rt];

        const result: RichText[] = [];
        let current: RichTextNode[] = [];
        
        let required = split.shift()!.length;
        for (const node of rt) {
            const content = typeof node === 'string' ? node : node.content;
            const nodeLength = content.length;

            if (required == 0) {
                while (required == 0)
                    required = split.shift()!.length;
                result.push(current);
                current = [];
            }

            const sliceEnd = Math.min(nodeLength, required);
            if (sliceEnd === nodeLength) {
                current.push(node);
            } else {
                const slicedContent = content.substring(0, sliceEnd);
                current.push(typeof node === 'string'
                    ? slicedContent
                    : { ...node, content: slicedContent });
            }
            required -= sliceEnd;
        }
        result.push(current);
        return result;
    }

    export function substring(rt: RichText, start: number, end?: number): RichText {
        if (typeof rt === 'string')
            return rt.substring(start, end);

        Debug.assert(!Number.isNaN(start) && start >= 0);

        const totalLength = RichText.length(rt);
        end = end ?? totalLength;
        Debug.assert(!Number.isNaN(end) && end >= 0);
        Debug.assert(start <= end);

        if (start === end) return "";

        const result: RichTextNode[] = [];
        let currentPos = 0;
        for (const node of rt) {
            const content = typeof node === 'string' ? node : node.content;
            const nodeLength = content.length;
            const nodeEnd = currentPos + nodeLength;

            if (nodeEnd > start && currentPos < end) {
                const sliceStart = Math.max(0, start - currentPos);
                const sliceEnd = Math.min(nodeLength, end - currentPos);
                
                if (sliceStart === 0 && sliceEnd === nodeLength) {
                    result.push(node);
                } else {
                    const slicedContent = content.substring(sliceStart, sliceEnd);
                    result.push(typeof node === 'string'
                        ? slicedContent
                        : { ...node, content: slicedContent });
                }
            }

            currentPos += nodeLength;
            if (currentPos >= end) break;
        }

        if (result.length === 0) return "";
        return result;
    }

    export function trim(rt: RichText) {
        const str = RichText.toString(rt);
        const left = str.length - str.trimStart().length;
        const right = str.length - str.trimEnd().length;
        if (left == 0 && right == 0) return rt;
        return RichText.substring(rt, left, str.length - left - right);
    }

    export function trimStart(rt: RichText) {
        const str = RichText.toString(rt);
        const left = str.length - str.trimStart().length;
        if (left == 0) return rt;
        return RichText.substring(rt, left);
    }

    export function trimEnd(rt: RichText) {
        const str = RichText.toString(rt);
        const right = str.length - str.trimEnd().length;
        if (right == 0) return rt;
        return RichText.substring(rt, 0, str.length - right);
    }

    export function concat(...rts: RichText[]): RichText {
        const result: RichTextNode[] = [];
        rts.flat().forEach((x, i) => {
            if (x === "") return;

            if (typeof x === 'string') {
                if (typeof result[i-1] === 'string')
                    result[i-1] += x;
                else
                    result.push(x);
            } else {
                // leaf
                const last = result[i-1];
                if (typeof last === 'object' && sameAttrs(last.attrs, x.attrs))
                    last.content += x.content;
                else
                    result.push(x);
            }
        });
        return result.length == 0 ? '' : result;
    }

    export function attrsAt(rt: RichText, index: number) {
        Debug.assert(index >= 0);
        if (rt.length == 0 || typeof rt === 'string')
            return [];

        let i = 0;
        for (const x of rt) {
            const attrs = typeof x === 'string' ? [] : x.attrs;
            i += typeof x === 'string' ? x.length : x.content.length;
            if (i > index) return attrs;
        }
        throw new RangeError('index');
    }

    export function edit(rt: RichText, index: number, deleteCount: number, insert: RichText = "") {
        return RichText.concat(
            RichText.substring(rt, 0, index),
            insert,
            RichText.substring(rt, index + deleteCount)
        );
    }

    export function join(rts: RichText[], sep: RichText): RichText {
        sep = typeof sep === 'string' ? [sep] : sep;
        const result: RichText[] = [];
        rts.forEach((x, i) => {
            result.push(x);
            if (i < rts.length - 1)
                result.push(sep);
        });
        return RichText.concat(...result);
    }
}