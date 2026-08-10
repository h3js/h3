import { describe, expect, it } from "vitest";
import { parseRouteKey } from "../../src/rules/internal/key.ts";
import { normalizeRouteRules } from "../../src/rules/normalize.ts";
import type { RouteRuleConfig } from "../../src/rules/types.ts";
import { FIXTURE } from "./_fixture.ts";

// Ported verbatim from Nitro test/unit/route-rules.test.ts
describe("normalizeRouteRules - swr", () => {
  it("swr: true enables SWR", () => {
    const rules = normalizeRouteRules({ "/api/**": { swr: true } });
    expect(rules["/api/**"]!.cache).toMatchObject({ swr: true });
  });

  it("swr: 60 enables SWR with maxAge", () => {
    const rules = normalizeRouteRules({ "/api/**": { swr: 60 } });
    expect(rules["/api/**"]!.cache).toMatchObject({ swr: true, maxAge: 60 });
  });

  it("swr: 0 enables SWR with maxAge 0 (serve stale, revalidate immediately)", () => {
    const rules = normalizeRouteRules({ "/api/**": { swr: 0 } });
    expect(rules["/api/**"]!.cache).toMatchObject({ swr: true, maxAge: 0 });
  });

  it("swr: false is a cache reset marker (disables an inherited cache rule)", () => {
    const rules = normalizeRouteRules({ "/api/**": { swr: false } });
    expect(rules["/api/**"]!.cache).toBe(false);
  });

  it("swr: false yields to an explicit cache object on the same rule", () => {
    const rules = normalizeRouteRules({
      "/api/**": { swr: false, cache: { maxAge: 60 } },
    });
    expect(rules["/api/**"]!.cache).toEqual({ maxAge: 60 });
  });

  it("swr: 0 and swr: false are not equivalent", () => {
    const withZero = normalizeRouteRules({ "/api/**": { swr: 0 } });
    const withFalse = normalizeRouteRules({ "/api/**": { swr: false } });
    expect(withZero["/api/**"]!.cache).toMatchObject({ swr: true, maxAge: 0 });
    expect(withFalse["/api/**"]!.cache).toBe(false);
  });

  it("swr combines with an explicit cache object without mutating the input", () => {
    const input = { "/api/**": { swr: 60, cache: Object.freeze({ staleMaxAge: 10 }) } };
    const rules = normalizeRouteRules(input);
    expect(rules["/api/**"]!.cache).toEqual({ swr: true, maxAge: 60, staleMaxAge: 10 });
    // frozen input: a mutating implementation would throw above; assert
    // untouched regardless
    expect(input["/api/**"].cache).toEqual({ staleMaxAge: 10 });
  });
});

describe("normalizeRouteRules - redirect", () => {
  it("string form defaults to status 307", () => {
    const rules = normalizeRouteRules({ "/old": { redirect: "/new" } });
    expect(rules["/old"]!.redirect).toEqual({ to: "/new", status: 307 });
  });

  it("object form defaults to `/` and status 307", () => {
    const rules = normalizeRouteRules({
      "/old": { redirect: {} as { to: string } },
    });
    expect(rules["/old"]!.redirect).toEqual({ to: "/", status: 307 });
  });

  it("object form keeps custom status", () => {
    const rules = normalizeRouteRules({
      "/old": { redirect: { to: "/new", status: 301 } },
    });
    expect(rules["/old"]!.redirect).toEqual({ to: "/new", status: 301 });
  });

  it("redirect: false passes through as a reset marker", () => {
    // Same runtime-merge semantics as `cache: false`/`basicAuth: false`:
    // a more specific pattern can disable an inherited redirect.
    const rules = normalizeRouteRules({ "/old/**": { redirect: false } });
    expect(rules["/old/**"]!.redirect).toBe(false);
  });

  it("sets first-class `base` for /** keys only", () => {
    const rules = normalizeRouteRules({
      "/old/**": { redirect: "/new/**" },
      "/exact": { redirect: "/new" },
    });
    expect(rules["/old/**"]!.redirect).toEqual({ to: "/new/**", status: 307, base: "/old" });
    expect(rules["/exact"]!.redirect).toEqual({ to: "/new", status: 307 });
    expect(rules["/exact"]!.redirect).not.toHaveProperty("base");
  });
});

