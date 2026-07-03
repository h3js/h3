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
});
