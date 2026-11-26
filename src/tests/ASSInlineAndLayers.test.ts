import { describe, it, expect, vi } from 'vitest';

vi.mock('@tauri-apps/api', () => ({
    path: {
        sep: () => '/',
        appConfigDir: () => Promise.resolve('/tmp/subtle-test'),
    },
}));

vi.mock('@tauri-apps/api/app', () => ({
    getVersion: () => Promise.resolve('0.0.0-test'),
}));

vi.mock('@tauri-apps/plugin-os', () => ({
    type: () => 'macos',
    platform: () => 'macos',
    arch: () => 'aarch64',
    version: () => '15.0.0',
}));

vi.mock('@tauri-apps/plugin-fs', () => ({
    exists: () => Promise.resolve(true),
    mkdir: () => Promise.resolve(),
}));

vi.mock('@tauri-apps/plugin-log', () => ({
    trace: () => Promise.resolve(),
    debug: () => Promise.resolve(),
    info: () => Promise.resolve(),
    warn: () => Promise.resolve(),
    error: () => Promise.resolve(),
}));

vi.mock('@tauri-apps/plugin-dialog', () => ({
    message: () => Promise.resolve(),
}));

import { ASSParser, ASSWriter } from '../lib/core/formats/ASS.svelte';
import { ASSString } from '../lib/core/formats/ASSString';
import { JSONSubtitles } from '../lib/core/JSON.svelte';
import { HTMLString } from '../lib/core/formats/SRT_HTML';
import { RichText } from '../lib/core/RichText';
import { SubtitleEntry } from '../lib/core/Subtitles.svelte';
import { WrapStyle } from '../lib/details/TextLayout';
import { fromRichText, toRichText } from '../lib/component/richedit/Schema';

