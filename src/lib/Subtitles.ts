import { assert } from "./Basic";
import { CSSColors, parseCSSColor } from "./colorparser";

export enum AlignMode {
    BottomLeft = 1, BottomCenter, BottomRight,
    CenterLeft, Center, CenterRight,
    TopLeft, TopCenter, TopRight,
}

export enum MergeStyleSelection {
    UsedOnly,
    All,
    OnlyStyles
}

export enum MergeStyleBehavior {
    KeepAll,
    KeepDifferent,
    UseLocalByName,
    Overwrite,
    UseOverrideForAll
}

export enum MergePosition {
    SortedBefore, SortedAfter, 
    Before, After, Overwrite, Custom
}

export type MergeOptions = {
    style?: MergeStyleBehavior,
    overrideStyle?: SubtitleStyle,
    selection?: MergeStyleSelection,
    position?: MergePosition,
    customPosition?: number,
    overrideMetadata?: boolean
}

export type TimeShiftOptions = {
    selection?: SubtitleEntry[],
    modifySince?: boolean,
    offset?: number,
    scale?: number
}

export class SubtitleStyle {
    font: string = '';
    size: number = 72;
    color: string = 'white';
    outlineColor: string = 'black';
    outline: number = 1;
    shadow: number = 0;
    styles = {
        bold: false,
        italic: false,
        underline: false,
        strikethrough: false
    };
    margin = {top: 10, bottom: 10, left: 10, right: 10};
    alignment: AlignMode = AlignMode.BottomCenter;

    readonly uniqueID: number;
    static #counter = 0;

    constructor(public name: string) {
        this.uniqueID = SubtitleStyle.#counter;
        SubtitleStyle.#counter++;
    }

    clone() {
        return SubtitleStyle.deserialize(this.toSerializable());
    }

    deepEquals(other: SubtitleStyle) {
        return JSON.stringify(this.toSerializable()) == JSON.stringify(other.toSerializable());
    }

    toSerializable() {
        return {
            name: this.name,
            color: this.color,
            outlineColor: this.outlineColor,
            outline: this.outline,
            shadow: this.shadow,
            styles: this.styles,
            font: this.font,
            size: this.size,
            margin: {
                top: this.margin.top,
                bottom: this.margin.bottom,
                left: this.margin.left,
                right: this.margin.right
            },
            alignment: this.alignment
        }
    }

    static deserialize(o: ReturnType<SubtitleStyle['toSerializable']>) {
        let style = new SubtitleStyle(o.name);
        if (o.font !== undefined) style.font = o.font;
        if (o.size !== undefined) style.size = o.size;
        if (o.color !== undefined) style.color = o.color;
        if (o.shadow !== undefined) style.shadow = o.shadow;
        if (o.outline !== undefined) style.outline = o.outline;
        if (o.styles !== undefined) style.styles = o.styles;
        if (o.outlineColor !== undefined) style.outlineColor = o.outlineColor;
        if (o.margin !== undefined) style.margin = o.margin;
        if (o.alignment !== undefined) style.alignment = o.alignment;
        return style;
    }
}

export type SubtitleChannel = {
    style: SubtitleStyle,
    text: string,
    // I don't consider this a good practice, but we have to store which channel corresponds to which text area, if any
    gui?: HTMLTextAreaElement
}

export class SubtitleEntry {
    texts: SubtitleChannel[] = [];
    // Same here
    gui?: HTMLElement;

    static #counter = 0;
    readonly uniqueID: number;

    constructor(
        public start: number,
        public end: number,
        ...text: SubtitleChannel[]) 
    {
        this.texts = text;
        this.uniqueID = SubtitleEntry.#counter;
        SubtitleEntry.#counter++;
    }

    toSerializable() {
        return {
            start: this.start,
            end: this.end,
            texts: this.texts.map((x) => [x.style.name, x.text])
        }
    }

    static deserialize(o: ReturnType<SubtitleEntry['toSerializable']>, subs: Subtitles) {
        return new SubtitleEntry(o.start, o.end, ...o.texts.map((x) => ({
            style: subs.styles.find((s) => s.name == x[0]) ?? subs.defaultStyle, 
            text: x[1]})))
    }
}

export class Subtitles {
    defaultStyle: SubtitleStyle;
    styles: SubtitleStyle[] = [];
    entries: SubtitleEntry[] = [];
    metadata = {
        title: '',
        language: '',
        width: 1920,
        height: 1080,
        special: {
            untimedText: ''
        }
    }

    constructor(base?: Subtitles) {
        if (base) {
            this.defaultStyle = base.defaultStyle.clone();
            this.styles = base.styles.map((x) => x.clone());
        } else
            this.defaultStyle = new SubtitleStyle('default');
    }

