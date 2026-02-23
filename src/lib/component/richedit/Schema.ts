import { Schema, Node, Mark } from "prosemirror-model";
import type { RichText, RichTextAttr, RichTextNode } from "../../core/RichText";
import { Debug } from "../../Debug";

function getAttr(a: RichTextAttr): Mark {
    if (typeof a == 'string') {
        return a == 'bold' ? RichTextSchema.marks.bold.create()
             : a == 'italic' ? RichTextSchema.marks.italic.create()
             : a == 'underline' ? RichTextSchema.marks.underline.create()
             : a == 'strikethrough' ? RichTextSchema.marks.strikethrough.create()
             : Debug.never(a);
    }
    switch (a.type) {
        case 'size':
            return RichTextSchema.marks.changeSize.create({ value: a.value });
        default:
            Debug.never(a.type);
    }
}

function toAttr(m: Mark): RichTextAttr {
    const name = m.type.name as MarkName;
    switch (name) {
        case "bold":
            return 'bold';
        case "italic":
            return 'italic';
        case "underline":
            return 'underline';
        case "strikethrough":
            return 'strikethrough';
        case "changeSize":
            return {
                type: 'size',
                value: m.attrs.value
            }
        default:
            Debug.never(name);
    }
}

function getNode(n: RichTextNode): Node[] {
    if (typeof n == 'string') {
        if (n.length > 0)
            return [RichTextSchema.text(n)];
        return [];
    }

    switch (n.type) {
        case 'leaf':
            if (n.content.length > 0)
                return [RichTextSchema.text(n.content, n.attrs.map(getAttr))];
            return [];
        default:
            Debug.never(n.type);
    }
}

export function toRichText(n: Node): RichTextNode[] {
    const name = n.type.name as NodeName;
    switch (name) {
        case "text":
            Debug.assert(n.text !== undefined);
            return [n.marks.length == 0 ? n.text
                : {
                    type: 'leaf',
                    attrs: n.marks.map(toAttr),
                    content: n.text
                }
            ];
        case "doc":
            return n.children.flatMap(toRichText);
    }
}

export function fromRichText(t: RichText): Node {
    return RichTextSchema.nodes.doc.create(null, 
        Array.isArray(t) ? t.flatMap(getNode) : getNode(t));
}

export const RichTextSchema = new Schema({
    nodes: {
        text: {
            code: true,
            inline: true
        },
        doc: {
            code: true,
            content: "text*",
            marks: "_"
        }
    },
    marks: {
        bold: {
            toDOM: () => ['b', 0]
        },
        italic: {
            toDOM: () => ['i', 0]
        },
        underline: {
            toDOM: () => ['u', 0]
        },
        strikethrough: {
            toDOM: () => ['s', 0]
        },
        changeSize: {
            attrs: {
                value: {
                    default: 1,
                    validate: (x) => typeof x === 'number' && x !== 100 && x > 0
                }
            },
            toDOM(mark) {
                return ['span', { style: `font-size: ${mark.attrs.value * 100}%; line-height: 1;` }, 0]
            },
        },
    }
});

export type MarkName =
    (typeof RichTextSchema) extends Schema<infer _, infer B> ? B : never;

export type NodeName =
    (typeof RichTextSchema) extends Schema<infer A, infer _> ? A : never;