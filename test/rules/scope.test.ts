import { describe, expect, it } from "vitest";
import {
  canonicalPath,
  isPathInScope,
  mergedCanonicalPath,
  needsCanonicalPasses,
} from "../../src/rules/internal/scope.ts";

// An encoded traversal like `..%2f` must
// not let a request escape a `/**` proxy/redirect scope once the downstream
// decodes it. (Ported verbatim from Nitro test/unit/route-rules.test.ts.)
describe("isPathInScope", () => {
  it("accepts in-scope paths", () => {
    expect(isPathInScope("/api/orders/list.json", "/api/orders")).toBe(true);
    expect(isPathInScope("/api/orders/", "/api/orders")).toBe(true);
    expect(isPathInScope("/api/orders", "/api/orders")).toBe(true);
  });

  it("rejects encoded slash traversal (%2f)", () => {
    expect(isPathInScope("/api/orders/..%2fadmin%2fconfig.json", "/api/orders")).toBe(false);
    expect(isPathInScope("/api/orders/..%2Fadmin", "/api/orders")).toBe(false);
  });

  it("rejects encoded backslash traversal (%5c / %5C)", () => {
    expect(isPathInScope("/api/orders/..%5cadmin", "/api/orders")).toBe(false);
    expect(isPathInScope("/api/orders/..%5Cadmin", "/api/orders")).toBe(false);
  });

  it("rejects uppercase-encoded dot-segments (%2E%2E)", () => {
    expect(isPathInScope("/api/orders/%2E%2E%2Fadmin", "/api/orders")).toBe(false);
  });

  it("rejects double-encoded traversal (%252e / %252f)", () => {
    // `resolveDotSegments` decodes separators/dots at any `%25`-nesting depth —
    // exactly what a downstream that percent-decodes more than once would see.
    expect(isPathInScope("/api/orders/..%252fadmin", "/api/orders")).toBe(false);
    expect(isPathInScope("/api/orders/%252e%252e%252fadmin", "/api/orders")).toBe(false);
  });

  it("rejects literal traversal above scope", () => {
    expect(isPathInScope("/api/orders/../admin", "/api/orders")).toBe(false);
    expect(isPathInScope("/api/orders/../../etc/passwd", "/api/orders")).toBe(false);
  });

  it("rejects traversal landing exactly on the scope's parent", () => {
    expect(isPathInScope("/api/orders/..", "/api/orders")).toBe(false);
    expect(isPathInScope("/api/orders/%2e%2e", "/api/orders")).toBe(false);
  });

  it("keeps traversal confined within scope", () => {
    expect(isPathInScope("/api/orders/foo/../bar", "/api/orders")).toBe(true);
    expect(isPathInScope("/api/orders/foo%2f..%2fbar", "/api/orders")).toBe(true);
  });

  it("rejects a mid-path doubled-slash that escapes on a slash-merging downstream", () => {
    // h3's canonicalization preserves the empty `//` segment, so a following
    // `..` is shielded and the path looks in-scope. But a downstream that merges
    // consecutive slashes (nginx `merge_slashes`) drops the empty first, letting
    // the `..` traverse out. `isPathInScope` also checks h3's `mergeSlashes`
    // reading — the *maximal-traversal* form, what a downstream that decodes then
    // merges then resolves sees — so this must fail closed in every equivalent
    // shape.
    expect(isPathInScope("/api/orders/a//..%2f..%2fc", "/api/orders")).toBe(false);
    expect(isPathInScope("/api/orders/a//b//..%2f..%2f..%2fsecret", "/api/orders")).toBe(false);
    expect(isPathInScope("/api/orders/a//..%5c..%5cc", "/api/orders")).toBe(false); // backslash
    expect(isPathInScope("/api/orders/a//..%252f..%252fc", "/api/orders")).toBe(false); // double-enc
    expect(isPathInScope("/api/orders/a%2f%2f..%2f..%2fc", "/api/orders")).toBe(false); // encoded empty
  });

  it("still allows empty segments that resolve within scope", () => {
    // A doubled slash is only a problem when it shields a traversal; a benign
    // `//` whose merged form stays in scope must not be rejected.
    expect(isPathInScope("/api/orders/a//b%2f..%2f..%2fc", "/api/orders")).toBe(true);
    expect(isPathInScope("/api/orders//list.json", "/api/orders")).toBe(true);
  });

  it("does not confuse sibling prefix with scope", () => {
    expect(isPathInScope("/api/ordersX/list.json", "/api/orders")).toBe(false);
  });

  it("allows anything for an empty base (catch-all /**)", () => {
    expect(isPathInScope("/anything/here", "")).toBe(true);
  });
});

