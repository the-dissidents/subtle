// Parser for EBU STL (Tech 3264-E, February 1991) subtitle files.
// Supports the standard EBU format plus two vendor extensions:
//   - Avid STL: detected via CPN=850/CCT=00/LC=09, uses windows-1252 encoding
//   - FAB Subtitler: proprietary FABst blocks (EBN=0xFE) with UTF-16LE text
// Mostly written by DeepSeek 4 Pro

import { DeserializationError } from "../Serialization";
import { SubtitleEntry, Subtitles } from "../Subtitles.svelte";
import { type SubtitleParser } from "./Format";
import { RichText } from "../RichText";
import { Formatter } from "./Formatter";
import { ISO6937Decoder } from "../../details/ISO6937";
import { Debug } from "../../Debug";

// ---------------------------------------------------------------------------
// Enums / constants
// ---------------------------------------------------------------------------

const GSI_SIZE = 1024;
const TTI_SIZE = 128;
const TF_SIZE = 112;

// GSI field offsets
const GSI_CPN = 0;       // offset 0, length 3
const GSI_DFC = 3;       // offset 3, length 8
const GSI_CCT = 12;      // offset 12, length 2
const GSI_LC = 14;       // offset 14, length 2
const GSI_TNB = 238;     // offset 238, length 5
const GSI_TCS = 255;     // offset 255, length 1
const GSI_TCP = 256;     // offset 256, length 8

// STL control bytes (EBU Tech 3264-E §5)
const CTRL_ITALIC_ON   = 0x80;
const CTRL_ITALIC_OFF  = 0x81;
const CTRL_UL_ON       = 0x82;
const CTRL_UL_OFF      = 0x83;
const CTRL_BOX_ON      = 0x84;
const CTRL_BOX_OFF     = 0x85;
const CTRL_LINE_BREAK  = 0x8A;
const CTRL_END_OF_TEXT = 0x8F;

// Teletext colour codes (foreground + background), valid for closed subtitles.
// Other teletext control codes (0x08–0x0F, 0x18–0x1F) are caught as unknown.
const TELETEXT_COLOR_CODES = new Set<number>(
    Array.from({ length: 8 }, (_, i) => i)
        .concat(Array.from({ length: 8 }, (_, i) => 0x10 + i))
);

const KNOWN_CONTROL_BYTES = new Set([
    CTRL_ITALIC_ON, CTRL_ITALIC_OFF,
    CTRL_UL_ON, CTRL_UL_OFF,
    CTRL_BOX_ON, CTRL_BOX_OFF,
    CTRL_LINE_BREAK, CTRL_END_OF_TEXT,
]);

// ---------------------------------------------------------------------------
// Message types
// ---------------------------------------------------------------------------

export type STLParseMessage = {
    type: 'unknown-control-byte',
    category: 'unsupported',
    byte: number,
    occurrence: number
} | {
    type: 'ignored-color-code',
    category: 'unsupported',
    occurrence: number
} | {
    type: 'ignored-boxing-code',
    category: 'unsupported',
    occurrence: number
} | {
    type: 'user-data-block',
    category: 'unsupported',
    occurrence: number
} | {
    type: 'timecode-starts-at-1h',
    category: 'info',
    start: number
};

// ---------------------------------------------------------------------------
// Text encoding
// ---------------------------------------------------------------------------

type STLEncoding = { type: 'iso6937' }
    | { type: 'text-decoder', label: string };

function getEncoding(cct: string, isAvid: boolean): STLEncoding {
    if (isAvid) return { type: 'text-decoder', label: 'windows-1252' };
    switch (cct) {
        case '00': return { type: 'iso6937' };
        case '01': return { type: 'text-decoder', label: 'iso-8859-5' };
        case '02': return { type: 'text-decoder', label: 'iso-8859-6' };
        case '03': return { type: 'text-decoder', label: 'iso-8859-7' };
        case '04': return { type: 'text-decoder', label: 'iso-8859-8' };
        default:
            throw new DeserializationError(`unknown CCT: ${cct}`);
    }
}

