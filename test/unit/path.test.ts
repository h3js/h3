import { describe, it, expect } from "vitest";
import { decodePathname } from "../../src/utils/internal/path.ts";

describe("decodePathname", () => {
  it("decodes valid percent-encoding", () => {
    expect(decodePathname("/caf%C3%A9")).toBe("/café");
  });

  it("preserves encoded %25 (does not double-decode)", () => {
    // %25 (encoded "%") is intentionally preserved so that e.g. %2561 stays
    // %2561 rather than decoding twice into "a". See security.test.ts.
    expect(decodePathname("/100%25")).toBe("/100%25");
    expect(decodePathname("/api/%2561dmin")).toBe("/api/%2561dmin");
  });

  it("does not throw on malformed input, returns it unchanged", () => {
    for (const p of ["/%", "/%C0%AF", "/foo%", "/%E0%A4%A"]) {
      expect(() => decodePathname(p)).not.toThrow();
      expect(decodePathname(p)).toBe(p);
    }
  });
});
