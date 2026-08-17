import { describe, expect, it } from "vitest";
import { resolveRuleTarget } from "../../src/rules/handlers/_utils.ts";
import {
  canonicalPath,
  isPathInScope,
  mergedCanonicalPath,
  needsCanonicalPasses,
} from "../../src/rules/internal/scope.ts";
import { normalizeRouteRules } from "../../src/rules/normalize.ts";
import type { RedirectRuleOptions } from "../../src/rules/types.ts";

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

  it("rejects traversal at any `%25` nesting depth", () => {
    // `resolveDotSegments` collapses `%2e`/`%2f` at every depth, so this must
    // not become depth-dependent when the decode loop is bounded.
    for (const depth of [1, 3, 8, 9, 4000]) {
      const nest = "%" + "25".repeat(depth);
      expect(
        isPathInScope(`/api/orders/${nest}2e${nest}2e${nest}2fadmin`, "/api/orders"),
        `depth ${depth}`,
      ).toBe(false);
    }
  });

  it("rejects traversal that only surfaces after repeated decoding", () => {
    // A dot whose hex digits are themselves encoded (`%25%32%65` -> `%2e` ->
    // `.`) is out of `resolveDotSegments`' reach on its own, so only
    // `decodedPath` running to its fixpoint catches it — one pass per layer.
    // Each layer triples the path's length, so this is the construction that
    // decides how many passes the loop can ever need; the deep layers here sit
    // past any small pass bound and must still fail closed.
    const hexOfHex = (value: string) =>
      [...value].map((c) => "%" + c.charCodeAt(0).toString(16).padStart(2, "0")).join("");
    let ladder = "%2e";
    for (let layers = 1; layers <= 8; layers++) {
      ladder = hexOfHex(ladder);
      expect(isPathInScope(`/base/${ladder}${ladder}/secret`, "/base"), `${layers} layers`).toBe(
        false,
      );
    }
  });

  it("stays in scope through a deeply nested spelling", () => {
    // The other direction: a bounded decode loop must not start reporting a
    // benign deep spelling as an escape either.
    for (const depth of [1, 3, 8, 9, 4000]) {
      const nest = "%" + "25".repeat(depth);
      expect(isPathInScope(`/api/orders/a${nest}20b`, "/api/orders"), `depth ${depth}`).toBe(true);
    }
  });
});

// Used to match route rules: encoded separators must be decoded so a request
// cannot dodge a narrower rule that a broader rule would still serve once the
// downstream decodes them back to `/`.
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

