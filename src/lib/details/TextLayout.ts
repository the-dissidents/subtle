import * as Color from "colorjs.io/fn";
import type { RichText, RichTextAttr, RichTextNode } from "../core/RichText";
import type { SubtitleStyle } from "../core/Subtitles.svelte";
import { Typography } from "./Typography";
import { Debug } from "../Debug";

export type EvaluatedFormat = {
    cssSize: number,
    fillStyle: string,
    cssFont: string,
    textDecoration: string;
};

export function format(
    attrs: RichTextAttr[],
    baseStyle: SubtitleStyle, 
    ctx: CanvasRenderingContext2D,
    scale: number
): EvaluatedFormat {
    let size = baseStyle.size || 48;
    let font = baseStyle.font || 'sans-serif';
    let fontFamily = `"${font}", sans-serif`;

    let cssSize = 
        Typography.getRealDimFactor(fontFamily, ctx) * size * scale;

    let bold = baseStyle.styles.bold;
    let italic = baseStyle.styles.italic;
    let underline = baseStyle.styles.underline;
    let strikethrough = baseStyle.styles.strikethrough;

    attrs.forEach((x) => {
        if (typeof x == 'string') switch (x) {
            case "bold":
                bold = true; break;
            case "italic":
                italic = true; break;
            case "underline":
                underline = true; break;
            case "strikethrough":
                strikethrough = true; break;
            default:
                Debug.never(x);
        } else switch (x.type) {
            case 'size':
                cssSize *= x.value;
                break;
            default:
                Debug.never(x.type);
        }
    });

    return {
        cssSize,
        cssFont: `${bold ? 'bold ' : ''} ${italic ? 'italic ' : ''} ${cssSize}px ${fontFamily}`,
        fillStyle: Color.serialize(baseStyle.color),
        textDecoration: (underline ? 'underline' : '') + (strikethrough ? ' line-through' : '')
    }
}

export type FormatChunk = {
    text: string,
    format: EvaluatedFormat,
    width: number,

    descent: number,
    ascent: number,
};

export type LayoutChunk = {
    chunks: FormatChunk[],
    spaceWidth: number,
    width: number,
    height: number,
    maxDescent: number,
    maxAscent: number,
};

export type Line = {
    chunks: LayoutChunk[],
    width: number,
    height: number,
    maxDescent: number,
    maxAscent: number,
};

function emptyLine(): Line {
    return { chunks: [], width: 0, height: 0, maxAscent: 0, maxDescent: 0 };
}

function emptyLayoutChunk(): LayoutChunk {
    return { chunks: [], spaceWidth: 0, width: 0, height: 0, maxAscent: 0, maxDescent: 0 };
}

function lineBreakKnuthPlass(chunks: LayoutChunk[], lineWidth: number): Line[] {
    const n = chunks.length;

    // dp[x] = cost to line-wrap the first x words
    const dp = new Array(n+1).fill(Infinity);
    dp[0] = 0;

    // breaks[x] = index of last line-break before the x-th word
    const lastBreak = new Array(n+1).fill(0);

    for (let i = 1; i <= n; i++)
    for (let j = i; j > 0; j--) {
        const line = chunks.slice(j-1, i)
            .reduce((p, x, k) => p + x.width + (k == j - i ? 0 : x.spaceWidth), 0);

        // check that j < i to handle a single chunk being longer than lineWidth
        if (line > lineWidth && j < i) break;

        const cost = (line - lineWidth) * (line - lineWidth);
        if (dp[j-1] + cost < dp[i]) {
            dp[i] = dp[j-1] + cost;
            lastBreak[i] = j-1;
        }
    }

    const breaks: number[] = [];
    for (let i = n; i > 0; i = lastBreak[i]) {
        breaks.unshift(i);
        // Debug.assert(lastBreak[i] !== i);
    }

    let lastLine = emptyLine(),
        lines: Line[] = [];
    
    chunks.forEach((c, i) => {
        if (breaks.at(0) == i) {
            breaks.shift();
            lines.push(lastLine);
            lastLine = emptyLine();
        }
        lastLine.width += c.width + (lastLine.chunks.at(-1)?.spaceWidth ?? 0);
        lastLine.height = Math.max(lastLine.height, c.height);
        lastLine.maxAscent = Math.max(lastLine.maxAscent, c.maxAscent);
        lastLine.maxDescent = Math.max(lastLine.maxDescent, c.maxDescent);
        lastLine.chunks.push(c);
    });
    if (lastLine.chunks.length > 0)
        lines.push(lastLine);
    return lines;
}