describe("normalizeRouteRules - proxy", () => {
  it("string form becomes { to }", () => {
    const rules = normalizeRouteRules({ "/api": { proxy: "https://example.com" } });
    expect(rules["/api"]!.proxy).toEqual({ to: "https://example.com" });
  });

  it("object form passes through with `base` for /** keys", () => {
    const rules = normalizeRouteRules({
      "/api/**": { proxy: { to: "https://example.com/**", headers: { "x-p": "1" } } },
    });
    expect(rules["/api/**"]!.proxy).toEqual({
      to: "https://example.com/**",
      headers: { "x-p": "1" },
      base: "/api",
    });
  });

  it("does not set `base` for non-wildcard keys", () => {
    const rules = normalizeRouteRules({ "/api": { proxy: "https://example.com" } });
    expect(rules["/api"]!.proxy).not.toHaveProperty("base");
  });

  it("proxy: false passes through as a reset marker", () => {
    const rules = normalizeRouteRules({ "/api/**": { proxy: false } });
    expect(rules["/api/**"]!.proxy).toBe(false);
  });
});

describe("normalizeRouteRules - cors", () => {
  it("cors: true normalizes to an empty options object (h3 fills defaults)", () => {
    const rules = normalizeRouteRules({ "/api/**": { cors: true } });
    expect(rules["/api/**"]!.cors).toEqual({});
    // No longer baked into static headers — `handleCors` owns the headers.
    expect(rules["/api/**"]!).not.toHaveProperty("headers");
  });

  it("cors object passes through as h3 CorsOptions", () => {
    const rules = normalizeRouteRules({
      "/api/**": { cors: { origin: ["https://example.com"], credentials: true, maxAge: "600" } },
    });
    expect(rules["/api/**"]!.cors).toEqual({
      origin: ["https://example.com"],
      credentials: true,
      maxAge: "600",
    });
  });

  it("cors: false is a reset marker (disables an inherited cors rule)", () => {
    const rules = normalizeRouteRules({ "/api/**": { cors: false } });
    expect(rules["/api/**"]!.cors).toBe(false);
  });

  it("does not mutate the user's cors options object", () => {
    const config = { origin: ["https://example.com"] };
    const rules = normalizeRouteRules({ "/api/**": { cors: config } });
    expect(rules["/api/**"]!.cors).not.toBe(config);
    expect(rules["/api/**"]!.cors).toEqual(config);
  });

  it("swr shortcut key does not survive normalization", () => {
    const rules = normalizeRouteRules({ "/api/**": { cors: true } });
    expect(rules["/api/**"]!).not.toHaveProperty("swr");
  });

  // Per the Fetch spec, `Access-Control-Allow-Origin: *` is unusable with
  // credentialed requests — h3 would emit both headers plus a console.warn on
  // every request. Normalization runs once at startup/build, so it throws.
  describe("credentials + wildcard origin misconfiguration", () => {
    it("throws on credentials: true with no origin (h3 defaults to `*`)", () => {
      expect(() => normalizeRouteRules({ "/api/**": { cors: { credentials: true } } })).toThrow(
        /`cors` rule for `\/api\/\*\*`.*wildcard origin/,
      );
    });

    it("throws on credentials: true with origin '*'", () => {
      expect(() =>
        normalizeRouteRules({ "/api/**": { cors: { credentials: true, origin: "*" } } }),
      ).toThrow(/credentials: true.*wildcard origin/);
    });

    it("throws on credentials: true with '*' in an origin array", () => {
      expect(() =>
        normalizeRouteRules({
          "/api/**": { cors: { credentials: true, origin: ["https://a.com", "*"] } },
        }),
      ).toThrow(/wildcard origin/);
    });

    it("names the canonical rule key in the error", () => {
      expect(() => normalizeRouteRules({ "get /x": { cors: { credentials: true } } })).toThrow(
        /`cors` rule for `GET \/x`/,
      );
    });

    it("passes with an explicit origin allowlist", () => {
      const rules = normalizeRouteRules({
        "/api/**": { cors: { credentials: true, origin: ["https://a.com"] } },
      });
      expect(rules["/api/**"]!.cors).toEqual({
        credentials: true,
        origin: ["https://a.com"],
      });
    });

    it("passes with a function origin (validated dynamically, not statically)", () => {
      const origin = (o: string) => o === "https://a.com";
      const rules = normalizeRouteRules({
        "/api/**": { cors: { credentials: true, origin } },
      });
      expect(rules["/api/**"]!.cors).toEqual({ credentials: true, origin });
    });

    it("passes with the literal 'null' origin (not a wildcard)", () => {
      const rules = normalizeRouteRules({
        "/api/**": { cors: { credentials: true, origin: "null" } },
      });
      expect(rules["/api/**"]!.cors).toEqual({ credentials: true, origin: "null" });
    });

    it("does not throw without credentials (wildcard origin alone is fine)", () => {
      const rules = normalizeRouteRules({
        "/api/**": { cors: { origin: "*" } },
        "/other/**": { cors: true },
      });
      expect(rules["/api/**"]!.cors).toEqual({ origin: "*" });
      expect(rules["/other/**"]!.cors).toEqual({});
    });
  });
});