describe('ASS inline style overrides (\\r, \\rStyleName, \\fn)', () => {
    const INLINE_STYLE_SAMPLE = `[Script Info]
ScriptType: v4.00+
WrapStyle: 2
PlayResX: 1920
PlayResY: 1080

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColor, SecondaryColour, OutlineColor, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: ZH_HOST,GenRyuMin2 TW,72,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,3.8,0,2,80,80,142,1
Style: ZH_HOST_LATIN,Times New Roman,72,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,3.8,0,2,80,80,142,1
Style: ZH_CLIP,GenRyuMin2 TW,72,&H0099F0B3,&H000000FF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,3.8,0,2,80,80,142,1
Style: ZH_CLIP_LATIN,Times New Roman,72,&H0099F0B3,&H000000FF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,3.8,0,2,80,80,142,1
Style: ZH_NOTE,GenRyuMin2 TW,42,&H00FFFFFF,&H000000FF,&H00393939,&H00000000,-1,0,0,0,100,100,0,0,1,2.5,0,2,80,80,24,1
Style: ZH_NOTE_LATIN,Times New Roman,42,&H00FFFFFF,&H000000FF,&H00393939,&H00000000,-1,0,0,0,100,100,0,0,1,2.5,0,2,80,80,24,1
Style: EMPHASIS,Georgia,90,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,-1,-1,-1,0,100,100,0,0,1,3.8,0,2,80,80,142,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 1,0:00:27.87,0:00:31.15,ZH_HOST,,0,0,0,,曾是个百无聊赖的摩门教主妇 {\\rZH_HOST_LATIN}2003{\\r}年{\\rZH_HOST_LATIN}6{\\r}月{\\rZH_HOST_LATIN}2{\\r}日
Dialogue: 1,0:01:46.86,0:01:48.06,ZH_CLIP,,0,0,0,,我代表{\\rZH_CLIP_LATIN}ABC{\\r}新闻全体同仁
Dialogue: 2,0:08:51.29,0:08:56.45,ZH_NOTE,,0,0,0,,{\\rZH_NOTE_LATIN}[CinemaSins]:{\\r} 美国知名影评频道
Dialogue: 1,0:09:00.00,0:09:02.00,ZH_HOST,,0,0,0,,前段{\\rEMPHASIS}重点{\\r}后段
`;

    it('parses \\r<StyleName> and \\r without warnings and applies font/size/style diffs', () => {
        const { subs, messages } = new ASSParser(INLINE_STYLE_SAMPLE).decode();

        expect(messages).toEqual([]);
        const byName = new Map(subs.styles.map((s) => [s.name, s]));
        const zhHost = byName.get('ZH_HOST')!;
        const zhClip = byName.get('ZH_CLIP')!;
        const zhNote = byName.get('ZH_NOTE')!;

        expect(subs.entries[0].texts.get(zhHost)).toEqual([
            '曾是个百无聊赖的摩门教主妇 ',
            { type: 'leaf', content: '2003', attrs: [{ type: 'font', value: 'Times New Roman' }] },
            '年',
            { type: 'leaf', content: '6', attrs: [{ type: 'font', value: 'Times New Roman' }] },
            '月',
            { type: 'leaf', content: '2', attrs: [{ type: 'font', value: 'Times New Roman' }] },
            '日',
        ]);

        expect(subs.entries[1].texts.get(zhClip)).toEqual([
            '我代表',
            { type: 'leaf', content: 'ABC', attrs: [{ type: 'font', value: 'Times New Roman' }] },
            '新闻全体同仁',
        ]);

        expect(subs.entries[2].texts.get(zhNote)).toEqual([
            { type: 'leaf', content: '[CinemaSins]:', attrs: [{ type: 'font', value: 'Times New Roman' }] },
            ' 美国知名影评频道',
        ]);

        expect(subs.entries[3].texts.get(zhHost)).toEqual([
            '前段',
            {
                type: 'leaf',
                content: '重点',
                attrs: [
                    'italic',
                    'underline',
                    { type: 'size', value: 90 / 72 },
                    { type: 'font', value: 'Georgia' },
                ],
            },
            '后段',
        ]);
    });

    it('reports unsupported-override-tag for unknown \\r<StyleName>', () => {
        const sample = `[Script Info]
ScriptType: v4.00+

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColor, SecondaryColour, OutlineColor, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: ZH_HOST,GenRyuMin2 TW,72,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,3.8,0,2,80,80,142,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:01.00,0:00:02.00,ZH_HOST,,0,0,0,,测试{\\rMISSING_STYLE}文本{\\r}
`;
        const { messages } = new ASSParser(sample).decode();
        expect(messages).toEqual([
            {
                category: 'unsupported',
                type: 'unsupported-override-tag',
                name: '\\rMISSING_STYLE',
                occurrence: 1,
            },
        ]);
    });

    it('round-trips inline font overrides via ASSString, ProseMirror Schema, and SRT_HTML', () => {
        const { subs } = new ASSParser(INLINE_STYLE_SAMPLE).decode();
        const zhHost = subs.styles.find((s) => s.name === 'ZH_HOST')!;
        const original = subs.entries[0].texts.get(zhHost)!;

        const serialized = ASSString.serialize(original, zhHost, { defaultWrapStyle: zhHost.wrapStyle });
        expect(serialized).toBe(
            '曾是个百无聊赖的摩门教主妇 {\\fnTimes New Roman}2003{\\fn}年{\\fnTimes New Roman}6{\\fn}月{\\fnTimes New Roman}2{\\fn}日'
        );
        const reparsedWarnings = {
            ignoredTags: new Map<string, number>(),
            ignoredDrawing: 0,
            ignoredSpecialCharacter: new Map<string, number>(),
        };
        const reparsed = ASSString.parse(serialized, zhHost, reparsedWarnings).result;
        expect(reparsedWarnings.ignoredTags.size).toBe(0);
        expect(RichText.equals(reparsed, original)).toBe(true);

        const doc = fromRichText(original);
        expect(RichText.equals(toRichText(doc), original)).toBe(true);

        const html = HTMLString.serialize(original);
        expect(html).toBe(
            '曾是个百无聊赖的摩门教主妇 <font face="Times New Roman">2003</font>年<font face="Times New Roman">6</font>月<font face="Times New Roman">2</font>日'
        );
        const htmlWarnings = {
            ignoredTags: new Map<string, number>(),
            invalidColor: 0,
            ignoredSpecialCharacter: new Map<string, number>(),
        };
        const fromHtml = HTMLString.parse(html, zhHost, htmlWarnings);
        expect(htmlWarnings.ignoredTags.size).toBe(0);
        expect(RichText.equals(fromHtml, original)).toBe(true);
    });

    it('exports matching inline overrides back to \\r<StyleName> and \\r via ASSWriter', () => {
        const { subs } = new ASSParser(INLINE_STYLE_SAMPLE).decode();
        const exported = new ASSWriter(subs).toString();

        expect(exported).toContain('WrapStyle: 2');
        expect(exported).not.toContain('{\\q2}');
        expect(exported).toContain(
            'Dialogue: 1,00:00:27.87,00:00:31.15,ZH_HOST,,0,0,0,,曾是个百无聊赖的摩门教主妇 {\\rZH_HOST_LATIN}2003{\\r}年{\\rZH_HOST_LATIN}6{\\r}月{\\rZH_HOST_LATIN}2{\\r}日'
        );
        expect(exported).toContain(
            'Dialogue: 1,00:01:46.86,00:01:48.06,ZH_CLIP,,0,0,0,,我代表{\\rZH_CLIP_LATIN}ABC{\\r}新闻全体同仁'
        );
        expect(exported).toContain(
            'Dialogue: 2,00:08:51.29,00:08:56.45,ZH_NOTE,,0,0,0,,{\\rZH_NOTE_LATIN}[CinemaSins]:{\\r} 美国知名影评频道'
        );
        expect(exported).toContain(
            'Dialogue: 1,00:09:00.00,00:09:02.00,ZH_HOST,,0,0,0,,前段{\\rEMPHASIS}重点{\\r}后段'
        );

        const reparsed = new ASSParser(exported).decode();
        expect(reparsed.messages).toEqual([]);
    });
});