function lineBreakGreedy(chunks: LayoutChunk[], lineWidth: number): Line[] {
    let lastLine = emptyLine(),
        lines: Line[] = [];
    
    chunks.forEach((c, i) => {
        const delta = c.width + (lastLine.chunks.at(-1)?.spaceWidth ?? 0);
        if (lastLine.width + delta > lineWidth && i > 0) {
            lines.push(lastLine);
            lastLine = emptyLine();
        }
        lastLine.width += delta;
        lastLine.height = Math.max(lastLine.height, c.height);
        lastLine.maxAscent = Math.max(lastLine.maxAscent, c.maxAscent);
        lastLine.maxDescent = Math.max(lastLine.maxDescent, c.maxDescent);
        lastLine.chunks.push(c);
    });
    if (lastLine.chunks.length > 0)
        lines.push(lastLine);
    return lines;
}

function lineBreakNone(chunks: LayoutChunk[], _lineWidth: number): Line[] {
    return [{
        chunks,
        width: chunks.reduce((p, x, i) => p + x.width 
            + (i == chunks.length - 1 ? 0 : x.spaceWidth), 0),
        height: chunks.reduce((p, x) => Math.max(p, x.height), 0),
        maxAscent: chunks.reduce((p, x) => Math.max(p, x.maxAscent), 0),
        maxDescent: chunks.reduce((p, x) => Math.max(p, x.maxDescent), 0),
    }];
}

export enum WarpStyle {
    Balanced = 0,
    Greedy = 1,
    NoWrap = 2,
    Pretty = 3
}

export function layoutText(
    text: RichText, 
    baseStyle: SubtitleStyle, 
    width: number, 
    ctx: CanvasRenderingContext2D,
    warpStyle: WarpStyle,
    scale: number = 1,
): Line[] {
    const hardLines: LayoutChunk[][] = [];

    let currentLine: LayoutChunk[] = [];
    let lastChunk = emptyLayoutChunk();

    function newLine() {
        if (lastChunk.chunks.length > 0 || currentLine.length == 0)
            submitWord();

        // discard whitespace at the beginning of line
        // but preserve at least an empty chunk on a blank line
        while (currentLine.length > 1 && currentLine[0].chunks.length == 0)
            currentLine.shift();

        hardLines.push(currentLine);
        currentLine = [];
    }

    function submitWord() {
        currentLine.push(lastChunk);
        lastChunk = emptyLayoutChunk();
    }

    function processNode(part: RichTextNode) {
        const attrs = typeof part === 'string' ? [] : part.attrs;
        const text = typeof part === 'string' ? part : part.content;
        const fmt = format(attrs, baseStyle, ctx, scale);

        ctx.font = fmt.cssFont;

        let formatChunk: FormatChunk = {
            text: '', width: 0, format: fmt, ascent: 0, descent: 0
        };

        function submit() {
            const metrics = ctx.measureText(formatChunk.text);
            formatChunk.width = metrics.width;
            formatChunk.ascent = metrics.actualBoundingBoxAscent;
            formatChunk.descent = metrics.actualBoundingBoxDescent;
            lastChunk.maxAscent = Math.max(lastChunk.maxAscent, formatChunk.ascent);
            lastChunk.maxDescent = Math.max(lastChunk.maxDescent, formatChunk.descent);
            lastChunk.height = Math.max(lastChunk.height,
                metrics.fontBoundingBoxAscent + metrics.fontBoundingBoxDescent);

            if (formatChunk.text.length > 0) {
                lastChunk.chunks.push(formatChunk);
                lastChunk.width += formatChunk.width;
            }

            formatChunk = {
                text: '', width: 0, format: fmt, ascent: 0, descent: 0
            };
        }

        function submitWordEnd(spaces: string) {
            submit();

            Debug.assert(lastChunk.spaceWidth == 0);
            const spaceWidth = ctx.measureText(spaces).width;
            lastChunk.spaceWidth = spaceWidth;
            
            submitWord();
        }

        let i = 0;
        while (i < text.length) {
            const ch = text[i];
            if (ch == '\n') {
                submitWordEnd('');
                newLine();
            } else if (/\s/.exec(ch)) {
                let spaces = '';
                while (i < text.length && /\s/.exec(text[i])) {
                    if (text[i] == '\n') {
                        submitWordEnd(spaces);
                        newLine();
                        spaces = '';
                    } else {
                        spaces += text[i];
                    }
                    i++;
                }
                if (spaces.length > 0)
                    submitWordEnd(spaces);
                continue;
            } else {
                formatChunk.text += ch;
            }
            i++;
        }
        submit();
    }

    if (Array.isArray(text)) {
        for (const part of text)
            processNode(part);
    } else
        processNode(text);
    
    newLine();

    const method =
        warpStyle == WarpStyle.Balanced ? lineBreakKnuthPlass
      : warpStyle == WarpStyle.Greedy ? lineBreakGreedy
      : warpStyle == WarpStyle.NoWrap ? lineBreakNone
      : warpStyle == WarpStyle.Pretty ? lineBreakKnuthPlass
      : Debug.never(warpStyle);

    return hardLines.flatMap((chunks) => method(chunks, width));
}