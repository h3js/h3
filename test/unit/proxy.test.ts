import { describe, it, expect } from "vitest";
import {
  ignoredHeaders,
  ignoredResponseHeaders,
  rewriteCookieProperty,
} from "../../src/utils/internal/proxy.ts";

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

  it("drops hop-by-hop request credentials/controls by default", () => {
    expect(ignoredHeaders.has("proxy-authorization")).toBe(true);
    expect(ignoredHeaders.has("proxy-connection")).toBe(true);
  });
});

describe("rewriteCookieProperty", () => {
  it("applies own exact and wildcard mappings", () => {
    expect(
      rewriteCookieProperty(
        "foo=bar; Domain=old.example",
        { "old.example": "new.example" },
        "domain",
      ),
    ).toBe("foo=bar; Domain=new.example");
    expect(
      rewriteCookieProperty("foo=bar; Domain=any.example", { "*": "new.example" }, "domain"),
    ).toBe("foo=bar; Domain=new.example");
  });

  it("ignores inherited (prototype-polluted) map properties", () => {
    // Simulate prototype pollution without mutating the global prototype: the
    // mappings live on `map`'s prototype, so they are inherited, not own.
    const map = Object.create({ "old.example": "evil.example", "*": "evil.example" });
    const cookie = "foo=bar; Domain=old.example; Path=/";
    expect(rewriteCookieProperty(cookie, map, "domain")).toBe(cookie);
  });
});
