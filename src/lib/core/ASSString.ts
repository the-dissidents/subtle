import { Debug } from "../Debug";
import type { WrapStyle } from "../details/TextLayout";
import type { AlignMode } from "./Labels";
import type { RichText, RichTextAttr, RichTextNode } from "./RichText";
import type { Positioning, SubtitleStyle } from "./Subtitles.svelte";

export type ASSStringWarnings = {
    ignoredTags: Map<string, number>,
    ignoredDrawing: number,
    ignoredSpecialCharacter: Map<string, number>,
};

class ASSState {
    #italic = false;
    #bold = 0;
    #underline = false;
    #strikeout = false;
    #fontsize?: number;
    #pos: Positioning = null;
    #align: AlignMode | null = null;

    get positioning() {
        return this.#pos;
    }

    get alignment() {
        return this.#align;
    }

    constructor(readonly warnings: ASSStringWarnings = {
        ignoredTags: new Map<string, number>(),
        ignoredDrawing: 0,
        ignoredSpecialCharacter: new Map<string, number>(),
    }) { }

    static fromGlobals(opts: { pos?: Positioning }) {
        const obj = new ASSState();
        obj.#pos = opts.pos ?? null;
        return obj;
    }

    static fromAttrs(attrs: RichTextAttr[], base: SubtitleStyle, from?: ASSState): ASSState {
        const state = new ASSState(from?.warnings);
        state.#fontsize = base.size;
        if (from) {
            state.#pos = from.#pos;
            state.#align = from.#align;
        }

        attrs.forEach((x) => {
            if (typeof x === 'string') switch (x) {
                case "bold":          state.#bold = 1; break;
                case "italic":        state.#italic = true; break;
                case "underline":     state.#underline = true; break;
                case "strikethrough": state.#strikeout = true; break;
                default: Debug.never(x);
            } else switch (x.type) {
                case 'size':
                    state.#fontsize = x.value * base.size;
                    break;
                default: Debug.never(x.type);
            }
        });
        return state;
    }

