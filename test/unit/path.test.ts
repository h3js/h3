import { describe, it, expect } from "vitest";
import { resolveDotSegments } from "../../src/utils/path.ts";

describe("resolveDotSegments", () => {
  it("leaves a plain path untouched", () => {
    expect(resolveDotSegments("/app/admin/panel")).toBe("/app/admin/panel");
  });

  it("resolves literal dot segments", () => {
    expect(resolveDotSegments("/a/./b")).toBe("/a/b");
    expect(resolveDotSegments("/a/b/../c")).toBe("/a/c");
  });

  it("never escapes above the root", () => {
    expect(resolveDotSegments("/a/../../b")).toBe("/b");
    expect(resolveDotSegments("/../../etc/passwd")).toBe("/etc/passwd");
  });

  it("decodes percent-encoded dot segments", () => {
    expect(resolveDotSegments("/api/orders/%2e%2e/admin")).toBe("/api/admin");
    expect(resolveDotSegments("/api/orders/%2E%2E/admin")).toBe("/api/admin");
  });

  it("normalizes backslashes to forward slashes", () => {
    expect(resolveDotSegments("/a\\..\\b")).toBe("/b");
  });

  it("keeps encoded path separators opaque by default", () => {
    // %2f/%5c must not be treated as `/` unless explicitly opted in — decoding
    // them here would change segment count, i.e. which route matches.
    expect(resolveDotSegments("/admin%2f..%2fsecret")).toBe("/admin%2f..%2fsecret");
    expect(resolveDotSegments("/files/a%2fb")).toBe("/files/a%2fb");
  });

  it("decodes encoded path separators when decodeSlashes is enabled", () => {
    expect(resolveDotSegments("/app/admin%2fpanel", { decodeSlashes: true })).toBe(
      "/app/admin/panel",
    );
    expect(resolveDotSegments("/app/admin%2Fpanel", { decodeSlashes: true })).toBe(
      "/app/admin/panel",
    );
    expect(resolveDotSegments("/app/admin%5cpanel", { decodeSlashes: true })).toBe(
      "/app/admin/panel",
    );
  });

  it("resolves traversal revealed by decoding separators", () => {
    expect(resolveDotSegments("/api/orders/..%2fadmin", { decodeSlashes: true })).toBe(
      "/api/admin",
    );
  });

  it("keeps a dotted filename on the fast path", () => {
    expect(resolveDotSegments("/assets/app.1a2b.js")).toBe("/assets/app.1a2b.js");
  });

  it("keeps non-separator, non-dot encodings untouched", () => {
    expect(resolveDotSegments("/foo%20bar")).toBe("/foo%20bar");
    expect(resolveDotSegments("/caf%C3%A9/x")).toBe("/caf%C3%A9/x");
    expect(resolveDotSegments("/a%3Ab")).toBe("/a%3Ab");
  });

  it("normalizes backslashes even without a dot segment", () => {
    // The `\`->`/` normalization must not be skipped by the fast path.
    expect(resolveDotSegments("/admin\\panel")).toBe("/admin/panel");
    expect(resolveDotSegments("/a\\b")).toBe("/a/b");
  });

  it("roots relative inputs so `..` can never escape", () => {
    expect(resolveDotSegments("a/../b")).toBe("/b");
    expect(resolveDotSegments("a/../../b")).toBe("/b");
    expect(resolveDotSegments("assets/app.js")).toBe("/assets/app.js");
  });

  it("returns the root consistently for empty/consumed inputs", () => {
    expect(resolveDotSegments("")).toBe("/");
    expect(resolveDotSegments(".")).toBe("/");
    expect(resolveDotSegments("a/..")).toBe("/");
  });

  it("never yields a protocol-relative path", () => {
    // Multiple leading slashes (literal, backslash, or decoded) collapse to one
    // so the result can't be used as a `//host` open-redirect/SSRF target.
    expect(resolveDotSegments("//evil.com")).toBe("/evil.com");
    expect(resolveDotSegments("/\\evil.com")).toBe("/evil.com");
    expect(resolveDotSegments("/%2fevil.com", { decodeSlashes: true })).toBe("/evil.com");
    expect(resolveDotSegments("/app/..%2f..%2f%2fevil.com/steal", { decodeSlashes: true })).toBe(
      "/evil.com/steal",
    );
  });

  it("decodes nested %25-encoded separators at any depth", () => {
    expect(resolveDotSegments("/a/%252f../b", { decodeSlashes: true })).toBe("/a/b");
    expect(resolveDotSegments("/allowed/..%252f..%252fadmin", { decodeSlashes: true })).toBe(
      "/admin",
    );
    expect(resolveDotSegments("/a%25252fb", { decodeSlashes: true })).toBe("/a/b");
    expect(resolveDotSegments("/a%255cb", { decodeSlashes: true })).toBe("/a/b");
    // Still opaque without the opt-in
    expect(resolveDotSegments("/a/%252fb")).toBe("/a/%252fb");
  });

  it("catches nested %25-encoded dot segments", () => {
    expect(resolveDotSegments("/api/orders/%252e%252e/admin")).toBe("/api/admin");
    expect(resolveDotSegments("/a/%25252e%25252e/b")).toBe("/b");
  });

  it("preserves interior empty segments by default", () => {
    expect(resolveDotSegments("/api/orders//list.json")).toBe("/api/orders//list.json");
    // The empty segment shields the `..` from popping `a` (it pops the empty
    // segment instead), leaving the directory-form `/a/`.
    expect(resolveDotSegments("/a//..")).toBe("/a/");
    expect(resolveDotSegments("/api/foo/%2e%2e/%2fadmin/secret", { decodeSlashes: true })).toBe(
      "/api//admin/secret",
    );
  });

  it("preserves the trailing slash of a trailing dot segment (RFC 3986 §5.2.4)", () => {
    // A trailing `.`/`..` resolves to a directory: `/a/b/..` -> `/a/`, not `/a`,
    // matching what a WHATWG `URL`/nginx downstream resolves.
    expect(resolveDotSegments("/a/b/..")).toBe("/a/");
    expect(resolveDotSegments("/a/.")).toBe("/a/");
    expect(resolveDotSegments("/a/b/.")).toBe("/a/b/");
    // Encoded and nested forms resolve the same way.
    expect(resolveDotSegments("/a/b/%2e%2e")).toBe("/a/");
    expect(resolveDotSegments("/a/b/%252e")).toBe("/a/b/");
    // Popping down to the root still yields a single-slash root, not `//`.
    expect(resolveDotSegments("/a/..")).toBe("/");
    expect(resolveDotSegments("/..")).toBe("/");
    expect(resolveDotSegments("/a/../..")).toBe("/");
    // Merge mode preserves it too.
    expect(resolveDotSegments("/a/b/..", { mergeSlashes: true })).toBe("/a/");
  });

  describe("mergeSlashes", () => {
    it("collapses runs of literal separators", () => {
      expect(resolveDotSegments("/api/orders//list.json", { mergeSlashes: true })).toBe(
        "/api/orders/list.json",
      );
      expect(resolveDotSegments("/a////b", { mergeSlashes: true })).toBe("/a/b");
    });

    it("resolves a `..` an empty segment would otherwise shield", () => {
      expect(resolveDotSegments("/a//..", { mergeSlashes: true })).toBe("/");
      expect(resolveDotSegments("/a/b//../c", { mergeSlashes: true })).toBe("/a/c");
      expect(resolveDotSegments("/a//../..", { mergeSlashes: true })).toBe("/");
    });

    it("collapses runs formed by decoded separators", () => {
      // The maximal-traversal reading: `..` traverses and reaches /api/admin,
      // which is what a slash-merging downstream resolves.
      expect(
        resolveDotSegments("/api/foo/%2e%2e/%2fadmin/secret", {
          decodeSlashes: true,
          mergeSlashes: true,
        }),
      ).toBe("/api/admin/secret");
      expect(
        resolveDotSegments("/api/foo/%2e%2e/%2fadmin", { decodeSlashes: true, mergeSlashes: true }),
      ).toBe("/api/admin");
      expect(resolveDotSegments("/a/%2f%2fb", { decodeSlashes: true, mergeSlashes: true })).toBe(
        "/a/b",
      );
      // ...at any `%25`-nesting depth, and for `%5c` too
      expect(
        resolveDotSegments("/a/%252f%255cb", { decodeSlashes: true, mergeSlashes: true }),
      ).toBe("/a/b");
      expect(
        resolveDotSegments("/a/b/%2e%2e/%252f..%2fadmin", {
          decodeSlashes: true,
          mergeSlashes: true,
        }),
      ).toBe("/admin");
    });

    it("collapses runs formed by normalized backslashes", () => {
      expect(resolveDotSegments("/a/\\/b", { mergeSlashes: true })).toBe("/a/b");
      expect(resolveDotSegments("/a\\\\..", { mergeSlashes: true })).toBe("/");
    });

    it("leaves an encoded separator opaque without decodeSlashes", () => {
      // `%2f` is not part of the active separator set, so it forms no run.
      expect(resolveDotSegments("/a/%2f%2fb", { mergeSlashes: true })).toBe("/a/%2f%2fb");
      expect(resolveDotSegments("/a/%2f..", { mergeSlashes: true })).toBe("/a/%2f..");
    });

    it("collapses only runs, preserving a single trailing slash", () => {
      expect(resolveDotSegments("/a/", { mergeSlashes: true })).toBe("/a/");
      expect(resolveDotSegments("/a//", { mergeSlashes: true })).toBe("/a/");
      expect(resolveDotSegments("/a//b/../", { mergeSlashes: true })).toBe("/a/");
      expect(resolveDotSegments("/", { mergeSlashes: true })).toBe("/");
    });

    it("still never escapes above the root or yields a protocol-relative path", () => {
      expect(resolveDotSegments("/..//../etc/passwd", { mergeSlashes: true })).toBe("/etc/passwd");
      expect(resolveDotSegments("//evil.com", { mergeSlashes: true })).toBe("/evil.com");
      expect(
        resolveDotSegments("/app/..%2f..%2f%2fevil.com/steal", {
          decodeSlashes: true,
          mergeSlashes: true,
        }),
      ).toBe("/evil.com/steal");
    });

    it("keeps a run-free path on the fast path", () => {
      expect(resolveDotSegments("/assets/app.1a2b.js", { mergeSlashes: true })).toBe(
        "/assets/app.1a2b.js",
      );
      expect(resolveDotSegments("/foo%20bar", { mergeSlashes: true })).toBe("/foo%20bar");
    });
  });
});