describe("normalizeRouteRules - misc", () => {
  it("coerces a leading slash on the path", () => {
    const rules = normalizeRouteRules({ "api/**": { headers: { a: "1" } } });
    expect(Object.keys(rules)).toEqual(["/api/**"]);
  });

  it("cache: false passes through (runtime reset marker)", () => {
    const rules = normalizeRouteRules({ "/api/**": { cache: false } });
    expect(rules["/api/**"]!.cache).toBe(false);
  });

  it("cache: false wins over swr (Nitro parity)", () => {
    const rules = normalizeRouteRules({ "/api/**": { swr: 60, cache: false } });
    expect(rules["/api/**"]!.cache).toBe(false);
  });

  it("unknown/custom keys pass through untouched (data-only rules)", () => {
    const rules = normalizeRouteRules({
      "/blog/**": { prerender: true, isr: 60, custom: { a: 1 } },
    });
    expect(rules["/blog/**"]!).toMatchObject({ prerender: true, isr: 60, custom: { a: 1 } });
  });
});

describe("route key parsing", () => {
  it("parses METHOD /path keys", () => {
    expect(parseRouteKey("GET /api/**")).toEqual({ method: "GET", path: "/api/**" });
    expect(parseRouteKey("POST /api/form")).toEqual({ method: "POST", path: "/api/form" });
  });

  it("treats keys without a method prefix as all-methods", () => {
    expect(parseRouteKey("/api/**")).toEqual({ method: "", path: "/api/**" });
    expect(parseRouteKey("api/**")).toEqual({ method: "", path: "/api/**" });
  });

  it("does not treat non-method tokens as methods", () => {
    // Not a recognized HTTP method → plain path key (leading slash coerced)
    expect(parseRouteKey("FOO /bar")).toEqual({ method: "", path: "/FOO /bar" });
  });

  it("re-keys method-scoped rules canonically", () => {
    const rules = normalizeRouteRules({ "get /api/**": { headers: { a: "1" } } });
    expect(Object.keys(rules)).toEqual(["GET /api/**"]);
  });

  it("merges keys that collide after canonicalization (never drops)", () => {
    // `"get /x"` and `"GET /x"` (or `"x"` and `"/x"`) are distinct config keys
    // with the same canonical form — merge per rule name (objects shallow-merge,
    // later non-objects override), same semantics as the runtime merge of
    // duplicate registrations.
    const rules = normalizeRouteRules({
      "get /x": { headers: { a: "1", b: "1" }, prerender: true },
      "GET /x": { headers: { b: "2" } },
      y: { custom: { a: 1 } },
      "/y": { custom: null },
    });
    expect(Object.keys(rules).sort()).toEqual(["/y", "GET /x"]);
    expect(rules["GET /x"]!.headers).toEqual({ a: "1", b: "2" });
    expect(rules["GET /x"]!.prerender).toBe(true);
    expect(rules["/y"]!.custom).toBe(null);
  });

  it("method-scoped normalization applies to the path part", () => {
    const rules = normalizeRouteRules({ "GET /old/**": { redirect: "/new/**" } });
    expect(rules["GET /old/**"]!.redirect).toEqual({ to: "/new/**", status: 307, base: "/old" });
  });
});

