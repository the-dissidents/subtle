import * as Color from "colorjs.io/fn";
import { Debug } from "../Debug";
import { toASSColor } from "./ASS.svelte";
import type { SubtitleStyle } from "./Subtitles.svelte";
import { ASSString, type ASSStringWarnings } from "./ASSString";
import { RichText, type RichTextAttr } from "./RichText";

export type HTMLStringWarnings = {
    ignoredTags: Map<string, number>,
    invalidColor: number,
    ignoredSpecialCharacter: Map<string, number>,
};

function htmlColorToASSColor(str: string): string | null {
    try {
        const col = Color.parse(str);
        return toASSColor(col);
    } catch (e) {
        Debug.warn('failed to parse HTML color:', e);
        return null;
    }
}

type Tag = {
    start: string,
    end: string
};

function attrToTag(attr: RichTextAttr): Tag | [] {
    if (typeof attr === 'string') {
        switch (attr) {
            case "bold":          return { start: '<b>', end: '</b>' };
            case "italic":        return { start: '<i>', end: '</i>' };
            case "underline":     return { start: '<u>', end: '</u>' };
            case "strikethrough": return { start: '<s>', end: '</s>' };
            default:
                Debug.never(attr);
        }
    } else {
        switch (attr.type) {
            case 'size':
                return [];
            default:
                Debug.never(attr.type);
        }
    }
}

export namespace HTMLString {
    export function parse(
        source: string, base: SubtitleStyle, 
        warnings: HTMLStringWarnings
    ): RichText {
        const ass = htmlToAss(source, warnings);
        const assWarnings: ASSStringWarnings = {
            ignoredTags: new Map(),
            ignoredDrawing: 0,
            ignoredSpecialCharacter: new Map()
        };
        const result = ASSString.parse(ass, base, assWarnings).result;
        warnings.ignoredSpecialCharacter = assWarnings.ignoredSpecialCharacter;
        return result;
    }

    export function serialize(rt: RichText) {
        rt = RichText.trim(rt);
        let result = '';
        for (const part of rt) {
            if (typeof part === 'string')
                result += part;
            else {
                const tags = part.attrs.flatMap(attrToTag);
                result += `${tags.map((x) => x.start)}${part.content}${tags.reverse().map((x) => x.end)}`;
            }
        }
        return result;
    }
}

// The following algorithm is adapted from https://github.com/FFmpeg/FFmpeg/blob/master/libavcodec/htmlsubtitles.c and mostly written by Gemini 3

/*
 * Original file Copyright (c) 2010  Aurelien Jacobs <aurel@gnuage.org>
 *               Copyright (c) 2017  Clément Bœsch <u@pkh.me>
 */

interface FontState {
    face: string;
    size: number;
    color: number | null; // null means no color set
}

