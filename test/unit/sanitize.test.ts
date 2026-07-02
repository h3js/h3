import { describe, it, expect } from "vitest";
import { sanitizeStatusCode, sanitizeStatusMessage } from "../../src/utils/sanitize.ts";

describe("sanitizeStatusCode", () => {
  it("returns valid status codes unchanged", () => {
    expect(sanitizeStatusCode(200)).toBe(200);
    expect(sanitizeStatusCode(404)).toBe(404);
    expect(sanitizeStatusCode(599)).toBe(599);
    expect(sanitizeStatusCode("301")).toBe(301);
  });

  it("returns the default for out-of-range codes", () => {
    expect(sanitizeStatusCode(99)).toBe(200);
    expect(sanitizeStatusCode(600)).toBe(200);
    expect(sanitizeStatusCode(99, 500)).toBe(500);
  });

  it("returns the default for missing input", () => {
    expect(sanitizeStatusCode(undefined)).toBe(200);
    expect(sanitizeStatusCode("")).toBe(200);
    expect(sanitizeStatusCode(0)).toBe(200);
    expect(sanitizeStatusCode(undefined, 404)).toBe(404);
  });

  it("returns the default for non-numeric strings (never NaN)", () => {
    // Regression: `+"abc"` is NaN and NaN passes the range check, so the
    // function used to return NaN — which then throws `RangeError` when used
    // to construct a `Response`.
    expect(sanitizeStatusCode("abc")).toBe(200);
    expect(sanitizeStatusCode("12x")).toBe(200);
    expect(sanitizeStatusCode("abc", 500)).toBe(500);
    expect(sanitizeStatusCode(Number.NaN)).toBe(200);
  });
});

describe("sanitizeStatusMessage", () => {
  it("strips disallowed characters", () => {
    expect(sanitizeStatusMessage("OK")).toBe("OK");
    expect(sanitizeStatusMessage("Not\nFound")).toBe("NotFound");
  });
});