    /** Note: this method will use and modify the entries in `other` */ 
    merge(other: Subtitles, options: MergeOptions): SubtitleEntry[] {
        if (options.overrideMetadata) {
            other.metadata = JSON.parse(JSON.stringify(this.metadata));
        }

        let styleMap = new Map<SubtitleStyle, SubtitleStyle>();
        let processStyle = (s: SubtitleStyle) => {
            if (styleMap.has(s)) return styleMap.get(s)!;
            let iLocal = this.styles.findIndex((x) => x.name == s.name);
            let namedDefault = s.name == this.defaultStyle.name;
            if (iLocal < 0 && !namedDefault) {
                this.styles.push(s);
                styleMap.set(s, s);
                return s;
            } else switch (options.style ?? MergeStyleBehavior.KeepDifferent) {
                case MergeStyleBehavior.KeepDifferent:
                    if (s.deepEquals(namedDefault ? this.defaultStyle : this.styles[iLocal]))
                    {
                        if (namedDefault) styleMap.set(s, this.defaultStyle);
                        else styleMap.set(s, this.styles[iLocal]);
                        return styleMap.get(s)!;
                    } // else, fallthrough
                case MergeStyleBehavior.KeepAll:
                    // generate unqiue name
                    let newStyle = s.clone();
                    newStyle.name = SubtitleTools.getUniqueStyleName(this, s.name);
                    this.styles.push(newStyle);
                    styleMap.set(s, newStyle);
                    return newStyle;
                case MergeStyleBehavior.UseLocalByName:
                    if (namedDefault) styleMap.set(s, this.defaultStyle);
                    else styleMap.set(s, this.styles[iLocal]);
                    return styleMap.get(s)!;
                case MergeStyleBehavior.Overwrite:
                    this.styles.splice(iLocal, 1, s);
                    styleMap.set(s, s);
                    return s;
                case MergeStyleBehavior.UseOverrideForAll:
                    styleMap.set(s, options.overrideStyle ?? this.defaultStyle);
                    return styleMap.get(s)!;
                default: assert(false);
            }
        };
        if (options.selection) switch (options.selection) {
            case MergeStyleSelection.OnlyStyles:
            case MergeStyleSelection.All:
                for (let style of other.styles) processStyle(style);
                break;
        }

        if (options.selection == MergeStyleSelection.OnlyStyles)
            return [];

        let position = options.position ?? MergePosition.After;
        if (position == MergePosition.Overwrite)
            this.entries = [];
        let insertEntry: (e: SubtitleEntry) => void;
        let index = options.customPosition ?? 0;
        switch (position) {
            case MergePosition.SortedBefore:
                insertEntry = (e) => {
                    let i = this.entries.findIndex((x) => x.start >= e.start);
                    this.entries.splice(i, 0, e);
                }; break;
            case MergePosition.SortedAfter:
                insertEntry = (e) => {
                    let i = this.entries.findLastIndex((x) => x.start <= e.start);
                    this.entries.splice(i+1, 0, e);
                }; break;
            case MergePosition.Before:
            case MergePosition.Custom:
                insertEntry = (e) => {
                    this.entries.splice(index, 0, e);
                    index++;
                }; break;
            case MergePosition.After:
            case MergePosition.Overwrite:
                insertEntry = (e) => {
                    this.entries.push(e);
                }; break;
            default: assert(false);
        }

        for (let ent of other.entries) {
            insertEntry(ent);
            for (let channel of ent.texts)
                channel.style = processStyle(channel.style);
        }
        return other.entries;
    }

    // first scale, then offset
    shiftTimes(options: TimeShiftOptions) {
        let modifySince = options.modifySince ?? false;
        let offset = options.offset ?? 0;
        let scale = options.scale ?? 1;
        if (offset == 0 && scale == 1) return false;
        let selection = options.selection ?? this.entries;
        let set = new Set(selection);
        let start = Math.min(...selection.map((x) => x.start));
        for (let ent of this.entries) {
            if (set.has(ent) || (ent.start >= start && modifySince)) {
                ent.start = Math.max(0, ent.start * scale + offset);
                ent.end = Math.max(0, ent.end * scale + offset);
            }
        }
        return true;
    }

    toSerializable() {
        return {
            metadata: this.metadata,
            defaultStyle: this.defaultStyle.toSerializable(),
            styles: this.styles.map((x) => x.toSerializable()),
            entries: this.entries.map((x) => x.toSerializable()),
        }
    }

