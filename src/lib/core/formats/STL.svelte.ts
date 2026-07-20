// Mostly written by DeepSeek 4

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

// STL control bytes
const CTRL_ITALIC_ON  = 0x80;
const CTRL_ITALIC_OFF = 0x81;
const CTRL_UL_ON      = 0x82;
const CTRL_UL_OFF     = 0x83;
const CTRL_BOLD_ON    = 0x0E;
const CTRL_BOLD_OFF   = 0x0C;
const CTRL_LINE_BREAK = 0x8A;
const CTRL_END_OF_TEXT = 0x8F;

const COLOR_CODES = new Set<number>(
    Array.from({ length: 8 }, (_, i) => i)
        .concat(Array.from({ length: 8 }, (_, i) => 0x10 + i))
);

const KNOWN_CONTROL_BYTES = new Set([
    CTRL_ITALIC_ON, CTRL_ITALIC_OFF,
    CTRL_UL_ON, CTRL_UL_OFF,
    CTRL_BOLD_ON, CTRL_BOLD_OFF,
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
// The text is UTF-16LE encoded and structured as:
//   "FABst" [04] [subnum_hi] [subnum_lo] [00] [data_len] [04] [UTF-16LE text] [trailing_byte]

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
    if (tf.length < 10) return null;
    if (tf[0] !== 0x46 || tf[1] !== 0x41 || tf[2] !== 0x42 || tf[3] !== 0x73 || tf[4] !== 0x74)
        return null;

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
        this.setBold(false);
        this.setItalic(false);
        this.setUnderline(false);

        let colorWarnings = 0;
        let unknownCtrl: Map<number, number> | null = null;

        for (let i = 0; i < tf.length; i++) {
            const byte = tf[i];

            if (byte === CTRL_END_OF_TEXT) break;

            if (COLOR_CODES.has(byte)) {
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
            if (byte === CTRL_BOLD_ON)    { this.#flushText(); this.setBold(true);  continue; }
            if (byte === CTRL_BOLD_OFF)   { this.#flushText(); this.setBold(false); continue; }

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
// BCD timestamp decoding (for GSI TCP field)
// ---------------------------------------------------------------------------

function decodeBCDTimecode(data: Uint8Array, fps: number): number {
    if (data.length !== 8) return 0;
    const chars = Array.from(data, (b) => String.fromCharCode(b)).join('');
    if (chars === '________') return 0;

    const masks = [0x02, 0x0F, 0x07, 0x0F, 0x07, 0x0F, 0x03, 0x0F];
    const multipliers = [36000, 3600, 600, 60, 10, 1, 10.0 / fps, 1.0 / fps];

    let result = 0;
    for (let i = 0; i < 8; i++) {
        const v = data[i] & masks[i];
        result += v * multipliers[i];
    }
    return result;
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
        ? decodeBCDTimecode(data.subarray(GSI_TCP, GSI_TCP + 8), fps) : 0;

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
    const cpn = String.fromCharCode(data[0], data[1], data[2]);
    if (cpn !== '850') return false;
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

    #languageFromLC(lc: string): string {
        switch (lc) {
            case '01': return 'sq';
            case '02': return 'bs';
            case '03': return 'bg';
            case '04': return 'zh';
            case '05': return 'hr';
            case '06': return 'cs';
            case '07': return 'da';
            case '08': return 'nl';
            case '09': return 'en';
            case '10': return 'et';
            case '11': return 'fi';
            case '12': return 'fr';
            case '13': return 'de';
            case '14': return 'el';
            case '15': return 'iw';
            case '16': return 'hu';
            case '17': return 'is';
            case '18': return 'ga';
            case '19': return 'it';
            case '20': return 'ja';
            case '21': return 'ko';
            case '22': return 'lv';
            case '23': return 'lt';
            case '24': return 'mk';
            case '25': return 'mt';
            case '26': return 'cnr';
            case '27': return 'no';
            case '28': return 'pl';
            case '29': return 'pt';
            case '30': return 'ro';
            case '32': return 'sr';
            case '33': return 'sk';
            case '34': return 'sl';
            case '35': return 'es';
            case '36': return 'sv';
            case '37': return 'tr';
            case '38': return 'uk';
            case '75': return 'zh';
            default:  return '';
        }
    }
}
