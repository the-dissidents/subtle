import { Basic } from "../Basic";
import { CSSColors, parseCSSColor } from "../colorparser";
import { Debug } from "../Debug";
import { DeserializationError } from "../Serialization";
import { AlignMode, SubtitleEntry, Subtitles, type SubtitleFormat, type SubtitleParser, type SubtitleStyle, type SubtitleWriter } from "./Subtitles.svelte";
import { SubtitleTools } from "./SubtitleUtil.svelte";

export const ASSSubtitles = {
    detect(source) {
        try {
            new ASSParser(source);
            return true;
        } catch (e) {
            return false;
        }
    },
    parse: (source) => new ASSParser(source),
    write: (subs) => new ASSWriter(subs)
} satisfies SubtitleFormat;

export type ASSParseInvalidWarning = {
    type: 'invalid-style-field',
    name: string,
    field: string,
    value: string
} | {
    type: 'duplicate-style-definition',
    name: string
} | {
    type: 'no-styles',
} | {
    type: 'undefined-style',
    name: string
} | {
    type: 'invalid-event-field',
    line: number,
    field: string,
    value: string
};

export type ASSParseUnsupportedWarning = {
    type: 'ignored-style-field',
    name: string,
    field: string,
    value: string
} | {
    type: 'ignored-special-character',
    name: string,
    occurrence: number
} | {
    type: 'ignored-override-tag',
    occurrence: number
} | {
    type: 'ignored-drawing-command',
    occurrence: number
} | {
    type: 'ignored-event-field',
    field: string,
    occurrence: number
} | {
    type: 'ignored-embedded-fonts'
};

export type ASSParseWarning = 
    ({ category: 'invalid' } & ASSParseInvalidWarning) 
  | ({ category: 'unsupported' } & ASSParseUnsupportedWarning);

export class ASSParser implements SubtitleParser {
    #subs: Subtitles;
    #sections: Map<string, string>;
    #warnings: ASSParseWarning[] = [];
    #parsed = false;

    constructor(source: string) {
        const sectionRegex  = /^\[(.+)\]\s*\n((?:\s*[^[\n]+.+\n)+)/gm;
        this.#sections = new Map([...source.matchAll(sectionRegex)].map((x) => [x[1], x[2]]));
        if (this.#sections.size == 0)
            throw new DeserializationError('invalid ASS');
        this.#subs = new Subtitles();
        this.#parseScriptInfo();
    }

    preserveInlines = true;
    transformInlineMultichannel = true;

    parse() {
        if (this.#parsed) {
            this.#warnings = [];
            this.#subs = new Subtitles();
            this.#parseScriptInfo();
        }
        this.#parseStyles();
        this.#parseEvents();
        this.#parseFonts();
        this.#subs.migrated = 'ASS';
        this.#parsed = true;
        return this;
    }

    done(): Subtitles {
        if (!this.#parsed) this.parse();
        return this.#subs;
    }

    get warnings(): readonly ASSParseWarning[] {
        Debug.assert(this.#parsed);
        return this.#warnings;
    }

    #invalid(w: ASSParseInvalidWarning) {
        this.#warnings.push({...w, category: 'invalid'});
    }

    #unsupported(w: ASSParseUnsupportedWarning) {
        this.#warnings.push({...w, category: 'unsupported'});
    }

    #parseScriptInfo() {
        let text = this.#sections.get('Script Info');
        if (text === undefined)
            throw new DeserializationError('invalid ASS: script info not found');

        const entryRegex = /(?<=\n)([^;].+?): *(.*)/g;
        const infos = new Map([...text.matchAll(entryRegex)]
            .map((x) => [x[1], x[2]]));
        this.#subs.metadata.title = infos.get('Title') ?? this.#subs.metadata.title;
        if (infos.has('PlayResX')) {
            const n = Number.parseInt(infos.get('PlayResX')!);
            if (!Number.isNaN(n)) this.#subs.metadata.width = n;
        }
        if (infos.has('PlayResY')) {
            const n = Number.parseInt(infos.get('PlayResY')!);
            if (!Number.isNaN(n)) this.#subs.metadata.height = n;
        }
    }

    #parseAlignment(value: number): AlignMode | null {
        if (this.#sections.has('V4 Styles')) switch (value) {
            // Reference: https://aegisub.org/docs/latest/ass_tags/
            // section "Line alignment (legacy)"
            case 1: return AlignMode.BottomLeft;
            case 2: return AlignMode.BottomCenter;
            case 3: return AlignMode.BottomRight;
            case 5: return AlignMode.TopLeft;
            case 6: return AlignMode.TopCenter;
            case 7: return AlignMode.TopRight;
            case 9: return AlignMode.CenterLeft;
            case 10: return AlignMode.Center;
            case 11: return AlignMode.CenterRight;
            default: return null;
        }
        if (value >= 1 && value <= 9) return value as AlignMode;
        return null;
    }