// Used to match route rules: encoded separators must be decoded so a request
// cannot dodge a narrower rule (e.g. a `basicAuth` gate) that a broader rule
// would still serve once the downstream decodes them back to `/`.
describe("canonicalPath", () => {
  it("decodes encoded path separators", () => {
    expect(canonicalPath("/app/admin%2fpanel")).toBe("/app/admin/panel");
    expect(canonicalPath("/app/admin%2Fpanel")).toBe("/app/admin/panel");
    expect(canonicalPath("/app/admin%5cpanel")).toBe("/app/admin/panel");
    expect(canonicalPath("/app/admin%5Cpanel")).toBe("/app/admin/panel");
  });

  it("resolves traversal revealed by decoding", () => {
    expect(canonicalPath("/api/orders/..%2fadmin")).toBe("/api/admin");
  });

  it("resolves double-encoded traversal (%252f)", () => {
    expect(canonicalPath("/api/orders/..%252fadmin")).toBe("/api/admin");
  });

  it("collapses a leading `//` (never protocol-relative)", () => {
    expect(canonicalPath("//evil.com")).toBe("/evil.com");
  });

  it("passes malformed percent sequences through opaquely (no throw)", () => {
    expect(canonicalPath("/a%2")).toBe("/a%2");
    expect(canonicalPath("/a%zz/b")).toBe("/a%zz/b");
  });

  it("resolves plain dot segments", () => {
    expect(canonicalPath("/a/./b")).toBe("/a/b");
    expect(canonicalPath("/a/b/../c")).toBe("/a/c");
  });

  it("leaves a plain path untouched", () => {
    expect(canonicalPath("/app/admin/panel")).toBe("/app/admin/panel");
  });

  it("keeps a dotted filename on the fast path", () => {
    // A `.` inside a segment cannot change the path, so an asset request (the
    // hot path) must not pay for the split/normalize/join.
    expect(canonicalPath("/assets/app.1a2b.js")).toBe("/assets/app.1a2b.js");
  });

  it("keeps %20 / non-ASCII encodings in sync with event.url.pathname", () => {
    // srvx keeps `%20` and percent-encoded non-ASCII opaque in
    // `event.url.pathname` (it is not `decodeURI`-d), so canonicalization must
    // leave them encoded too — decoding would desync the canonical path from
    // how route rules are matched.
    expect(canonicalPath("/foo%20bar")).toBe("/foo%20bar");
    expect(canonicalPath("/caf%C3%A9/x")).toBe("/caf%C3%A9/x");
  });

  it("keeps non-separator reserved encodings opaque", () => {
    expect(canonicalPath("/a%3Ab")).toBe("/a%3Ab");
  });

  it("resolves a trailing dot segment to its directory form", () => {
    // h3 keeps the trailing slash (RFC 3986 §5.2.4), so a scope check sees the
    // directory a WHATWG/nginx downstream resolves — not its file-form sibling.
    expect(canonicalPath("/a/b/..")).toBe("/a/");
    expect(canonicalPath("/a/.")).toBe("/a/");
    expect(canonicalPath("/a/b/%2e%2e")).toBe("/a/");
  });

  it("preserves interior empty segments (no slash merging)", () => {
    // The plain reading never merges slashes; `mergedCanonicalPath` is the other
    // reading. Keeping them distinct is what makes the dual check meaningful.
    expect(canonicalPath("/a//b")).toBe("/a//b");
    expect(canonicalPath("/a//..")).toBe("/a/");
  });
});