    static deserialize(o: ReturnType<Subtitles['toSerializable']>) {
        let subs = new Subtitles();
        subs.metadata.width = o.metadata?.width ?? 1920;
        subs.metadata.height = o.metadata?.height ?? 1080;
        subs.metadata.title = o.metadata?.title ?? '';
        subs.metadata.language = o.metadata?.language ?? '';
        subs.metadata.special.untimedText = o.metadata?.special?.untimedText ?? '';

        subs.defaultStyle = SubtitleStyle.deserialize(o.defaultStyle);
        subs.styles = o.styles.map((x) => SubtitleStyle.deserialize(x));
        subs.entries = o.entries
            .map((x) => SubtitleEntry.deserialize(x, subs))
            .filter((x) => x.texts.length > 0);
        return subs;
    }
}

// &HAABBGGRR
function toASSColor(str: string) {
    let rgba = parseCSSColor(str);
    if (!rgba) return '&H00FFFFFF';
    return '&H' 
        + ((1 - rgba[3]) * 255).toString(16).toUpperCase().padStart(2, '0')
        + rgba[2].toString(16).toUpperCase().padStart(2, '0')
        + rgba[1].toString(16).toUpperCase().padStart(2, '0')
        + rgba[0].toString(16).toUpperCase().padStart(2, '0');
}