    emitGlobals(): string {
        let result = '';
        if (this.#pos) result += `\\pos(${this.#pos.x.toFixed(0)}, ${this.#pos.y.toFixed(0)})`;
        if (this.#align) result += `\\an${this.#align}`;

        return result.length > 0 ? `{${result}}` : '';
    }

    static emitDifference(before: ASSState, after: ASSState, base: SubtitleStyle): string {
        let result = '';
        if (before.#italic !== after.#italic)       result += `\\i${after.#italic ? 1 : 0}`;
        if (before.#underline !== after.#underline) result += `\\u${after.#underline ? 1 : 0}`;
        if (before.#strikeout !== after.#strikeout) result += `\\s${after.#strikeout ? 1 : 0}`;
        if (before.#bold !== after.#bold)           result += `\\b${after.#bold}`;

        const f0 = before.#fontsize == base.size ? undefined : before.#fontsize;
        const f1 = after.#fontsize == base.size ? undefined : after.#fontsize;
        if (f0 !== f1)
            result += `\\fs${f1 ? f1.toFixed(0) : ''}`;
        return result.length > 0 ? `{${result}}` : '';
    }

    #toAttrs(base: SubtitleStyle): RichTextAttr[] {
        const result: RichTextAttr[] = [];
        if (this.#bold)      result.push('bold');
        if (this.#italic)    result.push('italic');
        if (this.#underline) result.push('underline');
        if (this.#strikeout) result.push('strikethrough');
        if (this.#fontsize && this.#fontsize !== base.size) result.push({
            type: 'size',
            value: this.#fontsize / base.size
        });
        return result;
    }

    formatRichText(s: string, base: SubtitleStyle): RichTextNode {
        const attrs = this.#toAttrs(base);
        if (attrs.length == 0) return s;
        return {
            type: 'leaf',
            attrs, content: s
        };
    }

    formatASSString(s: string): string {
        // FIXME: there seems to be no way in ASS to escape '\n', '\N' or '\H', should warn about that
        // but '{' can be escaped
        return s.replaceAll('{', '\\{');
    }

    processElement(elem: string) {
        elem = elem.trim();
        if (!elem.startsWith('\\')) return;

        elem.split('\\').forEach((x) => {
            const s = x.trim();
            if (s.length == 0) return;

            let m: RegExpExecArray | null;
                 if (m = /^i\s*(1|0)?$/.exec(s))  this.#italic = m[1] == '1';
            else if (m = /^u\s*(1|0)?$/.exec(s))  this.#underline = m[1] == '1';
            else if (m = /^s\s*(1|0)?$/.exec(s))  this.#strikeout = m[1] == '1';
            else if (m = /^b\s*(\d+)?$/.exec(s))  this.#bold = Number.parseInt(m[1] ?? '0');
            else if (m = /^fs\s*(\d+)?$/.exec(s))
                this.#fontsize = m[1] ? Number.parseInt(m[1]) : undefined;
            else if (m = /pos\((\d+),(\d+)\)/.exec(s))
                this.#pos = {
                    type: 'absolute',
                    x: Number.parseInt(m[1]), 
                    y: Number.parseInt(m[2])
                };
            else if (m = /an([1-9])/.exec(s))
                this.#align = Number.parseInt(m[1]);

            else this.warnings.ignoredTags.set('\\' + s, 
                (this.warnings.ignoredTags.get('\\' + s) ?? 0) + 1);
        });
    }

    processSpecialCharacter(n: string) {
        switch (n) {
            case '\\n':
                this.warnings.ignoredTags.set(n, 
                    (this.warnings.ignoredTags.get(n) ?? 0) + 1);
                return '\n';
            case '\\N':
                return '\n';
            case '\\h':
                this.warnings.ignoredTags.set(n, 
                    (this.warnings.ignoredTags.get(n) ?? 0) + 1);
                return ' ';
            case '\\{':
                return '\\{';
        }
        return undefined;
    }

    processDrawing(_arg: string, _cmds: string) {
        this.warnings.ignoredDrawing++;
    }
}

export namespace ASSString {
    export function serialize(rt: RichText, base: SubtitleStyle, opts?: {
        defaultWrapStyle?: WrapStyle,
        pos?: Positioning;
    }): string {
        let state = ASSState.fromGlobals({ pos: opts?.pos });
        if (typeof rt === 'string') return state.formatASSString(rt);

        let result = '';
        if (base.wrapStyle !== opts?.defaultWrapStyle)
            result += `{\\q${base.wrapStyle}}`;
        for (const part of rt) {
            const attrs = typeof part === 'string' ? [] : part.attrs;
            const content = typeof part === 'string' ? part : part.content;
            const newState = ASSState.fromAttrs(attrs, base);
            result += ASSState.emitDifference(state, newState, base);
            result += state.formatASSString(content);
            state = newState;
        }
        return result;
    }

    export function parse(
        source: string, base: SubtitleStyle, 
        warnings: ASSStringWarnings
    ): {
        result: RichText,
        pos: Positioning,
        alignment: AlignMode | null,
     } {
        const state = new ASSState(warnings);
        const result: RichTextNode[] = [];
        let lastWord = '';

        function submit(e?: string) {
            if (lastWord.length > 0)
                result.push(state.formatRichText(lastWord, base));
            if (e)
                state.processElement(e);
            lastWord = '';
        }

        let i = 0;
        while (i < source.length) {
            const ch = source[i];
            if (ch == '\\' && i < source.length - 1) {
                const next = source[i+1];
                const sp = state.processSpecialCharacter(ch + next);
                if (sp !== undefined) {
                    lastWord += sp;
                    i += 2;
                    continue;
                }
            } else if (ch == '{' && i < source.length - 1) {
                i++;
                let content = '';
                while (i < source.length && source[i] != '}') {
                    content += source[i];
                    i++;
                }
                if (i == source.length) {
                    lastWord += '{' + content;
                    break;
                }
                i++; // accept '}'
                if (content.startsWith('\\p')) {
                    // handle drawing commands
                    let commands = '';
                    while (i < source.length && !source.slice(i).startsWith('{\\p0}')) {
                        commands += source[i];
                        i++;
                    }
                    if (i == source.length) {
                        lastWord += '{' + content + '}' + commands;
                        break;
                    }
                    i += 3; // accept {\p0}
                    state.processDrawing(content.slice(2), commands);
                    continue;
                }
                submit(content);
                continue;
            }

            lastWord += ch;
            i++;
        }
        submit();

        return { result, pos: state.positioning, alignment: state.alignment };
    }
}