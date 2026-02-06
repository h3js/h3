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
