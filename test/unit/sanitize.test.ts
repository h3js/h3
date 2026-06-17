import { describe, it, expect } from "vitest";
import { sanitizeStatusCode, HTTPError } from "../../src/index.ts";

describe("sanitizeStatusCode", () => {
  it("passes through valid codes", () => {
    expect(sanitizeStatusCode(404)).toBe(404);
    expect(sanitizeStatusCode("404")).toBe(404);
  });

  it("falls back to the default for out-of-range codes", () => {
    expect(sanitizeStatusCode(700)).toBe(200);
    expect(sanitizeStatusCode(99, 500)).toBe(500);
  });

  it("falls back to the default for non-numeric strings", () => {
    // regression: "+abc" is NaN, and NaN<100 / NaN>599 are both false,
    // so the range guard let NaN through as a "sanitized" status code.
    expect(sanitizeStatusCode("abc")).toBe(200);
    expect(sanitizeStatusCode("2xx", 500)).toBe(500);
  });
});

describe("HTTPError status from a non-numeric cause", () => {
  it("does not produce a NaN status when cause.statusCode is non-numeric", () => {
    const cause = Object.assign(new Error("boom"), { statusCode: "ECONNREFUSED" });
    const err = new HTTPError({ cause });
    expect(err.status).toBe(500);
  });
});
