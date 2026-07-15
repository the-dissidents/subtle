import type { RichTextAttr, RichTextNode } from "../RichText";

export class FormattingStateMachine {
    protected _italic = false;
    protected _bold = 0;
    protected _underline = false;
    protected _strikethrough = false;

    get italic() { return this._italic; }
    get bold() { return this._bold > 0; }
    get underline() { return this._underline; }
    get strikethrough() { return this._strikethrough; }

    setItalic(v: boolean) { this._italic = v; }
    setBold(v: boolean | number) { this._bold = v ? 1 : 0; }
    setUnderline(v: boolean) { this._underline = v; }
    setStrikethrough(v: boolean) { this._strikethrough = v; }

    toAttrs(): RichTextAttr[] {
        const result: RichTextAttr[] = [];
        if (this._bold > 0) result.push('bold');
        if (this._italic) result.push('italic');
        if (this._underline) result.push('underline');
        if (this._strikethrough) result.push('strikethrough');
        return result;
    }

    formatRichText(s: string): RichTextNode {
        const attrs = this.toAttrs();
        if (attrs.length == 0) return s;
        return { type: 'leaf', attrs, content: s };
    }
}