describe('ASS WrapStyle, Layer, and YCbCr Matrix round-trip', () => {
    it('preserves WrapStyle: 2, YCbCr Matrix: TV.709, and per-channel Layer 0/1/2 across ASS and JSON round-trips', () => {
        const sample = `[Script Info]
ScriptType: v4.00+
WrapStyle: 2
YCbCr Matrix: TV.709
PlayResX: 1920
PlayResY: 1080

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColor, SecondaryColour, OutlineColor, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: EN_HOST,Arial,51,&H00FFFFFF,&H000000FF,&H00000000,&HFF000000,0,0,0,0,100,100,0,0,1,3.6,0,2,135,135,83,1
Style: ZH_HOST,GenRyuMin2 TW,72,&H00FFFFFF,&H000000FF,&H00000000,&HFF000000,-1,0,0,0,100,100,0,0,1,3.8,0,2,135,135,142,1
Style: ZH_NOTE,GenRyuMin2 TW,42,&H00FFFFFF,&H000000FF,&H00393939,&HFF000000,-1,0,0,0,100,100,0,0,1,2.5,0,2,135,135,24,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.08,0:00:02.64,EN_HOST,,0,0,0,,Hello
Dialogue: 1,0:00:00.08,0:00:02.64,ZH_HOST,,0,0,0,,你好
Dialogue: 2,0:00:00.08,0:00:02.64,ZH_NOTE,,0,0,0,,注释
`;
        const { subs, messages } = new ASSParser(sample).decode();
        expect(messages).toEqual([]);
        expect(subs.metadata.ycbcrMatrix).toBe('TV.709');
        expect(subs.styles.every((s) => s.wrapStyle === WrapStyle.NoWrap)).toBe(true);
        const byName = new Map(subs.styles.map((s) => [s.name, s]));
        expect(byName.get('EN_HOST')!.defaultLayer).toBe(0);
        expect(byName.get('ZH_HOST')!.defaultLayer).toBe(1);
        expect(byName.get('ZH_NOTE')!.defaultLayer).toBe(2);
        expect(subs.entries.map((e) => e.getLayer([...e.texts.keys()][0]))).toEqual([0, 1, 2]);

        const combined = new SubtitleEntry(3, 5);
        combined.texts.set(byName.get('ZH_HOST')!, '爱德华派！');
        combined.texts.set(byName.get('EN_HOST')!, 'Team Edward');
        subs.entries.push(combined);

        const exportedASS = new ASSWriter(subs).toString();
        expect(exportedASS).toContain('YCbCr Matrix: TV.709');
        expect(exportedASS).toContain('WrapStyle: 2');
        expect(exportedASS).not.toContain('{\\q2}');
        expect(exportedASS).toContain('Dialogue: 0,00:00:00.08,00:00:02.64,EN_HOST,,0,0,0,,Hello');
        expect(exportedASS).toContain('Dialogue: 1,00:00:00.08,00:00:02.64,ZH_HOST,,0,0,0,,你好');
        expect(exportedASS).toContain('Dialogue: 2,00:00:00.08,00:00:02.64,ZH_NOTE,,0,0,0,,注释');
        expect(exportedASS).toContain('Dialogue: 1,00:00:03.00,00:00:05.00,ZH_HOST,,0,0,0,,爱德华派！');
        expect(exportedASS).toContain('Dialogue: 0,00:00:03.00,00:00:05.00,EN_HOST,,0,0,0,,Team Edward');

        const savedJSON = JSONSubtitles.write(subs).toString();
        const loaded = JSONSubtitles.parse(savedJSON).decode();
        expect(loaded.subs.metadata.ycbcrMatrix).toBe('TV.709');
        expect(loaded.subs.styles.every((s) => s.wrapStyle === WrapStyle.NoWrap)).toBe(true);
        const loadedByName = new Map(loaded.subs.styles.map((s) => [s.name, s]));
        expect(loadedByName.get('ZH_HOST')!.defaultLayer).toBe(1);
        expect(loaded.subs.entries.slice(0, 3).map((e) => e.getLayer([...e.texts.keys()][0]))).toEqual([0, 1, 2]);
        expect(loaded.subs.entries[3].getLayer(loadedByName.get('ZH_HOST')!)).toBe(1);
        expect(loaded.subs.entries[3].getLayer(loadedByName.get('EN_HOST')!)).toBe(0);
    });

    it('defaults missing YCbCr Matrix to None and missing Layer in legacy JSON to 0', () => {
        const sample = `[Script Info]
ScriptType: v4.00+
YCbCr Matrix: TV.709

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColor, SecondaryColour, OutlineColor, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: MAIN,Arial,48,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,2,0,2,80,80,50,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 2,0:00:01.00,0:00:02.00,MAIN,,0,0,0,,Hello
`;
        const { subs } = new ASSParser(sample).decode();
        expect(subs.metadata.ycbcrMatrix).toBe('TV.709');
        expect(subs.entries[0].getLayer(subs.styles[0])).toBe(2);

        const saved = JSON.parse(JSONSubtitles.write(subs).toString());
        delete saved.metadata.ycbcrMatrix;
        for (const style of saved.styles) delete style.defaultLayer;
        for (const entry of saved.entries) {
            delete entry.layer;
            delete entry.layers;
        }

        const loaded = JSONSubtitles.parse(JSON.stringify(saved)).decode();
        expect(loaded.subs.metadata.ycbcrMatrix).toBe('None');
        expect(loaded.subs.entries[0].getLayer(loaded.subs.styles[0])).toBe(0);
    });
});
