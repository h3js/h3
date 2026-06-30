import { describe, it, expect } from "vitest";
import { sanitizeStatusCode } from "../src/utils/sanitize";

describe("sanitizeStatusCode", () => {
  it("returns valid status codes unchanged", () => {
    expect(sanitizeStatusCode(200)).toBe(200);
    expect(sanitizeStatusCode(404)).toBe(404);
    expect(sanitizeStatusCode("301")).toBe(301);
  });

  it("returns the default for missing or out-of-range input", () => {
    expect(sanitizeStatusCode(undefined)).toBe(200);
    expect(sanitizeStatusCode(0)).toBe(200);
    expect(sanitizeStatusCode(99)).toBe(200);
    expect(sanitizeStatusCode(1000)).toBe(200);
    expect(sanitizeStatusCode(99, 500)).toBe(500);
  });

  it("returns the default for non-numeric strings instead of NaN", () => {
    // `Number.parseInt("abc", 10)` is NaN and NaN passes the range check, so
    // the function used to return NaN here, which breaks downstream consumers
    // (e.g. setting `res.statusCode` or building a `Response`).
    expect(sanitizeStatusCode("abc")).toBe(200);
    expect(sanitizeStatusCode("abc", 500)).toBe(500);
  });
});
