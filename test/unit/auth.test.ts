import { describe, it, expect } from "vitest";
import { timingSafeEqual } from "../../src/utils/internal/auth.ts";

describe("timingSafeEqual", () => {
  it("returns true for equal ASCII strings", () => {
    expect(timingSafeEqual("password", "password")).toBe(true);
    expect(timingSafeEqual("test:123!", "test:123!")).toBe(true);
  });

  it("returns false for different ASCII strings", () => {
    expect(timingSafeEqual("password", "Password")).toBe(false);
    expect(timingSafeEqual("abc", "abd")).toBe(false);
  });

  it("returns false for different length strings", () => {
    expect(timingSafeEqual("short", "longer")).toBe(false);
    expect(timingSafeEqual("abc", "ab")).toBe(false);
  });

  it("returns true for equal empty strings", () => {
    expect(timingSafeEqual("", "")).toBe(true);
  });

  it("returns false when comparing empty with non-empty", () => {
    expect(timingSafeEqual("", "a")).toBe(false);
    expect(timingSafeEqual("a", "")).toBe(false);
  });

  // UTF-8 / Unicode tests
  it("returns true for equal strings with multi-byte UTF-8 characters", () => {
    expect(timingSafeEqual("héllo", "héllo")).toBe(true);
    expect(timingSafeEqual("日本語", "日本語")).toBe(true);
  });

  it("returns false for different multi-byte UTF-8 characters", () => {
    expect(timingSafeEqual("héllo", "hello")).toBe(false);
    expect(timingSafeEqual("日本語", "中文字")).toBe(false);
  });

  // Emojis and characters outside BMP are represented as surrogate pairs in UTF-16,
  // but the implementation uses TextEncoder for proper UTF-8 byte comparison
  it("returns true for equal strings with emoji (surrogate pairs)", () => {
    expect(timingSafeEqual("pass😀word", "pass😀word")).toBe(true);
    expect(timingSafeEqual("🔐secret🔐", "🔐secret🔐")).toBe(true);
  });

  it("returns false for different emoji strings", () => {
    expect(timingSafeEqual("pass😀word", "pass😃word")).toBe(false);
    expect(timingSafeEqual("🔐secret", "🔑secret")).toBe(false);
  });

  // Unicode normalization: NFC (composed) vs NFD (decomposed) forms look identical
  // but have different byte sequences - this is expected behavior
  describe("Unicode normalization edge cases", () => {
    it("returns false for NFC vs NFD normalized strings (different byte sequences)", () => {
      // 'é' can be represented as:
      // - NFC (composed): U+00E9 (single code point)
      // - NFD (decomposed): U+0065 U+0301 ('e' + combining acute accent)
      const nfc = "caf\u00E9"; // café with composed é
      const nfd = "cafe\u0301"; // café with decomposed é (e + combining accent)

      // These strings look identical when rendered but have different UTF-8 bytes.
      // The implementation correctly identifies them as different.
      expect(timingSafeEqual(nfc, nfd)).toBe(false);

      // If visual equality is needed, normalize both strings first
      expect(timingSafeEqual(nfc.normalize("NFC"), nfd.normalize("NFC"))).toBe(true);
    });

    it("returns false for visually similar but different Unicode characters", () => {
      // Greek question mark (U+037E) vs semicolon (U+003B)
      // These look nearly identical in many fonts but are different bytes
      const semicolon = "test;value";
      const greekQuestionMark = "test\u037Evalue";

      expect(timingSafeEqual(semicolon, greekQuestionMark)).toBe(false);
    });

    it("returns false for strings with zero-width characters", () => {
      const normal = "password";
      const withZeroWidth = "pass\u200Bword"; // zero-width space

      // These look identical but have different byte sequences
      expect(timingSafeEqual(normal, withZeroWidth)).toBe(false);
    });
  });

  // Edge cases with the modulo operation when strings have different lengths
  describe("length-related edge cases", () => {
    it("returns false when one string is much longer", () => {
      const short = "ab";
      const long = "abcdefghij";

      expect(timingSafeEqual(short, long)).toBe(false);
    });

    it("handles the modulo wraparound correctly", () => {
      // The implementation uses (i % aLen) and (i % bLen) for constant-time comparison,
      // but length differences are tracked separately to ensure correct results
      expect(timingSafeEqual("ab", "abab")).toBe(false);
      expect(timingSafeEqual("abab", "ab")).toBe(false);
    });
  });

  // UTF-8 byte comparison tests - the implementation uses TextEncoder
  describe("UTF-8 byte comparison", () => {
    it("compares UTF-8 bytes, not UTF-16 code units", () => {
      // The implementation uses TextEncoder to convert strings to UTF-8 bytes
      // before comparison, ensuring proper Unicode handling.

      const encoder = new TextEncoder();

      // Example: 'é' (U+00E9) is 1 UTF-16 code unit but 2 UTF-8 bytes
      const e_acute = "é";
      expect(e_acute.length).toBe(1); // UTF-16 code units
      expect(encoder.encode(e_acute).length).toBe(2); // UTF-8 bytes

      // Example: '😀' (U+1F600) is 2 UTF-16 code units but 4 UTF-8 bytes
      const emoji = "😀";
      expect(emoji.length).toBe(2); // UTF-16 code units (surrogate pair)
      expect(encoder.encode(emoji).length).toBe(4); // UTF-8 bytes

      // Example: '日' (U+65E5) is 1 UTF-16 code unit but 3 UTF-8 bytes
      const kanji = "日";
      expect(kanji.length).toBe(1); // UTF-16 code units
      expect(encoder.encode(kanji).length).toBe(3); // UTF-8 bytes
    });

    it("handles unpaired surrogates by converting to replacement character", () => {
      // Unpaired surrogates are invalid UTF-8 but valid in JavaScript strings.
      // TextEncoder converts them to the UTF-8 replacement character (U+FFFD).

      const emoji = "😀"; // Two UTF-16 code units: \uD83D\uDE00

      const highSurrogate = emoji.charCodeAt(0);
      const lowSurrogate = emoji.charCodeAt(1);

      expect(highSurrogate).toBe(0xd8_3d);
      expect(lowSurrogate).toBe(0xde_00);

      // Create strings with unpaired surrogates
      const invalidStr1 = String.fromCharCode(0xd8_3d); // lone high surrogate
      const invalidStr2 = String.fromCharCode(0xd8_3d); // same

      // Same unpaired surrogates are equal (both become same replacement char)
      expect(timingSafeEqual(invalidStr1, invalidStr2)).toBe(true);

      // Verify they encode to the UTF-8 replacement character
      const encoder = new TextEncoder();
      const bytes1 = encoder.encode(invalidStr1);
      const bytes2 = encoder.encode(invalidStr2);

      expect([...bytes1]).toEqual([0xef, 0xbf, 0xbd]);
      expect([...bytes2]).toEqual([0xef, 0xbf, 0xbd]);
    });

    it("different invalid surrogates are equal in UTF-8 (both become replacement char)", () => {
      // Two different unpaired surrogates both encode to the same
      // UTF-8 replacement character, so they should be equal.

      const encoder = new TextEncoder();

      const loneHigh1 = String.fromCharCode(0xd8_3d); // lone high surrogate
      const loneHigh2 = String.fromCharCode(0xd8_3e); // different lone high surrogate

      // As UTF-8, they're the same (both become replacement character)
      const bytes1 = encoder.encode(loneHigh1);
      const bytes2 = encoder.encode(loneHigh2);

      expect([...bytes1]).toEqual([0xef, 0xbf, 0xbd]);
      expect([...bytes2]).toEqual([0xef, 0xbf, 0xbd]);

      // With UTF-8 safe implementation, these are correctly identified as equal
      expect(timingSafeEqual(loneHigh1, loneHigh2)).toBe(true);
    });
  });
});