// ---------------------------------------------------------------------------
// FAB subtitle format support
// ---------------------------------------------------------------------------
// The FABst blocks are produced by FAB Subtitler (F.A. Bernhardt GmbH), a
// professional subtitling tool. Per the vendor documentation at
// https://kb.fab-online.com/0090-fabsubtitler-files/00010-stlfiles/, these
// blocks are internal metadata not intended for external parsers.
//
// However, the EBU STL text encoding (iso-6937) cannot represent CJK
// characters, so when creating Chinese subtitles, FAB Subtitler writes the
// actual text into its proprietary FABst blocks (EBN=0xFE) using UTF-16LE,
// while the standard EBU text blocks (EBN=0xFF) end up with only spaces and
// punctuation. We are therefore forced to parse the FABst blocks to recover
// the subtitle text.
//
// The text is UTF-16LE encoded. Primary blocks use the format:
//   "FABst" [04] [subnum_hi] [subnum_lo] [00] [data_len] [04] [UTF-16LE text] [trailing_byte]
// When text exceeds the 112-byte TF field, continuation blocks are inserted:
//   "FABst" [data_len] [04] [UTF-16LE text] [trailing_byte]
// Continuation blocks share the same SN as their primary block.

function detectFAB(ttis: TTIFields[]): boolean {
    for (const tti of ttis) {
        if (tti.ebn === 0xFE) {
            if (tti.tf.length >= 5
                && tti.tf[0] === 0x46 // F
                && tti.tf[1] === 0x41 // A
                && tti.tf[2] === 0x42 // B
                && tti.tf[3] === 0x73 // s
                && tti.tf[4] === 0x74 // t
            ) return true;
            return false;
        }
    }
    return false;
}

function decodeFABText(tf: Uint8Array): RichText | null {
    if (tf.length < 7) return null;
    if (tf[0] !== 0x46 || tf[1] !== 0x41 || tf[2] !== 0x42 || tf[3] !== 0x73 || tf[4] !== 0x74)
        return null;

    if (tf[5] === 0x04) {
        // Primary block: "FABst" [04] [subnum_hi] [subnum_lo] [00] [data_len] [04] [text...]
        if (tf.length < 10) return null;
        const dataLen = tf[9];
        const fieldEnd = 10 + dataLen;
        if (fieldEnd > tf.length) return null;
        const fieldData = tf.subarray(10, fieldEnd);
        if (fieldData.length < 2 || fieldData[0] !== 0x04) return null;
        const textBytes = fieldData.subarray(1);
        const evenBytes = textBytes.length % 2 === 0 ? textBytes : textBytes.subarray(0, textBytes.length - 1);
        const text = new TextDecoder('utf-16le').decode(evenBytes)
            .replace(/\0+$/, '')
            .replace(/\u2028/g, '\n');
        if (text.length === 0) return null;
        return text;
    }

    // Continuation block: "FABst" [data_len] [04] [text...]
    const dataLen = tf[5];
    const fieldEnd = 6 + dataLen;
    if (fieldEnd > tf.length) return null;
    const fieldData = tf.subarray(6, fieldEnd);
    if (fieldData.length < 2 || fieldData[0] !== 0x04) return null;
    const textBytes = fieldData.subarray(1);
    const evenBytes = textBytes.length % 2 === 0 ? textBytes : textBytes.subarray(0, textBytes.length - 1);
    const text = new TextDecoder('utf-16le').decode(evenBytes)
        .replace(/\0+$/, '')
        .replace(/\u2028/g, '\n');
    if (text.length === 0) return null;
    return text;
}

// ---------------------------------------------------------------------------
// Text field processor
// ---------------------------------------------------------------------------

class STLTextProcessor extends Formatter {
    #byteBuf: number[] = [];
    #result: RichText[] = [];
    readonly #decoder: ISO6937Decoder | TextDecoder;
    readonly #encoding: STLEncoding;

    constructor(encoding: STLEncoding) {
        super();
        this.#encoding = encoding;
        if (encoding.type === 'iso6937')
            this.#decoder = new ISO6937Decoder();
        else
            this.#decoder = new TextDecoder(encoding.label);
    }

