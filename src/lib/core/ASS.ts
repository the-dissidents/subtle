import { CSSColors, parseCSSColor } from "../colorparser";
import { AlignMode, SubtitleEntry, Subtitles, SubtitleStyle, SubtitleUtil, type SubtitleChannel } from "./Subtitles.svelte";

export const ASS = {
    parse(source: string) {
        const sections = getASSSections(source);
        if (sections.size == 0) return null;
        let subs = new Subtitles();
        if (!parseASSScriptInfo(sections, subs)) return null;
        parseASSStyles(sections, subs);
        parseASSEvents(sections, subs);
        return subs;
    },
    exportFragment(subs: Subtitles) {
        let result = '';
        for (let entry of subs.entries) {
            let t0 = SubtitleUtil.formatTimestamp(entry.start, 2);
            let t1 = SubtitleUtil.formatTimestamp(entry.end, 2);
            for (let channel of entry.texts)
                result += `Dialogue: 0,${t0},${t1},${channel.style.name},,0,0,0,,${channel.text.replaceAll('\n', '\\N')}\n`;
        }
        return result;
    },
    export(subs: Subtitles) {
        return writeASSHeader(subs) + this.exportFragment(subs);
    },
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

function writeASSHeader(subs: Subtitles) {
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
    result += '\n' +
`[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`;
    return result;
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
    if (text === undefined) return false;

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
    return true;
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
    function getStyleOrCreate(styleName: string) {
        let style = styles.get(styleName);
        if (!style) {
            console.log(`warning: style not found: ${styleName}`);
            style = new SubtitleStyle(styleName);
            styles.set(styleName, style);
            subs.styles.push(style);
        }
        return style;
    }

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
        let style = getStyleOrCreate(styleName);
        let text = match[2].replaceAll('\\N', '\n').trimEnd();
        let breaks = [...text.matchAll(/\n{\\r(.*?)}/g)];
        if (breaks.length == 0) {
            // regular entry
            subs.entries.push(new SubtitleEntry(start, end, { style, text }));
        } else {
            // multiple channels
            let startIndex = 0, currentStyle = style;
            let channels: SubtitleChannel[] = [];
            breaks.forEach((x) => {
                channels.push({ 
                    style: currentStyle, 
                    text: text.substring(startIndex, x.index) 
                });
                currentStyle = x[1] ? getStyleOrCreate(x[1]) : style;
                startIndex = x.index + x[0].length;
            });
            channels.push({ style: currentStyle, text: text.substring(startIndex) });
            subs.entries.push(new SubtitleEntry(start, end, ...channels));
        }
    }
}