// The slash-merged reading and the guard that lets both extra passes be skipped.
// These back `src/match.ts`'s dual-path union and `isPathInScope`; the guard's
// `false` verdict must be exact, since it is what suppresses the extra passes.
describe("mergedCanonicalPath / needsCanonicalPasses", () => {
  it("collapses separator runs so an empty segment cannot shield a `..`", () => {
    expect(mergedCanonicalPath("/a//..", canonicalPath("/a//.."))).toBe("/");
    expect(mergedCanonicalPath("/a%2f%2f..%2fb", canonicalPath("/a%2f%2f..%2fb"))).toBe("/b");
  });

  it("differs from the plain reading even when that reading is itself merge-canonical", () => {
    // Guards the tempting-but-unsound shortcut: the `..` is consumed during the
    // plain pass, leaving `/a/b` — which has no run left to merge — while the
    // merged reading of the original is `/b`. Deriving the second reading from
    // the first, or skipping it here, would drop a real escape.
    expect(canonicalPath("/a//../b")).toBe("/a/b");
    expect(mergedCanonicalPath("/a//../b", "/a/b")).toBe("/b");
    expect(isPathInScope("/a//../b", "/a")).toBe(false);
  });

  it("returns undefined when it agrees with the plain canonical reading", () => {
    for (const path of ["/a/b", "/a/b/../c", "/a%2fb", "/assets/app.1a2b.js"]) {
      expect(mergedCanonicalPath(path, canonicalPath(path))).toBeUndefined();
    }
  });

  it("reports a path needing no canonical pass only when both readings agree", () => {
    // `false` must imply the path IS both readings — otherwise a caller skipping
    // the passes would miss a rule/scope check (a bypass, not a perf bug).
    for (const path of [
      "/a/b",
      "/assets/app.1a2b.js",
      "/foo%20bar",
      "/caf%C3%A9/x",
      "/a%3Ab",
      "/a%2",
      "/a//b",
      "/a%2fb",
      "/a/b/..",
      "/a/./b",
      "/a\\b",
      "/a//..%2f..%2fc",
      "//evil.com",
    ]) {
      if (!needsCanonicalPasses(path)) {
        expect(canonicalPath(path)).toBe(path);
        expect(mergedCanonicalPath(path, canonicalPath(path))).toBeUndefined();
      }
    }
    expect(needsCanonicalPasses("/a/b")).toBe(false);
    expect(needsCanonicalPasses("/assets/app.1a2b.js")).toBe(false);
    // an interior `//` is canonical plainly, but not under the merged reading
    expect(needsCanonicalPasses("/a//b")).toBe(true);
    expect(needsCanonicalPasses("/a%2fb")).toBe(true);
    expect(needsCanonicalPasses("/a/b/..")).toBe(true);
  });

  it("agrees with both readings on assembled paths (seeded fuzz)", () => {
    // The directed list above can only pin the cases we thought of. Assemble
    // paths from every fragment that can trigger a reading — dot segments,
    // their encodings, `%25` nesting, separators — and require the guard to
    // agree with the two readings it suppresses, in both directions.
    const FRAGMENTS = [
      "/",
      "//",
      "\\",
      ".",
      "..",
      "...",
      "%2e",
      "%2E",
      "%252e",
      "%2e%2e",
      "%2f",
      "%5C",
      "%252f",
      "a",
      "app.js",
      ".well-known",
      "..b",
      "a%2eb",
      "%20",
      "%25",
      "%",
      "admin",
      "%2e.",
      ".%2e",
      "%25%32%66",
    ];
    let seed = 4321;
    const rand = () => (seed = (seed * 1_103_515_245 + 12_345) & 0x7f_ff_ff_ff) / 0x7f_ff_ff_ff;
    for (let i = 0; i < 50_000; i++) {
      let path = rand() < 0.9 ? "/" : "";
      const length = 1 + Math.floor(rand() * 6);
      for (let j = 0; j < length; j++) {
        path += FRAGMENTS[Math.floor(rand() * FRAGMENTS.length)];
      }
      const canonical = canonicalPath(path);
      const bothAreNoOps = canonical === path && mergedCanonicalPath(path, canonical) === undefined;
      if (needsCanonicalPasses(path)) {
        // Not required for safety (a false positive only costs the slow path),
        // but the guard should never be lazier than the readings it guards — a
        // divergence here means the derivation comment in scope.ts is stale.
        if (bothAreNoOps) {
          expect.fail(`needsCanonicalPasses(${JSON.stringify(path)}) but both readings are no-ops`);
        }
      } else if (!bothAreNoOps) {
        // This direction IS the safety property: skipping the passes on a path
        // with an alternate reading is a missed rule/scope check.
        expect.fail(
          `!needsCanonicalPasses(${JSON.stringify(path)}) but an alternate reading exists`,
        );
      }
    }
  });
});