    #parseStyles() {
        let text = this.#sections.get('V4 Styles')
                ?? this.#sections.get('V4+ Styles')
                ?? this.#sections.get('V4++ Styles');
        if (text === undefined) {
            this.#invalid({ type: 'no-styles' });
            return;
        }
        let styleFieldMap = this.#sections.has('V4++ Styles')
            ? getASSFormatFieldMap('Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginT, MarginB, Encoding, RelativeTo')
            : getASSFormatFieldMap(text);
        if (styleFieldMap == null)
            throw new DeserializationError('invalid ASS');
        if (!styleFieldMap.has('Name'))
            throw new DeserializationError('invalid ASS');

        this.#subs.styles = [];

        const stylesRegex = /Style:\s*(.*)\n/g;
        let first: SubtitleStyle | undefined;
        let nameToStyle = new Map<string, SubtitleStyle>();

        const styleMatches = text.matchAll(stylesRegex);
        for (const match of styleMatches) {
            const bool = (field: string, f: (x: boolean) => boolean | void) => {
                if (!styleFieldMap!.has(field)) return;
                const value = items[styleFieldMap!.get(field)!];
                if (value == '-1' && f(true) !== false) return;
                else if (value == '0' && f(false) !== false) return;
                else this.#invalid({ type: 'invalid-style-field', name, field, value });
            };
            const float = 
            (field: string, f: (x: number) => boolean | void) => {
                if (!styleFieldMap!.has(field)) return;
                const value = items[styleFieldMap.get(field)!];
                const n = Number.parseFloat(value);
                if (!isNaN(n) && f(n) !== false) return;
                this.#invalid({ type: 'invalid-style-field', name, field, value });
            };
            const color = (field: string, f: (x: string) => boolean | void) => {
                if (!styleFieldMap!.has(field)) return;
                const value = items[styleFieldMap.get(field)!];
                const color = fromASSColor(value);
                if (color !== null && f(color) !== false) return;
                else this.#invalid({ type: 'invalid-style-field', name, field, value });
            };
            const ignore = (field: string, def: string | RegExp) => {
                if (!styleFieldMap!.has(field)) return;
                const value = items[styleFieldMap.get(field)!];
                if (typeof def == 'string'
                    ? value == def
                    : def.test(value)) return;
                this.#unsupported({ type: 'ignored-style-field', name, field, value });
            };

            const items = match[1].split(',');
            if (items.length != styleFieldMap.size)
                throw new DeserializationError('invalid ASS');
            const name = items[styleFieldMap.get('Name')!];
            let style = nameToStyle.get(name);
            if (style === undefined) {
                let newStyle = $state(Subtitles.createStyle(name));
                style = newStyle;
                this.#subs.styles.push(newStyle);
                nameToStyle.set(name, newStyle);
                if (!first) first = style;
            } else {
                this.#invalid({ type: 'duplicate-style-definition', name });
            }

            if (styleFieldMap.has('Fontname'))
                style.font = items[styleFieldMap.get('Fontname')!];

            bool('Bold',        (x) => {style.styles.bold = x});
            bool('Italic',      (x) => {style.styles.italic = x});
            bool('Underline',   (x) => {style.styles.underline = x});
            bool('StrikeOut',   (x) => {style.styles.strikethrough = x});

            float('Fontsize',   (x) => {style.size = x});
            float('Outline',    (x) => {style.outline = x});
            float('Shadow',     (x) => {style.shadow = x});
            float('MarginL',    (x) => {style.margin.left = x});
            float('MarginR',    (x) => {style.margin.right = x});
            float('MarginT',    (x) => {style.margin.top = x});
            float('MarginB',    (x) => {style.margin.bottom = x});
            float('MarginV',    (x) => {[style.margin.top, style.margin.bottom] = [x, x]});
            float('Alignment',  (x) => {
                const a = this.#parseAlignment(x);
                if (a === null) return false;
                style.alignment = a;
            });

            color('PrimaryColor', (x) => {style.color = x});
            color('OutlineColor', (x) => {style.outlineColor = x});

            ignore('ScaleX', /^100(\.0+)?$/);
            ignore('ScaleY', /^100(\.0+)?$/);
            ignore('Spacing', /^0(\.0+)?$/);
            ignore('Angle', /^0(\.0+)?$/);
            ignore('BorderStyle', '1');
            ignore('RelativeTo', '0');

            // FIXME: SecondaryColour and BackColour are also ignored but not warned here
            // because we don't know when to warn, yet we don't want to warn every time
        }
        
