import { describe, it, expect } from "vitest";
import { decodePathname } from "../../src/utils/internal/path.ts";
import { HTTPError } from "../../src/error.ts";

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

  it("throws a 400 HTTPError on malformed input (no silent fallback)", () => {
    // Falling back to the raw, undecoded pathname would let routing/middleware
    // (e.g. auth) see a different pathname than intended. Reject instead.
    for (const p of ["/%", "/%C0%AF", "/foo%", "/%E0%A4%A"]) {
      let error: unknown;
      try {
        decodePathname(p);
      } catch (error_) {
        error = error_;
      }
      expect(HTTPError.isError(error), `expected HTTPError for ${p}`).toBe(true);
      expect((error as HTTPError).status).toBe(400);
    }
  });
});
