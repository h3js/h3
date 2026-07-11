import { describe, it, expect } from "vitest";
import { ignoredHeaders, ignoredResponseHeaders } from "../../src/utils/internal/proxy.ts";

describe("proxy internal header sets", () => {
  it("does not strip the incoming accept header but keeps accept-encoding", () => {
    expect(ignoredHeaders.has("accept")).toBe(false);
    expect(ignoredHeaders.has("accept-encoding")).toBe(true);
  });

  it("strips hop-by-hop and length/encoding response headers", () => {
    for (const key of [
      "content-encoding",
      "content-length",
      "transfer-encoding",
      "connection",
      "keep-alive",
      "proxy-authenticate",
      "proxy-connection",
      "upgrade",
      "trailer",
      "te",
    ]) {
      expect(ignoredResponseHeaders.has(key)).toBe(true);
    }
  });
});
