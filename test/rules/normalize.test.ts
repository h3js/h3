import { describe, expect, it } from "vitest";
import { parseRouteKey } from "../../src/rules/internal/key.ts";
import { routeRules } from "../../src/rules/middleware.ts";
import { normalizeRouteRules } from "../../src/rules/normalize.ts";
import type { BasicAuthRuleOptions, RouteRuleConfig } from "../../src/rules/types.ts";
import type { CorsOptions } from "../../src/utils/cors.ts";
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

    it("throws on credentials: true with a falsy *defined* origin", () => {
      // h3 emits `Access-Control-Allow-Origin: *` whenever `!originOption`, not
      // only when it is `undefined` — so `null`/`""` are wildcards too and must
      // be rejected here, or the credentialed-wildcard pair ships anyway.
      for (const origin of [null, "", 0]) {
        expect(() =>
          normalizeRouteRules({
            "/api/**": { cors: { credentials: true, origin } as CorsOptions },
          }),
        ).toThrow(/`cors` rule for `\/api\/\*\*`.*wildcard origin/);
      }
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

  it("parses every method h3 itself routes, including QUERY", () => {
    // The recognized set must track h3's `HTTPMethod` (src/types/h3.ts) — a
    // method h3 can route but the key parser does not know silently degrades
    // into a literal path containing a space, which can never match.
    for (const method of [
      "GET",
      "HEAD",
      "POST",
      "PUT",
      "PATCH",
      "DELETE",
      "OPTIONS",
      "CONNECT",
      "TRACE",
      "QUERY",
    ]) {
      expect(parseRouteKey(`${method} /s`)).toEqual({ method, path: "/s" });
    }
  });

  it("re-keys a QUERY rule canonically instead of making it a literal path", () => {
    const rules = normalizeRouteRules({ "query /search/**": { headers: { a: "1" } } });
    expect(Object.keys(rules)).toEqual(["QUERY /search/**"]);
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

// D3: `false` is the *only* reset marker. Any other falsy value for a built-in
// rule is a config mistake — normalization would otherwise silently drop the
// rule, or hand a handler falsy options it cannot act on (`basicAuth` failed
// *open* on exactly this shape).
describe("normalizeRouteRules - falsy rule values rejected", () => {
  it("throws on `basicAuth: null` (only `false` disables a rule)", () => {
    expect(() =>
      normalizeRouteRules({ "/admin/**": { basicAuth: null as unknown as false } }),
    ).toThrow(/`basicAuth` rule for `\/admin\/\*\*`/);
  });

  it("throws on every falsy non-`false` value, for every built-in rule", () => {
    for (const name of ["cache", "headers", "redirect", "proxy", "basicAuth", "cors"]) {
      for (const value of [null, "", 0, Number.NaN]) {
        expect(() => normalizeRouteRules({ "/x": { [name]: value } as RouteRuleConfig })).toThrow(
          new RegExp(`\\\`${name}\\\` rule for \\\`/x\\\``),
        );
      }
    }
  });

  it("points at `false` as the way to disable an inherited rule", () => {
    expect(() => normalizeRouteRules({ "get /x": { redirect: null as unknown as false } })).toThrow(
      /`redirect` rule for `GET \/x`.*use `false` to disable/,
    );
  });

  it("keeps `false` itself as a reset marker", () => {
    const rules = normalizeRouteRules({
      "/x": { redirect: false, proxy: false, cors: false, cache: false, basicAuth: false },
    });
    expect(rules["/x"]).toEqual({
      redirect: false,
      proxy: false,
      cors: false,
      cache: false,
      basicAuth: false,
    });
  });

  it("keeps `swr: 0` (a real value: serve stale, revalidate immediately)", () => {
    expect(normalizeRouteRules({ "/x": { swr: 0 } })["/x"]!.cache).toMatchObject({
      swr: true,
      maxAge: 0,
    });
    expect(() => normalizeRouteRules({ "/x": { swr: null as unknown as false } })).toThrow(
      /`swr` rule for `\/x`/,
    );
  });

  it("leaves custom/data-only keys alone (`null` is legitimate data there)", () => {
    const rules = normalizeRouteRules({ "/x": { custom: null, isr: 0, tags: "" } });
    expect(rules["/x"]).toEqual({ custom: null, isr: 0, tags: "" });
  });

  it("rejects at app setup through `routeRules()`", () => {
    expect(() => routeRules({ "/admin/**": { basicAuth: null as unknown as false } })).toThrow(
      /`basicAuth` rule for `\/admin\/\*\*`/,
    );
  });
});

// F13 config half: `validate` is deliberately not a rule option, so `password`
// is the only credential a rule can carry. Without it `requireBasicAuth` throws
// a 500 on every request to the guarded route — catch it once, at config time.
describe("normalizeRouteRules - basicAuth requires a password", () => {
  it("throws when a basicAuth rule has no password", () => {
    expect(() =>
      normalizeRouteRules({
        "/admin/**": { basicAuth: { username: "admin" } as unknown as BasicAuthRuleOptions },
      }),
    ).toThrow(/`basicAuth` rule for `\/admin\/\*\*`.*`password`/);
  });

  it("throws on an empty-string password (h3 rejects it at runtime too)", () => {
    expect(() => normalizeRouteRules({ "/admin/**": { basicAuth: { password: "" } } })).toThrow(
      /`password`/,
    );
  });

  it("names the required shape", () => {
    expect(() => normalizeRouteRules({ "GET /a": { basicAuth: { realm: "x" } as never } })).toThrow(
      /`basicAuth` rule for `GET \/a`.*\{ password/,
    );
  });

  it("passes with a password and keeps the options untouched", () => {
    const rules = normalizeRouteRules({
      "/admin/**": { basicAuth: { username: "admin", password: "s3cret", realm: "Secure" } },
    });
    expect(rules["/admin/**"]!.basicAuth).toEqual({
      username: "admin",
      password: "s3cret",
      realm: "Secure",
    });
  });

  it("leaves `basicAuth: false` alone (reset marker, no credential needed)", () => {
    expect(normalizeRouteRules({ "/admin/**": { basicAuth: false } })["/admin/**"]!.basicAuth).toBe(
      false,
    );
  });
});