        if (!first) this.#invalid({ type: 'no-styles' });
        else this.#subs.defaultStyle = first;
    }

    #parseEvents() {
        let text = this.#sections.get('Events');
        if (text == null)
            throw new DeserializationError('invalid ASS');

        const fieldMap = getASSFormatFieldMap(text);
        if (fieldMap == null 
         || !fieldMap.has('Start') 
         || !fieldMap.has('End') 
         || !fieldMap.has('Style')
         || !fieldMap.has('Text'))
            throw new DeserializationError('invalid ASS');

        const nameToStyle = new Map(this.#subs.styles.map((x) => [x.name, x]));
        const getStyleOrCreate = (styleName: string) => {
            let style = nameToStyle.get(styleName);
            if (!style) {
                this.#invalid({ type: 'undefined-style', name: styleName });
                let newStyle = $state(Subtitles.createStyle(styleName));
                style = newStyle;
                nameToStyle.set(styleName, newStyle);
                this.#subs.styles.push(newStyle);
            }
            return style;
        };

        let ignoredSpecial = new Map<string, number>();
        let ignoredField = new Map<string, number>();
        let ignoredOverride = 0;
        let ignoredDrawing = 0;

        const regex = RegExp(String.raw
            `^Dialogue:\s*((?:(?:[^,\n\r])*,){${fieldMap.size-1}})(.+)`, 'gm');
        let i = 0;
        for (const line of text.matchAll(regex)) {
            const timestamp = (field: string) => {
                const value = opts[fieldMap.get(field)!];
                const t = Basic.parseTimestamp(value);
                if (t !== null) return t;
                this.#invalid({ type: 'invalid-event-field', line: i, field, value});
                return null;
            };
            const ignore = (field: string, def: string) => {
                if (!fieldMap.has(field) || opts[fieldMap.get(field)!] === def) return;
                ignoredField.set(field, (ignoredField.get(field) ?? 0) + 1);
            };

            i++;
            const opts = line[1].split(',');
            const text = line[2];
            const start = timestamp('Start'),
                  end   = timestamp('End');
            if (start === null || end === null) continue;
            ignore('Effect', '');
            ignore('Name', '');
            ignore('MarginL', '0');
            ignore('MarginR', '0');
            ignore('MarginV', '0');
            ignore('MarginT', '0');
            ignore('MarginB', '0');
            ignore('Marked', '0');
            // FIXME: Layer is currently ignored, but we do export it, so we don't emit a warning

            let entry = new SubtitleEntry(start, end);
            const style = getStyleOrCreate(opts[fieldMap.get('Style')!]);
            let currentStyle = style;
            let parsedText = '';

            const setText = () => {
                const oldText = entry.texts.get(currentStyle);
                entry.texts.set(currentStyle, 
                    oldText === undefined 
                    ? parsedText 
                    : oldText + '\n' + parsedText);
            }

            for (let i = 0; i < text.length; i++) {
                // handle inline multichannel: \N{\r#}
                if (this.transformInlineMultichannel) {
                    let match = /^\\N{\\r(.*?)}/.exec(text.substring(i));
                    if (match) {
                        setText();
                        currentStyle = match[1] ? getStyleOrCreate(match[1]) : style;
                        parsedText = '';
                        i += match[0].length - 1;
                        continue;
                    }
                }
                // handle special characters (escape sequences)
                if (text[i] == '\\' && i < text.length - 1) {
                    i += 1;
                    switch (text[i]) {
                        case 'n':
                        case 'h':
                            ignoredSpecial.set(text[i], (ignoredSpecial.get(text[i]) ?? 0) + 1);
                            parsedText += this.preserveInlines ? ' ' : '\\' + text[i];
                            break;
                        case 'N':
                            parsedText += '\n';
                            break;
                        default:
                            parsedText += '\\' + text[i];
                            break;
                    }
                    continue;
                }
                // handle override tags
                if (text[i] == '{' && i < text.length - 1) {
                    let insideDrawing = false;
                    while (i < text.length) {
                        if (this.preserveInlines)
                            parsedText += text[i];
                        if (insideDrawing) {
                            if (/^{\\p0/.test(text.substring(i)))
                                insideDrawing = false;
                        } else {
                            if (/^{\\p[1-9]/.test(text.substring(i))) {
                                ignoredDrawing++;
                                insideDrawing = true;
                            } else if (text[i] == '}')
                                break;
                        }
                        i++;
                    }
                    ignoredOverride++;
                    continue;
                }
                parsedText += text[i];
            }
            setText();
            this.#subs.entries.push(entry);
        }

        if (ignoredDrawing > 0)
            this.#unsupported({ type: 'ignored-drawing-command', occurrence: ignoredDrawing });
        if (ignoredOverride > 0)
            this.#unsupported({ type: 'ignored-override-tag', occurrence: ignoredOverride });
        for (const [ch, n] of ignoredSpecial)
            this.#unsupported({ type: 'ignored-special-character', name: `\\${ch}`, occurrence: n });
    }

    #parseFonts() {
        if (this.#sections.has('Fonts'))
            this.#unsupported({ type: 'ignored-embedded-fonts' });
    }
}

export class ASSWriter implements SubtitleWriter {
    styleNames = new Map<SubtitleStyle, string>();

    constructor(private subs: Subtitles) {
        // `Default` seems to be a case-insensitive reserved word in the SSA format that always 
        // points to the built-in default style; also the fields of dialogue lines are not 
        // permitted to contain commas. As a consequence, if we have a style name in conflict with 
        // this we must mangle it. 
        for (const style of subs.styles) {
            if (style.name.toLowerCase() == 'default' || style.name.includes(','))
                this.styleNames.set(style, 
                    SubtitleTools.getUniqueStyleName(
                        this.subs, `${style.name.replace(',', '_')}_${this.styleNames.size}`));
            else
                this.styleNames.set(style, style.name);
        }
    }

    // TODO: option: emitASS2

    #headerless = false;
    headerless(x = true) {
        this.#headerless = x;
        return this;
    }

    #useEntries?: SubtitleEntry[];
    useEntries(x: SubtitleEntry[] | undefined) {
        this.#useEntries = x;
        return this;
    }

    toString(): string {
        let result = '';
        const reverseStyles = this.subs.styles.toReversed();
        const entries = this.#useEntries ?? this.subs.entries;
        for (const entry of entries) {
            let t0 = Basic.formatTimestamp(entry.start, 2);
            let t1 = Basic.formatTimestamp(entry.end, 2);
            for (const style of reverseStyles) {
                let text = entry.texts.get(style);
                if (!text) continue;
                const styleName = this.styleNames.get(style);
                Debug.assert(styleName !== undefined);
                result += `Dialogue: 0,${t0},${t1},${styleName},,0,0,0,,${
                    text.replaceAll('\n', '\\N')}\n`;
            }
        }
        if (this.#headerless) return result;
        else return this.writeASSHeader(this.subs) + result;
    }

    writeASSHeader(subs: Subtitles) {
        const width = subs.metadata.width / subs.metadata.scalingFactor;
        const height = subs.metadata.height / subs.metadata.scalingFactor;

        let result = 
`[Script Info]
ScriptType: v4.00+
YCbCr Matrix: None
Title: ${subs.metadata.title}
PlayResX: ${width}
PlayResY: ${height}
LayoutResX: ${width}
LayoutResY: ${height}

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
`;
        for (const s of subs.styles) {
            const styleName = this.styleNames.get(s);
            Debug.assert(styleName !== undefined);
            result += `Style: ${styleName},`
                    + `${s.font == '' ? 'Arial' : s.font},${s.size},`
                    + `${toASSColor(s.color)},`
                    + `${toASSColor(s.color)},`
                    + `${toASSColor(s.outlineColor)},`
                    + `${toASSColor(s.outlineColor)},`
                    + `${s.styles.bold ? '-1' : '0'},`
                    + `${s.styles.italic ? '-1' : '0'},`
                    + `${s.styles.underline ? '-1' : '0'},`
                    + `${s.styles.strikethrough ? '-1' : '0'},`
                    + `100,100,0,0,1,`
                    + `${s.outline},${s.shadow},`
                    + `${s.alignment},`
                    + `${s.margin.left},${s.margin.right},`
                    + `${Math.max(s.margin.top, s.margin.bottom)},`
                    + `1\n`;
        }
        result += '\n' +
`[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`;
        return result;
    }
}

// &HAABBGGRR
export function toASSColor(str: string) {
    let rgba = parseCSSColor(str);
    if (!rgba) return '&H00FFFFFF';
    return '&H' 
        + ((1 - rgba[3]) * 255).toString(16).toUpperCase().padStart(2, '0')
        + rgba[2].toString(16).toUpperCase().padStart(2, '0')
        + rgba[1].toString(16).toUpperCase().padStart(2, '0')
        + rgba[0].toString(16).toUpperCase().padStart(2, '0');
}

export function fromASSColor(str: string) {
    str = str.toUpperCase();
    if (!str.startsWith('&H') || str.length != 10) return null;

    let [r, g, b, a] = [
        Number.parseInt(str.slice(8, 10), 16), 
        Number.parseInt(str.slice(6, 8), 16),
        Number.parseInt(str.slice(4, 6), 16),
        Number.parseInt(str.slice(2, 4), 16)];
    if ([r, g, b, a].some((x) => Number.isNaN(x))) return null;

    let cssColor = [...CSSColors.entries()].find(
        ([_k, [_r, _g, _b, _a]]) => _r == r && _g == g && _b == b && _a == a);
    if (cssColor !== undefined)
        return cssColor[0];
    else
        return `rgba(${r}, ${g}, ${b}, ${a})`;
}

function getASSFormatFieldMap(section: string) {
    const fieldMapMatch = section.match(/Format:\s*(.*)\n/);
    if (!fieldMapMatch) return null;
    return new Map(
        fieldMapMatch[1].split(/,/).map((x, i) => [x.trim(), i] as const));
}