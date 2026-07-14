import { describe, it, expect } from 'vitest';
import { ISO6937Decoder } from '../lib/details/ISO6937';

describe('ISO6937Decoder', () => {
    it('should decode ASCII text correctly', () => {
        const decoder = new ISO6937Decoder();
        const input = new Uint8Array([0x48, 0x65, 0x6C, 0x6C, 0x6F]); // "Hello"
        expect(decoder.decode(input)).toBe('Hello');
    });

    it('should decode direct mappings', () => {
        const decoder = new ISO6937Decoder();
        // œ = 0xEF 0x6E → 0x0153 + 0x6E = no, 0xEF is direct mapping to 0x0149 (ŉ)
        // 0xD2 = ® (registered sign, 0x00AE)
        const input = new Uint8Array([0x41, 0xD2, 0x42]); // "A®B"
        expect(decoder.decode(input)).toBe('A\u00AEB');
    });

    it('should combine diacritics', () => {
        const decoder = new ISO6937Decoder();
        // 0xC2 = acute accent (combining 0x0301)
        // 0x65 = 'e'
        // Should produce 'é' (U+00E9)
        const input = new Uint8Array([0xC2, 0x65]); // acute + e = é
        expect(decoder.decode(input)).toBe('\u00E9');
    });

    it('should handle diaeresis (umlaut)', () => {
        const decoder = new ISO6937Decoder();
        // 0xC8 = diaeresis (0x0308) + 0x61 = 'a' → 'ä'
        const input = new Uint8Array([0xC8, 0x61]);
        expect(decoder.decode(input)).toBe('\u00E4');
    });

    it('should drop diacritic with no following character', () => {
        const decoder = new ISO6937Decoder();
        // 0xC1 = grave accent, but no following char → it's just dropped
        const input = new Uint8Array([0xC1]);
        expect(decoder.decode(input)).toBe('');
    });

    it('should handle diacritic followed by another diacritic', () => {
        const decoder = new ISO6937Decoder();
        // 0xC2 (acute) then 0xC1 (grave) then 0x65 (e)
        // First diacritic is combined with second diacritic byte as base → dropped
        // Then 0x65 (e) is output as-is
        const input = new Uint8Array([0xC2, 0xC1, 0x65]);
        expect(decoder.decode(input)).toBe('e');
    });

    it('should decode caf\u00E9 correctly', () => {
        const decoder = new ISO6937Decoder();
        // 'C' 'a' 'f' acute e = "Café"
        const input = new Uint8Array([0x43, 0x61, 0x66, 0xC2, 0x65]);
        expect(decoder.decode(input)).toBe('Caf\u00E9');
    });
});