function htmlToAss(text: string, warnings: HTMLStringWarnings): string {
    const output: string[] = [];
    const stack: FontState[] = [{ face: "", size: 0, color: null }];
    
    let isLineStart = true;
    let cursor = 0;

    // Helper to remove trailing spaces from the output buffer
    // (Mimics rstrip_spaces_buf)
    const trimOutputTrailingSpaces = () => {
        while (output.length > 0) {
            const lastIdx = output.length - 1;
            if (output[lastIdx].endsWith(" ")) {
                output[lastIdx] = output[lastIdx].replace(/ +$/, "");
                if (output[lastIdx] === "") output.pop();
                else break; 
            } else {
                break;
            }
        }
    };

    while (cursor < text.length) {
        const char = text[cursor];

        // 1. Handle Newlines
        if (char === '\n') {
            if (!isLineStart) {
                trimOutputTrailingSpaces();
                output.push("\\N");
                isLineStart = true;
            }
            cursor++;
            continue;
        }

        // 2. Handle Carriage Returns (Skip)
        if (char === '\r') {
            cursor++;
            continue;
        }

        // 3. Handle Spaces
        if (char === ' ') {
            if (!isLineStart) output.push(" ");
            cursor++;
            continue;
        }

        // 4. Handle SSA/ASS Braces "{"
        if (char === '{') {
            // Check for alignment tags {\anX}
            const matchAn = text.substring(cursor).match(/^\{\\an(\d)\}/);
            if (matchAn) {
                output.push(matchAn[0]);
                cursor += matchAn[0].length;
                // FFmpeg logic: if valid \an, we don't treat it as "closing brace missing" logic
                continue;
            }

            // Check for MicroDVD logic or unescaped chars
            // This is a simplified check for the complex "handle_open_brace" logic
            // to avoid swallowing generic text that happens to have braces.
            const closingIndex = text.indexOf('}', cursor);
            const nextChar = text[cursor + 1];
            
            const isEscaped = nextChar === '\\';
            const isMicroDvd = nextChar && "CcFfoPSsYy".includes(nextChar) && text[cursor + 2] === ':';

            if ((isEscaped || isMicroDvd) && closingIndex !== -1) {
                // It looks like a style tag, skip the whole thing
                cursor = closingIndex + 1;
            } else {
                // Treat as normal text
                output.push("{");
                cursor++;
            }
            
            // FFmpeg sets line_start = 0 for any non-whitespace, non-newline char
            isLineStart = false;
            continue;
        }

        // 5. Handle HTML Tags "<"
        if (char === '<') {
            // Handle "<<" escape sequence (common in some subs)
            let consecutive = 0;
            while (text[cursor + 1 + consecutive] === '<') consecutive++;
            
            if (consecutive > 0) {
                // Print "<<" as literal text
                output.push("<".repeat(consecutive + 1));
                cursor += consecutive + 1;
                isLineStart = false;
                continue;
            }

            const isCloseTag = text[cursor + 1] === '/';
            const tagStart = cursor + (isCloseTag ? 2 : 1);
            const tagEnd = text.indexOf('>', tagStart);

            // If no closing '>', treat as text
            if (tagEnd === -1) {
                output.push("<");
                cursor++;
                isLineStart = false;
                continue;
            }

            // Extract raw tag content
            const rawContent = text.substring(tagStart, tagEnd);
            // Basic validation: Tag names usually don't have certain chars
            // FFmpeg logic checks for first space to separate name/params
            const match = rawContent.match(/^\s*([a-zA-Z0-9_/]+)(?:\s+(.*))?$/);
            
            if (!match) {
                // Malformed tag, treat as text
                output.push("<");
                cursor++;
                isLineStart = false;
                continue;
            }

            const tagName = match[1].toLowerCase();
            const params = match[2] || "";

            // --- Tag Processing ---
            
            if (tagName === "br") {
                output.push("\\N");
            }
            else if (["b", "i", "s", "u"].includes(tagName)) {
                // Determine state (closing tag = 0, opening = 1)
                const val = isCloseTag ? 0 : 1;
                output.push(`{\\${tagName}${val}}`);
            }
            else if (tagName === "font") {
                if (isCloseTag) {
                    // </font>: Pop stack and restore previous state
                    if (stack.length > 1) {
                        const current = stack.pop()!;
                        const prev = stack[stack.length - 1];

                        if (current.size !== prev.size) {
                            output.push(prev.size ? `{\\fs${prev.size}}` : `{\\fs}`);
                        }
                        if (current.color !== prev.color) {
                            if (prev.color === null) {
                                 output.push(`{\\c}`);
                            } else {
                                 // Convert color back to ASS hex
                                 const bgr = (prev.color & 0xFFFFFF).toString(16).toUpperCase().padStart(6, '0');
                                 output.push(`{\\c&H${bgr}&}`);
                            }
                        }
                        if (current.face !== prev.face) {
                             output.push(prev.face ? `{\\fn${prev.face}}` : `{\\fn}`);
                        }
                    }
                } else {
                    // <font>: Push new state based on attributes
                    const current = stack[stack.length - 1];
                    const next: FontState = { ...current };

                    // Parse attributes using Regex
                    // Matches: key="value", key='value', or key=value
                    const attrRegex = /(size|color|face)\s*=\s*(?:["']([^"']*)["']|([^ \t\r\n>]*))/gi;
                    let attrMatch;
                    
                    while ((attrMatch = attrRegex.exec(params)) !== null) {
                        const key = attrMatch[1].toLowerCase();
                        const val = attrMatch[2] || attrMatch[3];

                        if (key === "size") {
                            const num = parseInt(val, 10);
                            if (!isNaN(num)) {
                                next.size = num;
                                output.push(`{\\fs${num}}`);
                            }
                        } else if (key === "color") {
                            const color = htmlColorToASSColor(val);
                            if (color)
                                output.push(`{\\c${htmlColorToASSColor(val)}&}`);
                            else
                                warnings.invalidColor++;
                        } else if (key === "face") {
                            next.face = val;
                            output.push(`{\\fn${val}}`);
                        }
                    }
                    stack.push(next);
                }
            } else {
                const prev = warnings.ignoredTags.get(tagName) ?? 0;
                warnings.ignoredTags.set(tagName, prev + 1);
            }

            cursor = tagEnd + 1;
            // Tags don't reset line_start in FFmpeg logic unless they output text, 
            // but strictly speaking, the loop check usually sets line_start=0 for non-space chars.
            // However, control codes (processed here) shouldn't disable trim logic for subsequent spaces.
            continue;
        }

        // 6. Default: Regular Character
        output.push(char);
        isLineStart = false;
        cursor++;
    }

    // Final Cleanup
    let result = output.join("");
    
    // Remove trailing \N if present (mimicking FFmpeg logic)
    while (result.endsWith("\\N")) {
        result = result.substring(0, result.length - 2);
    }
    
    // Strip trailing spaces again on the final buffer
    result = result.replace(/ +$/, "");

    return result;
}