    processTF(tf: Uint8Array): { richText: RichText | null, warnings: STLParseMessage[] } {
        const warnings: STLParseMessage[] = [];
        this.#byteBuf = [];
        this.#result = [];
        this.setItalic(false);
        this.setUnderline(false);

        let colorWarnings = 0;
        let boxingWarnings = 0;
        let unknownCtrl: Map<number, number> | null = null;

        for (let i = 0; i < tf.length; i++) {
            const byte = tf[i];

            if (byte === CTRL_END_OF_TEXT) break;

            if (TELETEXT_COLOR_CODES.has(byte)) {
                this.#flushText();
                colorWarnings++;
                continue;
            }

            if (byte === CTRL_LINE_BREAK) {
                this.#flushText();
                this.#result.push('\n');
                continue;
            }

            if (byte === CTRL_ITALIC_ON)  { this.#flushText(); this.setItalic(true);  continue; }
            if (byte === CTRL_ITALIC_OFF) { this.#flushText(); this.setItalic(false); continue; }
            if (byte === CTRL_UL_ON)      { this.#flushText(); this.setUnderline(true);  continue; }
            if (byte === CTRL_UL_OFF)     { this.#flushText(); this.setUnderline(false); continue; }
            if (byte === CTRL_BOX_ON)     { this.#flushText(); boxingWarnings++; continue; }
            if (byte === CTRL_BOX_OFF)    { this.#flushText(); boxingWarnings++; continue; }

            if (!KNOWN_CONTROL_BYTES.has(byte) && byte < 0x20) {
                this.#flushText();
                unknownCtrl ??= new Map();
                unknownCtrl.set(byte, (unknownCtrl.get(byte) ?? 0) + 1);
                continue;
            }

            this.#byteBuf.push(byte);
        }

        this.#flushText();

        if (colorWarnings > 0) warnings.push({
            type: 'ignored-color-code',
            category: 'unsupported',
            occurrence: colorWarnings
        });
        if (boxingWarnings > 0) warnings.push({
            type: 'ignored-boxing-code',
            category: 'unsupported',
            occurrence: boxingWarnings
        });
        if (unknownCtrl) for (const [byte, occurrence] of unknownCtrl) warnings.push({
            type: 'unknown-control-byte',
            category: 'unsupported',
            byte, occurrence
        });

        const richText = this.#result.length === 0
            ? null
            : RichText.concat(...this.#result);

        return { richText, warnings };
    }

    #flushText() {
        if (this.#byteBuf.length === 0) return;
        const text = this.#decode(this.#byteBuf);
        this.#byteBuf = [];
        this.#result.push([this.formatRichText(text)]);
    }

    #decode(bytes: number[]): string {
        if (this.#encoding.type === 'iso6937') {
            return this.#decoder.decode(new Uint8Array(bytes));
        }
        return (this.#decoder as TextDecoder).decode(new Uint8Array(bytes));
    }
}

// ---------------------------------------------------------------------------
// GSI TCP timecode decoding
// ---------------------------------------------------------------------------
//
// The TCP field (8 bytes, HHMMSSFF) stores each decimal digit as a separate
// byte containing its raw numeric value (0–9), not ASCII and not packed BCD.
// The TCI/TCO fields in TTI blocks use single bytes per component instead.

function decodeTCPTimecode(data: Uint8Array, fps: number): number {
    if (data.length !== 8) return 0;
    for (let i = 0; i < 8; i++) {
        if (data[i] > 9) return 0;
    }
    const h = data[0] * 10 + data[1];
    const m = data[2] * 10 + data[3];
    const s = data[4] * 10 + data[5];
    const f = data[6] * 10 + data[7];
    return decodeTimecode(h, m, s, f, fps);
}

// ---------------------------------------------------------------------------
// TTI timecode decoding
// ---------------------------------------------------------------------------

function decodeTimecode(h: number, m: number, s: number, f: number, fps: number): number {
    return h * 3600 + m * 60 + s + f / fps;
}

// ---------------------------------------------------------------------------
// GSI header parsing
// ---------------------------------------------------------------------------

function readField(data: Uint8Array, pos: number, len: number) {
    return String.fromCharCode(...data.subarray(pos, pos + len));
}

function readGSI(data: Uint8Array) {
    if (data.length < GSI_SIZE)
        throw new DeserializationError('file too small for STL GSI header');

    const cpn = readField(data, GSI_CPN, 3);
    const dfc = readField(data, GSI_DFC, 8);
    const cct = readField(data, GSI_CCT, 2);
    const lc  = readField(data, GSI_LC, 2);
    const tnb = parseInt(readField(data, GSI_TNB, 5), 10);
    const tcs = String.fromCharCode(data[GSI_TCS]);

    if (!isFinite(tnb) || tnb < 0)
        throw new DeserializationError(`invalid TNB`);

    let fps: number;
    if (dfc.startsWith('STL24')) fps = 24;
    else if (dfc.startsWith('STL25')) fps = 25;
    else if (dfc.startsWith('STL30')) fps = 30;
    else throw new DeserializationError(`unknown STL DFC: ${dfc}`);

    const isAvid = cpn == '850' && cct === '00' && lc == '09';
    if (isAvid) void Debug.debug('STL: Avid detected');

    const encoding = getEncoding(cct, isAvid);
    void Debug.debug(`STL: encoding is`, encoding);

    const startTime = tcs === '1'
        ? decodeTCPTimecode(data.subarray(GSI_TCP, GSI_TCP + 8), fps) : 0;

    return { cpn, dfc, fps, cct, lc, tnb, encoding, startTime, isAvid };
}

// ---------------------------------------------------------------------------
// TTI block parsing
// ---------------------------------------------------------------------------

interface TTIFields {
    sgn: number;
    sn: number;
    ebn: number;
    cs: number;
    tci: number;
    tco: number;
    vp: number;
    jc: number;
    cf: number;
    tf: Uint8Array;
}

function readTTI(data: Uint8Array, offset: number, fps: number): TTIFields {
    const view = new DataView(data.buffer, data.byteOffset + offset, TTI_SIZE);
    const sgn =  view.getUint8(0);
    const sn =   view.getUint16(1, true);
    const ebn =  view.getUint8(3);
    const cs =   view.getUint8(4);
    const tciH = view.getUint8(5);
    const tciM = view.getUint8(6);
    const tciS = view.getUint8(7);
    const tciF = view.getUint8(8);
    const tcoH = view.getUint8(9);
    const tcoM = view.getUint8(10);
    const tcoS = view.getUint8(11);
    const tcoF = view.getUint8(12);
    const vp =   view.getUint8(13);
    const jc =   view.getUint8(14);
    const cf =   view.getUint8(15);
    const tf =   data.subarray(offset + 16, offset + 16 + TF_SIZE);
    return {
        sgn, sn, ebn, cs, vp, jc, cf, tf,
        tci: decodeTimecode(tciH, tciM, tciS, tciF, fps),
        tco: decodeTimecode(tcoH, tcoM, tcoS, tcoF, fps),
    };
}

// ---------------------------------------------------------------------------
// Detect
// ---------------------------------------------------------------------------

function detectSTL(data: Uint8Array): boolean {
    if (data.length < GSI_SIZE) return false;
    const dfc3 = String.fromCharCode(data[3], data[4], data[5]);
    if (dfc3 !== 'STL') return false;
    return true;
}

// ---------------------------------------------------------------------------
// Public format object
// ---------------------------------------------------------------------------

export const STLSubtitles = {
    detect(source: string | Uint8Array): boolean | null {
        if (typeof source === 'string') return false;
        return detectSTL(source) ? true : false;
    },

    parse(source: string | Uint8Array): STLParser {
        if (typeof source === 'string')
            throw new DeserializationError('STL parser requires binary data');
        return new STLParser(source);
    },
};

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

export class STLParser implements SubtitleParser {
    #language: string;
    #fps: number;
    #encoding: STLEncoding;
    #startTime: number;
    #ttis: TTIFields[];
    #isFab: boolean;
    #userDataBlocks = 0;
    #allWarnings: STLParseMessage[] = [];
    #cachedResult: { messages: STLParseMessage[], subs: Subtitles } | null = null;

    #shift1h = false;
    #canShift1h: boolean = false;

    constructor(source: Uint8Array) {
        const gsi = readGSI(source);
        this.#language = this.#languageFromLC(gsi.lc);
        this.#fps = gsi.fps;
        this.#encoding = gsi.encoding;
        this.#startTime = gsi.startTime;
        void Debug.debug(`STL: fps=${gsi.fps}, starttime=${gsi.startTime}, code page=${gsi.cpn}`);

        const expectedSize = GSI_SIZE + gsi.tnb * TTI_SIZE;
        if (source.length < expectedSize)
            throw new DeserializationError(
                `STL file too small: expected ${expectedSize} bytes, got ${source.length}`);

        this.#ttis = [];
        for (let i = 0; i < gsi.tnb; i++)
            this.#ttis.push(readTTI(source, GSI_SIZE + i * TTI_SIZE, this.#fps));

        this.#isFab = detectFAB(this.#ttis);
        if (this.#isFab) void Debug.debug('STL: FAB format detected');

        // evaluate canShift1h
        this.decode();
    }

    get canShift1h() {
        return this.#canShift1h;
    }

    get isShift1h() {
        return this.#shift1h;
    }

    shift1h(v: boolean) {
        if (v) Debug.assert(this.#canShift1h);
        this.#shift1h = v;
        this.#cachedResult = null;
        return this;
    }

    decode() {
        if (this.#cachedResult) return this.#cachedResult;

        let firstTimecode: number | null = null;
        const subs = new Subtitles();
        subs.migrated = 'text';
        subs.metadata.language = this.#language;

        const processor = new STLTextProcessor(this.#encoding);
        let currentStart: number | null = null;
        let currentEnd: number | null = null;
        let currentText: RichText[] = [];

        const finishEntry = () => {
            if (currentStart === null || currentEnd === null) return;
            const rt = RichText.concat(...currentText);
            if (RichText.length(rt) === 0) return;

            if (firstTimecode === null)
                firstTimecode = currentStart;

            if (this.#shift1h) {
                currentStart -= 3600;
                currentEnd -= 3600;
            }
            const entry = new SubtitleEntry(
                Math.max(0, currentStart),
                Math.max(0, currentEnd)
            );
            entry.texts.set(subs.defaultStyle, rt);
            subs.entries.push(entry);
        };

        for (const tti of this.#ttis) {
            if (tti.cf > 0) continue;

            if (this.#isFab && tti.ebn === 0xFE) {
                const isFirstOfGroup = currentStart === null;
                if (isFirstOfGroup) {
                    currentStart = tti.tci - this.#startTime;
                    currentEnd   = tti.tco - this.#startTime;
                    if (currentStart < 3600)
                        this.#canShift1h = false;
                }

                const fabText = decodeFABText(tti.tf);
                if (fabText !== null)
                    currentText.push(fabText);
                continue;
            }

            if (tti.ebn === 254) {
                if (this.#isFab) continue; // already handled above
                this.#userDataBlocks++;
                continue;
            }

            const isFirstOfGroup = currentStart === null;
            if (isFirstOfGroup) {
                currentStart = tti.tci - this.#startTime;
                currentEnd   = tti.tco - this.#startTime;
                if (currentStart < 3600)
                    this.#canShift1h = false;
            }

            if (this.#isFab && tti.ebn === 0xFF) {
                finishEntry();
                currentStart = null;
                currentEnd = null;
                currentText = [];
                continue;
            }

            const { richText, warnings } = processor.processTF(tti.tf);
            this.#allWarnings.push(...warnings);
            if (richText !== null) currentText.push(richText);

            if (tti.ebn === 0xFF) {
                finishEntry();
                currentStart = null;
                currentEnd = null;
                currentText = [];
            }
        }
        finishEntry();

        if (this.#userDataBlocks > 0) this.#allWarnings.unshift({
            type: 'user-data-block',
            category: 'unsupported',
            occurrence: this.#userDataBlocks
        });
        if (firstTimecode && firstTimecode > 3600) {
            this.#canShift1h = true;
            this.#allWarnings.unshift({
                type: 'timecode-starts-at-1h',
                category: 'info',
                start: firstTimecode
            });
        }

        this.#cachedResult = { messages: this.#allWarnings, subs };
        return this.#cachedResult;
    }

    static #LANG_MAP: Record<string, string> = {
        // European languages (Latin-based alphabets) — Appendix 3 Part 1
        '01': 'sq', // Albanian
        '02': 'br', // Breton
        '03': 'ca', // Catalan
        '04': 'hr', // Croatian
        '05': 'cy', // Welsh
        '06': 'cs', // Czech
        '07': 'da', // Danish
        '08': 'de', // German
        '09': 'en', // English
        '0A': 'es', // Spanish
        '0B': 'eo', // Esperanto
        '0C': 'et', // Estonian
        '0D': 'eu', // Basque
        '0E': 'fo', // Faroese
        '0F': 'fr', // French
        '10': 'fy', // Frisian
        '11': 'ga', // Irish
        '12': 'gd', // Gaelic
        '13': 'gl', // Galician
        '14': 'is', // Icelandic
        '15': 'it', // Italian
        '16': 'se', // Lappish
        '17': 'la', // Latin
        '18': 'lv', // Latvian
        '19': 'lb', // Luxembourgian
        '1A': 'lt', // Lithuanian
        '1B': 'hu', // Hungarian
        '1C': 'mt', // Maltese
        '1D': 'nl', // Dutch
        '1E': 'no', // Norwegian
        '1F': 'oc', // Occitan
        '20': 'pl', // Polish
        '21': 'pt', // Portuguese
        '22': 'ro', // Romanian
        '23': 'rm', // Romansh
        '24': 'sr', // Serbian
        '25': 'sk', // Slovak
        '26': 'sl', // Slovenian
        '27': 'fi', // Finnish
        '28': 'sv', // Swedish
        '29': 'tr', // Turkish
        '2A': 'nl', // Flemish → Dutch (no distinct BCP 47)
        '2B': 'wa', // Walloon
        // 2C–3F: Reserved
        // 40–44: Reserved
        // Other languages (non-Latin) — Appendix 3 Part 2
        '45': 'zu', // Zulu
        '46': 'vi', // Vietnamese
        '47': 'uz', // Uzbek
        '48': 'ur', // Urdu
        '49': 'uk', // Ukrainian
        '4A': 'th', // Thai
        '4B': 'te', // Telugu
        '4C': 'tt', // Tatar
        '4D': 'ta', // Tamil
        '4E': 'tg', // Tadzhik
        '4F': 'sw', // Swahili
        '50': 'srn', // Sranan Tongo
        '51': 'so', // Somali
        '52': 'si', // Sinhalese
        '53': 'sn', // Shona
        '54': 'sh', // Serbo-Croat
        '55': 'rue', // Ruthenian
        '56': 'ru', // Russian
        '57': 'qu', // Quechua
        '58': 'ps', // Pushtu
        '59': 'pa', // Punjabi
        '5A': 'fa', // Persian
        '5B': 'pap', // Papiamento
        '5C': 'or', // Oriya
        '5D': 'ne', // Nepali
        '5E': 'nd', // Ndebele
        '5F': 'mr', // Marathi
        '60': 'ro', // Moldavian → Romanian
        '61': 'ms', // Malaysian
        '62': 'mg', // Malagasy
        '63': 'mk', // Macedonian
        '64': 'lo', // Laotian
        '65': 'ko', // Korean
        '66': 'km', // Khmer
        '67': 'kk', // Kazakh
        '68': 'kn', // Kannada
        '69': 'ja', // Japanese
        '6A': 'id', // Indonesian
        '6B': 'hi', // Hindi
        '6C': 'he', // Hebrew
        '6D': 'ha', // Hausa
        '6E': 'gn', // Guarani
        '6F': 'gu', // Gujarati
        '70': 'el', // Greek
        '71': 'ka', // Georgian
        '72': 'ff', // Fulani
        '73': 'prs', // Dari
        '74': 'cv', // Chuvash
        '75': 'zh', // Chinese
        '76': 'my', // Burmese
        '77': 'bg', // Bulgarian
        '78': 'bn', // Bengali
        '79': 'be', // Bielorussian
        '7A': 'bm', // Bambara
        '7B': 'az', // Azerbaijani
        '7C': 'as', // Assamese
        '7D': 'hy', // Armenian
        '7E': 'ar', // Arabic
        '7F': 'am', // Amharic
    };

    #languageFromLC(lc: string): string {
        return STLParser.#LANG_MAP[lc] ?? '';
    }
}