describe("normalizeRouteRules - idempotency", () => {
  // Contract, not an accident: the compiler entrypoints normalize their input
  // themselves, and consumers may hand them an already-normalized rule set —
  // a second pass must be a no-op (shortcut keys are consumed by the first
  // pass; defaults, canonical keys, and `base` recompute to the same values).
  // If a future normalization step cannot re-apply cleanly, the compiler's
  // auto-normalization needs a redesign — do not just delete this test.
  it("re-normalizing a normalized rule set is a no-op", () => {
    const once = normalizeRouteRules(FIXTURE);
    const twice = normalizeRouteRules(once as Record<string, RouteRuleConfig>);
    expect(twice).toEqual(once);
    // Byte-level pin including key order: the compiler normalizes in a single
    // pass and pins byte-identical output for authored vs pre-normalized
    // input (test/compiler.test.ts), which requires the key-order fixed point
    // to be reached on the first pass.
    expect(JSON.stringify(twice)).toBe(JSON.stringify(once));
  });

  it("re-normalizing preserves reset markers and shortcut expansions", () => {
    const once = normalizeRouteRules({
      "/swr/**": { swr: 60 },
      "/off/**": { swr: false },
      "/cors/**": { cors: true },
      "/old/**": { redirect: "/new/**" },
      "/api/**": { proxy: { to: "https://example.com/**", headers: { "x-p": "1" } } },
    });
    const twice = normalizeRouteRules(once as Record<string, RouteRuleConfig>);
    expect(twice).toEqual(once);
    expect(twice["/off/**"]!.cache).toBe(false);
    expect(twice["/old/**"]!.redirect).toEqual({ to: "/new/**", status: 307, base: "/old" });
  });
});

describe("normalizeRouteRules - array options rejected", () => {
  it("throws on a top-level array rule option (ambiguous merge)", () => {
    // A top-level array cannot be shallow-merged across overlapping layers
    // without corrupting into an index-keyed object, so it is rejected at
    // config time rather than silently mangled.
    expect(() => normalizeRouteRules({ "/a/**": { custom: [1, 2, 3] } })).toThrow(
      /is an array — rule options cannot be top-level arrays/,
    );
  });

  it("names the offending rule and route in the error", () => {
    expect(() => normalizeRouteRules({ "GET /x": { tags: ["a", "b"] } })).toThrow(
      /`tags` rule for `GET \/x`/,
    );
  });

  it("allows arrays nested inside an object option (merged wholesale, not spliced)", () => {
    // Only the top-level option value is spread-merged; a nested array is a leaf
    // value that gets overridden as a unit, so it is safe and permitted.
    const rules = normalizeRouteRules({ "/a/**": { custom: { list: [1, 2, 3] } } });
    expect(rules["/a/**"]!.custom).toEqual({ list: [1, 2, 3] });
  });
});

describe("normalizeRouteRules - reserved rule names rejected", () => {
  // Rule names become object property keys throughout matching/merging. A name
  // like `__proto__`/`constructor`/`prototype` would otherwise resolve to an
  // inherited prototype member and let a merge write onto `Object.prototype`
  // (process-wide prototype pollution). Reject them at config time.
  for (const name of ["__proto__", "constructor", "prototype"]) {
    it(`throws on a \`${name}\` rule name`, () => {
      // JSON.parse so `__proto__` is a real own key, not prototype syntax.
      const config = JSON.parse(`{"/x": {"${name}": {"polluted": true}}}`);
      expect(() => normalizeRouteRules(config)).toThrow(/is a reserved name/);
      expect(Object.hasOwn(Object.prototype, "polluted")).toBe(false);
    });
  }
});