function fromASSColor(str: string) {
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

export const SubtitleExport = {
    JSON(subs: Subtitles) {
        return JSON.stringify(subs.toSerializable());
    },
    SRT(subs: Subtitles) {
        // assumes no overlapping entries
        let result = '', i = 1;
        for (let entry of subs.entries) {
            result += `${i}\n${SubtitleUtil.formatTimestamp(entry.start, 3, ',')} --> ${SubtitleUtil.formatTimestamp(entry.end, 3, ',')}\n${entry.texts.map((x) => x.text).join('\n')}\n\n`;
            i += 1;
        }
        return result;
    },
    ASS(subs: Subtitles) {
        return SubtitleExport.ASSHeader(subs) + SubtitleExport.ASSFragment(subs);
    },
    ASSHeader(subs: Subtitles) {
        let result = 
`[Script Info]
ScriptType: v4.00+
YCbCr Matrix: None
Title: ${subs.metadata.title}
PlayResX: ${subs.metadata.width}
PlayResY: ${subs.metadata.height}
LayoutResX: ${subs.metadata.width}
LayoutResY: ${subs.metadata.height}

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
`;
        for (let s of [subs.defaultStyle, ...subs.styles])
            result += `Style: ${s.name},`
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
        result += 
`
[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`;
        return result;
    },
    ASSFragment(subs: Subtitles) {
        let result = '';
        for (let entry of subs.entries) {
            let t0 = SubtitleUtil.formatTimestamp(entry.start, 2);
            let t1 = SubtitleUtil.formatTimestamp(entry.end, 2);
            for (let channel of entry.texts)
                result += `Dialogue: 0,${t0},${t1},${channel.style.name},,0,0,0,,${channel.text.replaceAll('\n', '\\N')}\n`;
        }
        return result;
    },
    plaintext(subs: Subtitles) {
        return subs.entries
            .map((x) => x.texts.map((y) => y.text)
            .join('\n')).join('\n');
    }
}

function getASSSections(source: string) {
    const sectionRegex  = /\[(.+)\]\s*\n((?:\s*[^[\n]+.+\n)+)/g;
    return new Map([...source.matchAll(sectionRegex)].map((x) => [x[1], x[2]]));
}

function getASSFormatFieldMap(section: string) {
    const fieldMapMatch = section.match(/Format:\s*(.*)\n/);
    if (!fieldMapMatch) return null;
    return new Map(
        fieldMapMatch[1].split(/,/).map((x, i) => [x.trim(), i] as const));
}

function parseASSScriptInfo(sections: Map<string, string>, subs: Subtitles) {
    let text = sections.get('Script Info');
    if (text === undefined) return;

    const entryRegex = /(?<=\n)([^;].+?): *(.*)/g;
    const infos = new Map([...text.matchAll(entryRegex)]
        .map((x) => [x[1], x[2]]));
    subs.metadata.title = infos.get('Title') ?? subs.metadata.title;
    if (infos.has('PlayResX')) {
        const n = Number.parseInt(infos.get('PlayResX')!);
        if (!Number.isNaN(n)) subs.metadata.width = n;
    }
    if (infos.has('PlayResY')) {
        const n = Number.parseInt(infos.get('PlayResY')!);
        if (!Number.isNaN(n)) subs.metadata.height = n;
    }
}

function parseASSStyles(sections: Map<string, string>, subs: Subtitles) {
    let text = sections.get('V4 Styles') ?? sections.get('V4+ Styles');
    if (text === undefined) return;

    const styleFieldMap = getASSFormatFieldMap(text);
    if (styleFieldMap == null) return subs;
    console.log(styleFieldMap);

    const stylesRegex   = /Style:\s*(.*)\n/g;
    let styles: Map<string, SubtitleStyle> = new Map();
    let first: SubtitleStyle | null = null;
    const styleMatches = text.matchAll(stylesRegex);
    for (const match of styleMatches) {
        const items = match[1].split(',');
        try {
            const name = items[styleFieldMap.get('Name')!];
            let style = styles.get(name);
            if (style === undefined) {
                style = new SubtitleStyle(name);
                if (first === null)
                    first = style;
                else
                    subs.styles.push(style);
                styles.set(name, style);
            } else {
                // warn
                console.warn('duplicate style definition:', name);
            }
            if (styleFieldMap.has('Fontname'))
                style.font = items[styleFieldMap.get('Fontname')!];
            if (styleFieldMap.has('Bold'))
                style.styles.bold = items[styleFieldMap.get('Bold')!] == '-1';
            if (styleFieldMap.has('Italic'))
                style.styles.italic = items[styleFieldMap.get('Italic')!] == '-1';
            if (styleFieldMap.has('Underline'))
                style.styles.underline = 
                    items[styleFieldMap.get('Underline')!] == '-1';
            if (styleFieldMap.has('StrikeOut'))
                style.styles.strikethrough = 
                    items[styleFieldMap.get('StrikeOut')!] == '-1';
            
            if (styleFieldMap.has('Fontsize')) {
                const n = Number.parseFloat(items[styleFieldMap.get('Fontsize')!]);
                if (!Number.isNaN(n)) style.size = n;
            }
            if (styleFieldMap.has('Fontsize')) {
                const n = Number.parseFloat(items[styleFieldMap.get('Fontsize')!]);
                if (!Number.isNaN(n)) style.size = n;
            }
            if (styleFieldMap.has('Outline')) {
                const n = Number.parseFloat(items[styleFieldMap.get('Outline')!]);
                if (!Number.isNaN(n)) style.outline = n;
            }
            if (styleFieldMap.has('Shadow')) {
                const n = Number.parseFloat(items[styleFieldMap.get('Shadow')!]);
                if (!Number.isNaN(n)) style.shadow = n;
            }
            if (styleFieldMap.has('PrimaryColor')) {
                const color = fromASSColor(items[styleFieldMap.get('PrimaryColor')!]);
                if (color !== null) style.color = color;
            }
            if (styleFieldMap.has('OutlineColor')) {
                const color = fromASSColor(items[styleFieldMap.get('OutlineColor')!]);
                if (color !== null) style.outlineColor = color;
            }
            if (styleFieldMap.has('Alignment')) {
                const n = Number.parseFloat(items[styleFieldMap.get('Alignment')!]);
                if (n >= 1 && n <= 9) style.alignment = n as AlignMode;
            }
            if (styleFieldMap.has('MarginL')) {
                const n = Number.parseFloat(items[styleFieldMap.get('MarginL')!]);
                if (!Number.isNaN(n)) style.margin.left = n;
            }
            if (styleFieldMap.has('MarginR')) {
                const n = Number.parseFloat(items[styleFieldMap.get('MarginR')!]);
                if (!Number.isNaN(n)) style.margin.right = n;
            }
            if (styleFieldMap.has('MarginV')) {
                const n = Number.parseFloat(items[styleFieldMap.get('MarginV')!]);
                if (!Number.isNaN(n)) style.margin.top = style.margin.bottom = n;
            }
            console.log('imported style:', name, style);
        } catch {
            console.log('error when importing style');
        }
    }
    
    if (first == null) {
        // no styles
        console.warn('no style defined', name);
    } else {
        subs.defaultStyle = first;
    }
}

function parseASSEvents(sections: Map<string, string>, subs: Subtitles) {
    let text = sections.get('Events');
    if (text === undefined) return;

    const fieldMap = getASSFormatFieldMap(text);
    if (fieldMap == null 
        || !fieldMap.has('Start') 
        || !fieldMap.has('End') 
        || !fieldMap.has('Style')
        || !fieldMap.has('Text')) return subs;
    console.log(fieldMap);

    const regex = RegExp(String.raw
        `^Dialogue:\s*((?:(?:[^,\n\r])*,){${fieldMap.size-1}})(.+)`, 'gm');
    let styles: Map<string, SubtitleStyle> = new Map(
        [subs.defaultStyle, ...subs.styles].map((x) => [x.name, x]));
    for (const match of text.matchAll(regex)) {
        const opts = match[1].split(',');
        const start = SubtitleUtil.parseTimestamp(opts[fieldMap.get('Start')!]),
              end   = SubtitleUtil.parseTimestamp(opts[fieldMap.get('End')!]);
        if (start === null || end === null) continue;

        let styleName = opts[fieldMap.get('Style')!];
        if (!styles.has(styleName)) {
            let style = new SubtitleStyle(styleName);
            styles.set(styleName, style);
            subs.styles.push(style);
        }
        subs.entries.push(new SubtitleEntry(start, end, {
            style: styles.get(styleName)!, 
            text: match[2].replaceAll('\\N', '\n').trimEnd()}))
    }
}

export const SubtitleImport = {
    JSON(source: string) {
        try {
            let result = Subtitles.deserialize(JSON.parse(source));
            return result;
        } catch (e: any) {
            console.log('note: failed importing json', e);
            return null;
        }
    },
    SRT_VTT(source: string) {
        const regex = 
            /\n(\d+:\d+:\d+[,.]\d+)\s-->\s(\d+:\d+:\d+[,.]\d+).+\n((.+\n)+)$/gm;
        let matches = [...source.matchAll(regex)];
        if (matches.length == 0) return null;

        let subs = new Subtitles();
        for (let match of matches) {
            let start = SubtitleUtil.parseTimestamp(match[1]),
                end = SubtitleUtil.parseTimestamp(match[2]);
            if (start === null || end === null) continue;
            subs.entries.push(new SubtitleEntry(
                start, end, {style: subs.defaultStyle, text: match[3].trimEnd()}))
        }
        return subs;
    },
    ASS(source: string) {
        const sections = getASSSections(source);
        let subs = new Subtitles();
        parseASSScriptInfo(sections, subs);
        parseASSStyles(sections, subs);
        parseASSEvents(sections, subs);
        return subs;
    }
}

export const SubtitleTools = {
    alignTimes: (subs: Subtitles, epsilon: number) => {
        for (let i = 0; i < subs.entries.length - 1; i++) {
            let s0 = subs.entries[i].start;
            let e0 = subs.entries[i].end;
            for (let j = i + 1; j < subs.entries.length; j++) {
                let s1 = subs.entries[j].start;
                let e1 = subs.entries[j].end;
                if (Math.abs(s1 - s0) <= epsilon)
                    subs.entries[j].start = s0;
                if (Math.abs(e1 - e0) <= epsilon)
                    subs.entries[j].end = e0;
            }
        }
    },
    replaceStyle: (entries: SubtitleEntry[], from: SubtitleStyle, to: SubtitleStyle) => {
        let changed = false;
        for (let ent of entries)
            for (let channel of ent.texts)
                if (channel.style.uniqueID == from.uniqueID) {
                    channel.style = to;
                    changed = true;
                }
        return changed;
    },
    makeTestSubtitles: () => {
        let subs = new Subtitles();
        for (let i = 0; i < 10; i++) {
            subs.entries.push(new SubtitleEntry(i*5, i*5+5, 
                {style: subs.defaultStyle, text: `测试第${i}行`}));
        }
        return subs;
    },
    getUniqueStyleName: (subs: Subtitles, base: string) => {
        let i = 1;
        let newName = base;
        while (subs.styles.find((x) => x.name == newName) || 
            newName == subs.defaultStyle.name)
        {
            newName = base + `_${i}`;
            i++;
        }
        return newName;
    }
}

export const SubtitleUtil = {
    parseTimestamp: (t: string) => {
        const reg = /(\d+):(\d+):(\d+)[,.](\d+)/;
        let match = reg.exec(t);
        if (!match) return null;
        let h = parseInt(match[1]),
            m = parseInt(match[2]),
            s = parseFloat(match[3] + '.' + match[4]);
        let result = h * 3600 + m * 60 + s;
        if (isNaN(result)) return null;
        return result;
    },
    formatTimestamp: (t: number, n: number = 3, char = '.') => {
        let h = Math.floor(t / 3600).toString().padStart(2, '0');
        let m = Math.floor((t % 3600) / 60).toString().padStart(2, '0');
        let s = Math.floor(t % 60).toString().padStart(2, '0');
        let ms = (t % 1).toFixed(n).slice(2);
        return `${h}:${m}:${s}${char}${ms}`;
    },
    getTextLength: (s: string) => {
        return [...s.matchAll(/[\w\u4E00-\u9FFF]/g)].length;
    },
    normalizeNewlines: (s: string) => {
        return s.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
    }
}