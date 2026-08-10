import { describe, it, expect } from "vitest";
import {
  base64Encode,
  base64Decode,
  validateBinaryLike,
} from "../../src/utils/internal/encoding.ts";

describe("encoding utilities", () => {
  describe("base64Encode", () => {
    it("should encode a string to base64url", () => {
      const input = "hello world";
      const expected = "aGVsbG8gd29ybGQ";
      expect(base64Encode(input)).toBe(expected);
    });

    it("should encode a Uint8Array to base64url", () => {
      const input = new Uint8Array([104, 101, 108, 108, 111]);
      const expected = "aGVsbG8";
      expect(base64Encode(input)).toBe(expected);
    });

    it("should encode an ArrayBuffer to base64url", () => {
      const input = new Uint8Array([104, 101, 108, 108, 111]).buffer;
      const expected = "aGVsbG8";
      expect(base64Encode(input)).toBe(expected);
    });
  });

  describe("base64Decode", () => {
    it("should decode a base64url string to Uint8Array", () => {
      const input = "aGVsbG8gd29ybGQ";
      const expected = new Uint8Array([104, 101, 108, 108, 111, 32, 119, 111, 114, 108, 100]);
      expect(base64Decode(input)).toEqual(expected);
    });

    it("should handle padding-less base64url strings", () => {
      const input = "aGVsbG8";
      const expected = new Uint8Array([104, 101, 108, 108, 111]);
      expect(base64Decode(input)).toEqual(expected);
    });
  });

  // Runtimes without a global `Buffer` (Deno, service-worker and browser
  // entries) take the hand-rolled fallback branch of these helpers, which the
  // tests above never reach on Node. `Buffer` is swapped out synchronously so
  // no `await` ever runs while the global is missing.
  describe("without a global Buffer", () => {
    function withoutBuffer<T>(fn: () => T): T {
      const realBuffer = globalThis.Buffer;
      (globalThis as { Buffer?: unknown }).Buffer = undefined;
      try {
        return fn();
      } finally {
        (globalThis as { Buffer?: unknown }).Buffer = realBuffer;
      }
    }

    it("agrees with the Buffer implementation for every input length", () => {
      // Covers all three tail cases of the 3-byte encoding loop.
      for (let length = 0; length <= 32; length++) {
        const input = Uint8Array.from({ length }, (_, i) => (i * 37) % 256);
        expect(withoutBuffer(() => base64Encode(input))).toBe(base64Encode(input));
      }
    });

    it("encodes payloads larger than the engine argument limit", () => {
      // A session sealed by `sealSession` is base64-encoded whole, and the
      // sizes h3 itself allows go well past the argument limit that a
      // `String.fromCharCode(...codes)` encoder overflows on (a chunked session
      // cookie may hold ~400KB, and header sessions are uncapped).
      const input = Uint8Array.from({ length: 128 * 1024 }, (_, i) => i % 256);
      const encoded = withoutBuffer(() => base64Encode(input));
      expect(encoded).toBe(base64Encode(input));
      expect(withoutBuffer(() => base64Decode(encoded))).toEqual(input);
    });

    it("decodes base64url produced by the Buffer implementation", () => {
      // The fixture has to be built while `Buffer` is still around, otherwise
      // this only round-trips the fallback against itself. These bytes encode
      // to `----AAEC`, so the base64url substitutions are covered.
      const input = new Uint8Array([251, 239, 190, 0, 1, 2]);
      const encoded = base64Encode(input);
      expect(withoutBuffer(() => base64Decode(encoded))).toEqual(input);
    });
  });

  describe("validateBinaryLike", () => {
    it("should convert a string to Uint8Array", () => {
      const input = "hello";
      const expected = new Uint8Array([104, 101, 108, 108, 111]);
      expect(validateBinaryLike(input)).toEqual(expected);
    });

    it("should return the same Uint8Array if input is already Uint8Array", () => {
      const input = new Uint8Array([104, 101, 108, 108, 111]);
      expect(validateBinaryLike(input)).toBe(input);
    });

    it("should convert an ArrayBuffer to Uint8Array", () => {
      const input = new Uint8Array([104, 101, 108, 108, 111]).buffer;
      const expected = new Uint8Array([104, 101, 108, 108, 111]);
      expect(validateBinaryLike(input)).toEqual(expected);
    });

    it("should throw an error for invalid input types", () => {
      expect(() => validateBinaryLike(123)).toThrow(
        "The input must be a Uint8Array, a string, or an ArrayBuffer.",
      );
    });
  });
});