// The `/**` rule target resolver's scope handling. `base` is the rule *key*
// minus `/**`, i.e. pattern text — so it may carry rou3 dynamic segments that
// can never equal a request path literally.
describe("rule target scope (prepareRuleTarget)", () => {
  const evt = (raw: string) =>
    ({ url: new URL("http://localhost" + raw) }) as Parameters<typeof resolveRuleTarget>[0];
  const resolve = (raw: string, options: RedirectRuleOptions) =>
    resolveRuleTarget(evt(raw), options);
  const blocked = (raw: string, options: RedirectRuleOptions) => {
    try {
      resolve(raw, options);
    } catch (error: any) {
      if (error?.status === 400) {
        return true;
      }
      throw error; // surface unexpected failures instead of reporting "not blocked"
    }
    return false;
  };
  // Go through normalization so the `base` under test is the one the runtime
  // actually receives, not a hand-written stand-in.
  const rule = (key: string, to: string): RedirectRuleOptions =>
    normalizeRouteRules({ [key]: { redirect: to } })[key]!.redirect as RedirectRuleOptions;

  describe("dynamic pattern prefix", () => {
    it("strips a `:param` prefix using the request's own leading segments", () => {
      const options = rule("/:lang/old/**", "/new/**");
      expect(options.base).toBe("/:lang/old");
      expect(resolve("/en/old/docs", options)).toBe("/new/docs");
      expect(resolve("/fr/old/a/b", options)).toBe("/new/a/b");
      expect(resolve("/en/old/docs?x=1", options)).toBe("/new/docs?x=1");
    });

    it("strips a `*` prefix segment", () => {
      const options = rule("/*/old/**", "/new/**");
      expect(resolve("/en/old/docs", options)).toBe("/new/docs");
    });

    it("resolves an empty tail without emitting an empty target", () => {
      const options = rule("/:lang/old/**", "/new/**");
      expect(resolve("/en/old", options)).toBe("/new");
      expect(resolve("/en/old/", options)).toBe("/new");
    });

    it("keeps the literal fast path for a fully static prefix", () => {
      const options = rule("/old/**", "/new/**");
      expect(options.base).toBe("/old");
      expect(resolve("/old/docs", options)).toBe("/new/docs");
      // a static base is still compared literally: a path only *canonically*
      // under it cannot be faithfully stripped
      expect(blocked("/old%2fdocs", options)).toBe(true);
    });

    it("still rejects traversal out of a dynamically derived base", () => {
      const options = rule("/:lang/old/**", "/new/**");
      expect(blocked("/en/old/..%2f..%2fadmin", options)).toBe(true);
      expect(blocked("/en/old/a//..%2f..%2fc", options)).toBe(true);
      expect(blocked("/en/old/../../admin", options)).toBe(true);
    });

    it("rejects an encoded separator inside the dynamic segment itself", () => {
      // The derived base is taken from the raw path, so a `%2f` in the matched
      // segment makes the two canonical readings disagree with it — fail closed
      // rather than forward a base that decodes to something else.
      const options = rule("/:lang/old/**", "/new/**");
      expect(blocked("/e%2fn/old/x", options)).toBe(true);
    });

    it("rejects a path with fewer segments than the pattern prefix", () => {
      const options = rule("/:lang/old/**", "/new/**");
      expect(blocked("/en", options)).toBe(true);
    });

    it("composes a matcher baseURL prefix (segment counts add)", () => {
      // `createRulesRouter` composes `baseURL + base`; the derived base must
      // then cover the mount prefix as well.
      const options = { ...rule("/:lang/old/**", "/new/**"), base: "/mount/:lang/old" };
      expect(resolve("/mount/en/old/docs", options)).toBe("/new/docs");
      // traversal out of the mounted scope still fails closed
      expect(blocked("/mount/en/old/..%2f..%2f..%2fsecret", options)).toBe(true);
      // a path too short to cover the composed prefix cannot be stripped
      expect(blocked("/mount/en", options)).toBe(true);
    });
  });

  describe("origin-root target (empty target base)", () => {
    // `isPathInScope(x, "")` allows everything by contract, so the post-join
    // re-check is inert for a target rooted at an origin (`to: "https://internal/**"`,
    // or a bare `/**`). The root has exactly one escape: a leading separator
    // *run*, which a `%2f`-decoding downstream reads as an authority
    // (`//evil.com`). h3's `stripBase` collapses only *literal* leading
    // slashes, so the encoded form survives base stripping and must be rejected.
    it("rejects a leading encoded separator run after base stripping", () => {
      expect(blocked("/old/%2f%2fevil.com", { to: "/**", base: "/old", status: 307 })).toBe(true);
      expect(
        blocked("/api/%2f%2fevil.com", { to: "https://internal/**", base: "/api", status: 307 }),
      ).toBe(true);
      expect(blocked("/old/%5c%5cevil.com", { to: "/**", base: "/old", status: 307 })).toBe(true);
      expect(blocked("/old/%252f%252fevil.com", { to: "/**", base: "/old", status: 307 })).toBe(
        true,
      );
    });

    it("still forwards a benign leading slash and interior encoded separators", () => {
      const options: RedirectRuleOptions = { to: "/**", base: "/old", status: 307 };
      expect(resolve("/old/a%2fb", options)).toBe("/a%2fb");
      expect(resolve("/old//evil.com", options)).toBe("/evil.com");
      expect(resolve("/old/docs", options)).toBe("/docs");
    });
  });
});
