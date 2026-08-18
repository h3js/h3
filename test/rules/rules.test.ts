import { H3 } from "../../src/index.ts";
import { describe, expect, it } from "vitest";
import { routeRules } from "../../src/rules/middleware.ts";
import { canonicalPath, isPathInScope } from "../../src/rules/internal/scope.ts";
import { proxy } from "../../src/rules/proxy.ts";
import { prepareRuleTarget } from "../../src/rules/handlers/_utils.ts";
import type { RuleTargetResolver } from "../../src/rules/handlers/_utils.ts";
import type { RouteRuleConfig } from "../../src/rules/types.ts";
import type { RouteRulesMatcherOptions } from "../../src/rules/match.ts";

// `proxy` is an opt-in subpath handler (`h3/rules/proxy`) — register it by
// default so the proxy-rule cases below construct, while letting a test override.
const createApp = (config: Record<string, RouteRuleConfig>, opts?: RouteRulesMatcherOptions) => {
  const app = new H3();
  app.use(routeRules(config, { ...opts, handlers: { proxy, ...opts?.handlers } }));
  return app;
};

describe("headers rule", () => {
  it("sets response headers", async () => {
    const app = createApp({ "/rules/headers": { headers: { "cache-control": "s-maxage=60" } } });
    app.get("/rules/headers", () => "ok");
    const res = await app.fetch(new Request("http://test/rules/headers"));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("s-maxage=60");
  });

  it("user headers override cors defaults", async () => {
    const app = createApp({
      "/rules/cors": { cors: true, headers: { "access-control-allow-methods": "GET" } },
    });
    app.get("/rules/cors", () => "ok");
    const res = await app.fetch(new Request("http://test/rules/cors"));
    // `handleCors` sets the permissive origin on a normal request; the user
    // `headers` rule (order -1, `.set`) still owns `access-control-allow-methods`.
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("access-control-allow-methods")).toBe("GET");
  });
});

// Runtime fail-closed / error-path regressions for the built-in rule handlers.
// Each pins the *runtime* half only — the matching config-time guards in
// `normalizeRouteRules` are a separate layer, so these cases are constructed to
// stay reachable (via merge, or straight from the handler) even once config-time
// validation rejects the same shape earlier.
describe("headers rule on error responses", () => {
  // `prepareResponse` swaps in `event.res.errHeaders` for status >= 400, and an
  // exception unwinds past `await next()` — a rule header must survive both.
  const HEADER_RULES: Record<string, RouteRuleConfig> = {
    "/rules/err/**": { headers: { "x-rule": "1" } },
  };

  it("applies to a 2xx response", async () => {
    const app = createApp(HEADER_RULES);
    app.get("/rules/err/ok", () => "ok");
    const res = await app.fetch(new Request("http://test/rules/err/ok"));
    expect(res.status).toBe(200);
    expect(res.headers.get("x-rule")).toBe("1");
  });

  it("applies to a 404 from an unmatched route", async () => {
    const app = createApp(HEADER_RULES);
    const res = await app.fetch(new Request("http://test/rules/err/missing"));
    expect(res.status).toBe(404);
    expect(res.headers.get("x-rule")).toBe("1");
  });

  it("applies to a thrown 500", async () => {
    const app = new H3({ silent: true });
    app.use(routeRules(HEADER_RULES));
    app.get("/rules/err/boom", () => {
      throw new Error("boom");
    });
    const res = await app.fetch(new Request("http://test/rules/err/boom"));
    expect(res.status).toBe(500);
    expect(res.headers.get("x-rule")).toBe("1");
  });
});

describe("cors rule", () => {
  it("answers a preflight request with 204 + policy headers", async () => {
    const app = createApp({ "/api/**": { cors: true } });
    app.get("/api/x", () => "ok");
    const res = await app.fetch(
      new Request("http://test/api/x", {
        method: "OPTIONS",
        headers: { origin: "https://example.com", "access-control-request-method": "GET" },
      }),
    );
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("access-control-allow-methods")).toBe("*");
  });

  it("reflects an allowlisted origin and honors credentials", async () => {
    const app = createApp({
      "/api/**": { cors: { origin: ["https://example.com"], credentials: true } },
    });
    app.get("/api/x", () => "ok");
    const allowed = await app.fetch(
      new Request("http://test/api/x", { headers: { origin: "https://example.com" } }),
    );
    expect(allowed.headers.get("access-control-allow-origin")).toBe("https://example.com");
    expect(allowed.headers.get("access-control-allow-credentials")).toBe("true");
    const denied = await app.fetch(
      new Request("http://test/api/x", { headers: { origin: "https://evil.com" } }),
    );
    expect(denied.headers.get("access-control-allow-origin")).toBe(null);
  });

  it("preflight short-circuits before the rest of the chain (cors is outermost)", async () => {
    const app = createApp({
      "/api/**": { cors: true, redirect: "/elsewhere" },
    });
    app.get("/api/x", () => "ok");
    // Preflight OPTIONS: answered by cors (order -3) with 204, so the redirect
    // rule at the default 0 never runs.
    const preflight = await app.fetch(
      new Request("http://test/api/x", {
        method: "OPTIONS",
        headers: { origin: "https://example.com", "access-control-request-method": "GET" },
      }),
    );
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("location")).toBeNull();
    // A real (non-preflight) request runs the inner rule as usual.
    const real = await app.fetch(
      new Request("http://test/api/x", { headers: { origin: "https://example.com" } }),
    );
    expect(real.status).toBe(307);
    expect(real.headers.get("location")).toBe("/elsewhere");
  });

  it("drops credentials when a merge re-forms wildcard-origin + credentials", async () => {
    // Per-key normalization rejects `credentials: true` + wildcard origin, but
    // merge is shallow and least→most specific: a broad credentialed allowlist
    // narrowed by a more specific `origin: "*"` re-forms the forbidden pair
    // *after* normalization (which never re-runs). h3 would emit
    // `Access-Control-Allow-Origin: *` + `Access-Control-Allow-Credentials: true`
    // — rejected by browsers. The cors handler neutralizes it by dropping
    // `credentials`, matching h3's own wildcard-emission condition.
    const app = createApp({
      "/api/cred/**": { cors: { credentials: true, origin: ["https://a.com"] } },
      "/api/cred/wide": { cors: { origin: "*" } },
    });
    app.get("/api/cred/wide", () => "ok");
    const res = await app.fetch(
      new Request("http://test/api/cred/wide", { headers: { origin: "https://evil.com" } }),
    );
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("access-control-allow-credentials")).toBe(null);
  });

  it("drops credentials when a merge re-forms a falsy-but-defined origin", async () => {
    // Same hazard as above with a *defined* falsy origin (`null`, `""`): h3 emits
    // `Access-Control-Allow-Origin: *` whenever `!origin`, so the guard's wildcard
    // test must match h3's emission condition, not just `undefined`/`"*"`.
    for (const origin of [null, ""]) {
      const app = createApp({
        "/api/cred3/**": { cors: { credentials: true, origin: ["https://a.com"] } },
        "/api/cred3/wide": { cors: { origin: origin as unknown as "*" } },
      });
      app.get("/api/cred3/wide", () => "ok");
      const res = await app.fetch(
        new Request("http://test/api/cred3/wide", { headers: { origin: "https://evil.com" } }),
      );
      expect(res.headers.get("access-control-allow-origin")).toBe("*");
      expect(res.headers.get("access-control-allow-credentials")).toBe(null);
    }
  });

  it("keeps credentials for an array origin allowlist re-formed by merge", async () => {
    // Array allowlists never yield a wildcard ACAO (h3 reflects the specific
    // origin), so a credentialed array origin must survive the guard intact.
    const app = createApp({
      "/api/cred2/**": { cors: { credentials: true, origin: ["https://a.com"] } },
      "/api/cred2/more": { cors: { origin: ["https://a.com", "https://c.com"] } },
    });
    app.get("/api/cred2/more", () => "ok");
    const res = await app.fetch(
      new Request("http://test/api/cred2/more", { headers: { origin: "https://c.com" } }),
    );
    expect(res.headers.get("access-control-allow-origin")).toBe("https://c.com");
    expect(res.headers.get("access-control-allow-credentials")).toBe("true");
  });

  it("cors: false resets an inherited cors rule", async () => {
    const app = createApp({ "/api/**": { cors: true }, "/api/no-cors": { cors: false } });
    app.get("/api/no-cors", () => "ok");
    const res = await app.fetch(
      new Request("http://test/api/no-cors", { headers: { origin: "https://example.com" } }),
    );
    expect(res.headers.get("access-control-allow-origin")).toBe(null);
  });

  it("exposes merged rules on event.context.routeRules", async () => {
    const app = createApp({ "/blog/**": { prerender: true, headers: { "x-a": "1" } } });
    app.get("/blog/:slug", (event) => ({
      rules: Object.keys(event.context.routeRules || {}).sort(),
    }));
    const res = await app.fetch(new Request("http://test/blog/post"));
    expect(await res.json()).toEqual({ rules: ["headers", "prerender"] });
  });

  it("the context carries the merged rule config itself, not a wrapper", async () => {
    // The whole contract, built-in and custom side by side: each key holds the
    // merged options as authored — `rules.redirect.to`, not
    // `rules.redirect.options.to` — and a custom rule needs exactly one
    // declaration to get there (see `_augment.ts`; typed in types.test-d.ts).
    const app = createApp(
      {
        "/blog/**": { custom: { audience: "public" }, headers: { "x-a": "1" } },
        "/blog/:slug": { custom: { tier: "free" }, redirect: { to: "/new", status: 301 } },
      },
      { handlers: { redirect: undefined } }, // data-only, so the response is the handler's
    );
    app.get("/blog/:slug", (event) => {
      const rules = event.context.routeRules;
      return {
        audience: (rules?.custom as { audience?: string })?.audience,
        tier: (rules?.custom as { tier?: string })?.tier,
        header: rules?.headers?.["x-a"],
        to: rules?.redirect?.to,
        status: rules?.redirect?.status,
      };
    });
    const res = await app.fetch(new Request("http://test/blog/post"));
    expect(await res.json()).toEqual({
      audience: "public",
      tier: "free",
      header: "1",
      to: "/new",
      status: 301,
    });
  });
});

describe("redirect rule", () => {
  it("redirects with default 307", async () => {
    const app = createApp({ "/rules/redirect": { redirect: "/base" } });
    const res = await app.fetch(new Request("http://test/rules/redirect"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("/base");
  });

  it("redirects with custom status", async () => {
    const app = createApp({
      "/rules/redirect/obj": { redirect: { to: "https://h3.dev/", status: 308 } },
    });
    const res = await app.fetch(new Request("http://test/rules/redirect/obj"));
    expect(res.status).toBe(308);
    expect(res.headers.get("location")).toBe("https://h3.dev/");
  });

  it("preserves the query string on non-wildcard targets", async () => {
    const app = createApp({ "/rules/redirect": { redirect: "/base" } });
    const res = await app.fetch(new Request("http://test/rules/redirect?a=1&b=2"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("/base?a=1&b=2");
  });

  it("preserves duplicate query keys on non-wildcard targets", async () => {
    // The raw search string is forwarded — never a key/value object round-trip,
    // which would collapse `tag=a&tag=b` to the last value.
    const app = createApp({ "/rules/redirect": { redirect: "/base" } });
    const res = await app.fetch(new Request("http://test/rules/redirect?tag=a&tag=b"));
    expect(res.headers.get("location")).toBe("/base?tag=a&tag=b");
  });

  it("keeps target-baked query params ahead of appended request params", async () => {
    // Semantics: the target's own query is kept first; the request's raw query
    // is appended after it (both multi-valued-safe — no clobbering).
    const app = createApp({ "/rules/redirect": { redirect: "/base?x=0" } });
    const res = await app.fetch(new Request("http://test/rules/redirect?x=9&y=2"));
    expect(res.headers.get("location")).toBe("/base?x=0&x=9&y=2");
    // no request query → target forwarded verbatim
    const bare = await app.fetch(new Request("http://test/rules/redirect"));
    expect(bare.headers.get("location")).toBe("/base?x=0");
  });

  it("preserves query encoding on non-wildcard targets", async () => {
    // `%2B` must stay `%2B` (a decode/re-encode round-trip would turn it into
    // a literal `+`, i.e. a space for the upstream).
    const app = createApp({ "/rules/redirect": { redirect: "/base" } });
    const res = await app.fetch(new Request("http://test/rules/redirect?q=a%2Bb&r=1%202"));
    expect(res.headers.get("location")).toBe("/base?q=a%2Bb&r=1%202");
  });

  it("appends the matched tail for /** targets (base stripped)", async () => {
    const app = createApp({
      "/rules/redirect/wildcard/**": { redirect: "https://h3.dev/**" },
    });
    const res = await app.fetch(new Request("http://test/rules/redirect/wildcard/docs"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("https://h3.dev/docs");
  });

  it("never emits an empty location when the tail is empty", async () => {
    // An empty `Location` is a URI-reference that resolves back to the request
    // URL, so the client would re-request `/old` and loop to the redirect limit.
    const app = createApp({ "/old/**": { redirect: { to: "/**" } } });
    for (const path of ["/old", "/old/"]) {
      const res = await app.fetch(new Request("http://test" + path));
      expect(res.status).toBe(307);
      expect(res.headers.get("location")).toBe("/");
    }
  });

  it("returns 400 for an out-of-scope encoded traversal", async () => {
    const app = createApp({
      "/rules/redirect/wildcard/**": { redirect: "https://h3.dev/**" },
    });
    const res = await app.fetch(new Request("http://test/rules/redirect/wildcard/..%2f..%2fadmin"));
    expect(res.status).toBe(400);
  });

  it("fails closed when the key prefix has no fixed segment count", async () => {
    // The tail is stripped by segment count, so the count has to be the same for
    // every request the key matches. A modifier param makes it vary (`:lang?`
    // matches zero segments or one), and counting it strips the wrong number —
    // dropping a real segment, or leaving a literal prefix segment in the tail
    // and pointing a proxy at a different upstream resource. Reject instead.
    const cases: [string, string[]][] = [
      ["/:lang?/old/**", ["/en/old/a/b", "/old/a/b"]],
      ["/x/:seg*/old/**", ["/x/old/a", "/x/a/old/b", "/x/a/b/old/c"]],
      ["/x/:seg+/old/**", ["/x/a/old/b", "/x/a/b/old/c"]],
      // A group that spans a separator varies the count the same way.
      ["/x{/a}?/:id/old/**", ["/x/1/old/b", "/x/a/1/old/b"]],
    ];
    for (const [key, paths] of cases) {
      const app = createApp({ [key]: { redirect: "/new/**" } });
      for (const path of paths) {
        const res = await app.fetch(new Request("http://test" + path));
        expect(`${key} ${path} -> ${res.status}`).toBe(`${key} ${path} -> 400`);
      }
    }
  });

  it("still strips a fixed-width dynamic prefix", async () => {
    // Every segment of these prefixes matches exactly one path segment, so the
    // count is exact and the tail is forwarded as authored.
    const cases: [string, string, string][] = [
      ["/:lang/old/**", "/en/old/a/b", "/new/a/b"],
      ["/x/*/old/**", "/x/y/old/a", "/new/a"],
      [String.raw`/x/:id(\d+)/old/**`, "/x/12/old/a", "/new/a"],
      // An *intra*-segment group leaves the segment count alone.
      ["/blog{-:title}?/old/**", "/blog-post/old/a", "/new/a"],
    ];
    for (const [key, path, location] of cases) {
      const app = createApp({ [key]: { redirect: "/new/**" } });
      const res = await app.fetch(new Request("http://test" + path));
      expect(`${key} ${path} -> ${res.headers.get("location")}`).toBe(
        `${key} ${path} -> ${location}`,
      );
    }
  });

  it("collapses a leading `//` without a scope base", async () => {
    // A leading `//` after the wildcard prefix must not be forwarded as a
    // protocol-relative URL.
    const app = createApp({ "/**": { redirect: "/**" } });
    const res = await app.fetch(new Request("http://test//evil.com"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).not.toMatch(/^\/\//);
    expect(res.headers.get("location")).toBe("/evil.com");
  });

  it("collapses an *encoded* leading separator (protocol-relative after decode)", async () => {
    // The literal `//` collapse above has an encoded twin: a base-less target's
    // leading `%2f`/`%5c` (or `//%2f`) is opaque to us but a `%2f`-decoding
    // downstream reads `/%2f%2fevil.com` as `//evil.com` — a protocol-relative
    // open redirect. The leading-separator-run collapse must fold every form h3
    // decodes to `/`, mirroring the dual-path decode model, so none escape.
    const app = createApp({ "/**": { redirect: "/**" } });
    for (const raw of ["/%2f%2fevil.com", "/%2fevil.com", "/%5c%5cevil.com", "//%2fevil.com"]) {
      const res = await app.fetch(new Request("http://test" + raw));
      expect(res.status).toBe(307);
      // Must not decode (downstream) to a protocol-relative `//host`.
      expect(canonicalPath(res.headers.get("location")!)).not.toMatch(/^\/\//);
      expect(res.headers.get("location")).toBe("/evil.com");
    }
    // Interior opaque `%2f` is still forwarded verbatim (not a leading leak).
    const kept = await app.fetch(new Request("http://test/a%2fb"));
    expect(kept.headers.get("location")).toBe("/a%2fb");
  });

  it("forwards the raw encoded pathname (opaque %2f)", async () => {
    const app = createApp({
      "/rules/redirect/wildcard/**": { redirect: "https://h3.dev/**" },
    });
    const res = await app.fetch(new Request("http://test/rules/redirect/wildcard/a%2fb"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("https://h3.dev/a%2fb");
  });
});

describe("proxy rule registration", () => {
  it("matcher construction throws when rules use proxy with no handler", () => {
    // `proxy` is an opt-in subpath handler — a proxy rule with no registered
    // handler would silently degrade to a data-only rule (never forwarded), so
    // construction fails loudly instead.
    expect(() => routeRules({ "/api/proxy/**": { proxy: "/api/echo" } })).toThrow(
      /no `proxy` handler is registered/,
    );
    expect(() => routeRules({ "/api/proxy/**": { proxy: "/api/echo" } })).toThrow(
      /h3\/rules\/proxy/,
    );
  });

  it("a rule set with only `proxy: false` resets needs no handler", () => {
    expect(() => routeRules({ "/api/proxy/**": { proxy: false } })).not.toThrow();
  });

  it("explicit `handlers: { proxy: undefined }` keeps the rule data-only", async () => {
    const app = new H3();
    app.use(
      routeRules({ "/api/proxy/**": { proxy: "/api/echo" } }, { handlers: { proxy: undefined } }),
    );
    app.get("/api/proxy/**", (event) => ({ rules: Object.keys(event.context.routeRules || {}) }));
    const res = await app.fetch(new Request("http://test/api/proxy/hello"));
    expect(res.status).toBe(200);
    // The rule is present as data but not acted on (no forwarding).
    expect(await res.json()).toEqual({ rules: ["proxy"] });
  });
});

describe("proxy rule", () => {
  it("proxies to an in-app route with /** tail append", async () => {
    const app = createApp({ "/api/proxy/**": { proxy: "/api/echo/**" } });
    app.get("/api/echo/**", (event) => ({
      path: event.url.pathname,
      q: event.url.search,
    }));
    const res = await app.fetch(new Request("http://test/api/proxy/hello?x=1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ path: "/api/echo/hello", q: "?x=1" });
  });

  it("proxies a non-wildcard target preserving the query", async () => {
    const app = createApp({ "/api/proxy/**": { proxy: "/api/echo" } });
    app.get("/api/echo", (event) => ({ q: event.url.search }));
    const res = await app.fetch(new Request("http://test/api/proxy/anything?x=1"));
    expect(await res.json()).toEqual({ q: "?x=1" });
  });

  it("preserves duplicate keys and encoding on non-wildcard proxy targets", async () => {
    const app = createApp({ "/api/proxy/**": { proxy: "/api/echo" } });
    app.get("/api/echo", (event) => ({ q: event.url.search }));
    const res = await app.fetch(new Request("http://test/api/proxy/x?tag=a&tag=b&q=a%2Bb"));
    expect(await res.json()).toEqual({ q: "?tag=a&tag=b&q=a%2Bb" });
  });

  it("appends request params after a proxy target's baked-in query", async () => {
    const app = createApp({ "/api/proxy/**": { proxy: "/api/echo?fixed=1" } });
    app.get("/api/echo", (event) => ({ q: event.url.search }));
    const res = await app.fetch(new Request("http://test/api/proxy/x?fixed=9&y=2"));
    expect(await res.json()).toEqual({ q: "?fixed=1&fixed=9&y=2" });
    // no request query → target's own query forwarded verbatim
    const bare = await app.fetch(new Request("http://test/api/proxy/x"));
    expect(await bare.json()).toEqual({ q: "?fixed=1" });
  });

  it("forwards the raw encoded pathname (opaque %2f stays one segment)", async () => {
    // Regression (Nitro parity): an opaque `%2f` inside a segment is a single
    // path segment for the upstream too.
    const app = createApp({ "/rules/proxy/legacy/**": { proxy: "/api/wildcard/**" } });
    app.get("/api/wildcard/**", (event) => event.context.params?._ ?? "");
    const res = await app.fetch(new Request("http://test/rules/proxy/legacy/a%2fb"));
    expect(await res.text()).toBe("a%2fb");
  });

  it("returns 400 for an out-of-scope encoded traversal", async () => {
    const app = createApp({ "/rules/proxy/legacy/**": { proxy: "/api/wildcard/**" } });
    const res = await app.fetch(new Request("http://test/rules/proxy/legacy/..%2f..%2fsecret"));
    expect(res.status).toBe(400);
  });

  it("collapses leading slashes after a base-scoped wildcard prefix", async () => {
    // A leading `//` after the wildcard prefix must not be forwarded verbatim
    // to the upstream (protocol-relative URL). With a `base`, the collapse
    // comes from h3's internal `withoutBase`/`joinURL`; the base-less branch of
    // `prepareRuleTarget` is pinned separately below.
    const app = createApp({ "/rules/proxy/legacy/**": { proxy: "/api/wildcard/**" } });
    app.get("/api/wildcard/**", (event) => event.context.params?._ ?? "");
    const res = await app.fetch(new Request("http://test/rules/proxy/legacy//evil.com"));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("evil.com");
  });

  it("collapses a leading `//` for base-less wildcard targets (shared branch)", () => {
    // `prepareRuleTarget` is shared by redirect and proxy; a catch-all proxy
    // rule cannot be exercised end-to-end without proxying to itself, so pin
    // the base-less `//` collapse branch directly.
    const event = { url: new URL("http://test//evil.com") } as Parameters<RuleTargetResolver>[0];
    expect(prepareRuleTarget({ to: "/upstream/**" })?.(event)).toBe("/upstream/evil.com");
    expect(prepareRuleTarget({ to: "/**" })?.(event)).toBe("/evil.com");
  });
});

describe("encoded-separator hardening", () => {
  it("a narrower rule is not bypassed by a percent-encoded path separator", async () => {
    // `secure%2fpage` must still match the `/rules/enc-proxy/secure/**` rule,
    // otherwise the request is forwarded by the broader proxy rule and the
    // downstream decodes `%2f` back to `/`.
    const app = createApp({
      "/rules/enc-proxy/**": { proxy: "/api/echo" },
      "/rules/enc-proxy/secure/**": { headers: { "x-narrow": "1" } },
    });
    app.get("/api/echo", () => "from the upstream");
    const res = await app.fetch(new Request("http://test/rules/enc-proxy/secure%2fpage"));
    expect(res.headers.get("x-narrow")).toBe("1");
  });

  it("a single-wildcard rule is not bypassed by an encoded separator", async () => {
    // h3 routes on the raw path, so `/enc-single/a%2fb` is a single opaque
    // segment there and matches the `/enc-single/*` rule — even though it
    // canonicalizes to the two-segment `/enc-single/a/b`.
    const app = createApp({ "/enc-single/*": { redirect: "/elsewhere" } });
    app.get("/enc-single/:id", () => "ok");
    const res = await app.fetch(new Request("http://test/enc-single/a%2fb"));
    expect(res.status).toBe(307);
  });

  it("a more specific rule revealed by decoding overrides a broader one", async () => {
    const app = createApp({
      "/rules/enc-nested/**": { redirect: "/broad" },
      "/rules/enc-nested/admin/**": { redirect: "/admin" },
    });
    app.get("/rules/enc-nested/**", () => "ok");
    const res = await app.fetch(new Request("http://test/rules/enc-nested/admin%2fpanel"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("/admin");
  });

  it("a `false` reset on a deeper subtree does not strip a rule from the served path", async () => {
    const app = createApp({
      "/rules/enc-strip/**": { redirect: "/broad" },
      "/rules/enc-strip/off/**": { redirect: false },
    });
    app.get("/rules/enc-strip/**", () => "ok");
    // Raw single opaque segment: the broad rule still applies…
    const opaque = await app.fetch(new Request("http://test/rules/enc-strip/off%2fx"));
    expect(opaque.status).toBe(307);
    expect(opaque.headers.get("location")).toBe("/broad");
    // …while the genuine two-segment path is reset as configured.
    const reset = await app.fetch(new Request("http://test/rules/enc-strip/off/x"));
    expect(reset.status).toBe(200);
  });

  it("a %5c separator variant is covered too", async () => {
    // `%5c` stays opaque in `event.url.pathname` (canonicalization never decodes
    // a separator), so this reaches the matcher as `/app/admin%5cpanel` — raw
    // matching sees only `/app/**`, and the narrower rule comes from the
    // dual-path reading (`decodeSlashes` resolves it to `/app/admin/panel`). A
    // downstream that decodes the backslash reaches the admin area otherwise.
    const app = createApp({
      "/app/**": { headers: { "x-app": "1" } },
      "/app/admin/**": { redirect: "/admin" },
    });
    app.get("/app/**", () => "ok");
    const res = await app.fetch(new Request("http://test/app/admin%5cpanel"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("/admin");
  });

  it("a single-wildcard headers rule still applies to an encoded separator", async () => {
    const app = createApp({ "/single-headers/*": { headers: { "x-single": "single" } } });
    app.get("/single-headers/:id", () => "ok");
    const res = await app.fetch(new Request("http://test/single-headers/a%2fb"));
    expect(res.status).toBe(200);
    expect(res.headers.get("x-single")).toBe("single");
  });

  it("returns 400 when an encoded separator sits inside the scope base (proxy)", async () => {
    // `/rules/proxy%2flegacy/foo` canonicalizes into scope, but the raw path
    // does not literally sit under `/rules/proxy/legacy` — the base cannot be
    // stripped from the raw path, so it must fail closed instead of forwarding
    // the un-stripped path (base doubled) to the upstream.
    const app = createApp({ "/rules/proxy/legacy/**": { proxy: "/api/wildcard/**" } });
    app.get("/api/wildcard/**", (event) => event.context.params?._ ?? "");
    const res = await app.fetch(new Request("http://test/rules/proxy%2flegacy/foo"));
    expect(res.status).toBe(400);
  });

  it("returns 400 when an encoded separator sits inside the scope base (redirect)", async () => {
    const app = createApp({ "/rules/redirect/wildcard/**": { redirect: "https://h3.dev/**" } });
    const res = await app.fetch(new Request("http://test/rules/redirect%2fwildcard/docs"));
    expect(res.status).toBe(400);
  });

  it("returns 400 for an encoded pre-base traversal (canonicalizes into scope)", async () => {
    // `/..%2frules%2fproxy%2flegacy%2fsecret` canonicalizes to
    // `/rules/proxy/legacy/secret` (in scope), but forwarding the raw path
    // would hand the encoded `..` traversal to the upstream.
    const app = createApp({ "/rules/proxy/legacy/**": { proxy: "/api/wildcard/**" } });
    app.get("/api/wildcard/**", (event) => event.context.params?._ ?? "");
    const res = await app.fetch(new Request("http://test/..%2frules%2fproxy%2flegacy%2fsecret"));
    expect(res.status).toBe(400);
  });

  it("returns 400 for a doubled-slash encoded traversal (post-strip escape)", async () => {
    // Regression: the incoming path
    // `/rules/proxy/legacy//..%2fadmin` canonicalizes to
    // `/rules/proxy/legacy/admin` — the empty `//` segment absorbs the `..`, so
    // it looks in-scope. But stripping the base and rejoining collapses that
    // empty segment, leaving `/api/wildcard/..%2fadmin`, which escapes the
    // upstream base once the downstream decodes `%2f`. The final-target scope
    // check must reject it before forwarding — in every equivalent shape.
    const app = createApp({ "/rules/proxy/legacy/**": { proxy: "/api/wildcard/**" } });
    app.get("/api/wildcard/**", (event) => event.context.params?._ ?? "");
    for (const path of [
      "/rules/proxy/legacy//..%2fadmin", // doubled slash
      "/rules/proxy/legacy//..%2Fadmin", // mixed-case %2F
      "/rules/proxy/legacy//..%252fadmin", // doubled + double-encoded
      "/rules/proxy/legacy//..%255c..%255cwin", // doubled + encoded backslash
    ]) {
      const res = await app.fetch(new Request("http://test" + path));
      expect(res.status).toBe(400);
    }
  });

  it("returns 400 for a mid-path doubled-slash escape (slash-merging downstream)", async () => {
    // The doubled slash sits *after* a real segment beyond the base, so
    // `withoutBase` does not collapse it and h3's canonicalization lets the
    // empty segment shield the following `..` (looks in-scope). A downstream
    // that merges slashes would drop the empty and let `..` escape, so the
    // scope check must reject it — including the encoded-empty (`%2f%2f`) shape.
    const app = createApp({ "/rules/proxy/legacy/**": { proxy: "/api/wildcard/**" } });
    app.get("/api/wildcard/**", (event) => event.context.params?._ ?? "");
    // Note: `%2f`/`%5c` stay opaque in `event.url.pathname` (the library's threat
    // model), so all of these reach the scope check raw — including the `%5c`
    // spelling, which a backslash-aware downstream resolves the same way.
    for (const path of [
      "/rules/proxy/legacy/a//..%2f..%2fc",
      "/rules/proxy/legacy/a//..%252f..%252fc",
      "/rules/proxy/legacy/a%2f%2f..%2f..%2fc",
      "/rules/proxy/legacy/a//..%5c..%5cc",
      "/rules/proxy/legacy/a%5c%5c..%5c..%5cc",
    ]) {
      const res = await app.fetch(new Request("http://test" + path));
      expect(res.status).toBe(400);
    }
  });
});

// A `/**` proxy/redirect target must
// keep the forwarded upstream request within the target's own base regardless
// of how the incoming path is shaped. The scope check runs on the *final*
// resolved target — after the base is stripped and the remainder rejoined — so
// equivalent inputs (repeated/leading slashes, `/./`, mixed-case or
// double-encoded separators) cannot diverge from what actually gets forwarded.
describe("prepareRuleTarget final-target scope", () => {
  const opts = { to: "http://upstream/orders/**", base: "/api/orders" };
  const evt = (raw: string) =>
    ({ url: new URL("http://localhost" + raw) }) as Parameters<RuleTargetResolver>[0];
  const resolve = (raw: string) => prepareRuleTarget(opts)?.(evt(raw));
  const blocked = (raw: string) => {
    try {
      resolve(raw);
    } catch (error: any) {
      if (error?.status === 400) {
        return true;
      }
      throw error; // surface unexpected failures instead of reporting "not blocked"
    }
    return false;
  };

  it("forwards benign in-scope requests unchanged", () => {
    expect(resolve("/api/orders/list.json")).toBe("http://upstream/orders/list.json");
    expect(new URL(resolve("/api/orders/123?x=1")!).pathname).toBe("/orders/123");
    // an encoded separator inside a segment stays opaque and in-scope
    expect(resolve("/api/orders/foo%2f..%2fbar")).toBe("http://upstream/orders/foo%2f..%2fbar");
  });

  it("blocks encoded traversal in every equivalent shape", () => {
    expect(blocked("/api/orders/..%2fadmin%2fconfig.json")).toBe(true); // single slash
    expect(blocked("/api/orders//..%2fadmin%2fconfig.json")).toBe(true); // doubled slash
    expect(blocked("/api/orders/..%2Fadmin")).toBe(true); // mixed-case %2F
    expect(blocked("/api/orders//..%252fadmin")).toBe(true); // doubled + double-encoded
    expect(blocked("/api/orders/%2e%2e%2fadmin")).toBe(true); // encoded dot-segment
    expect(blocked("/api/orders//..%255c..%255cwin")).toBe(true); // doubled + encoded backslash
    // mid-path doubled slash beyond the base (slash-merging downstream escape)
    expect(blocked("/api/orders/a//..%2f..%2fc")).toBe(true);
    expect(blocked("/api/orders/a%2f%2f..%2f..%2fc")).toBe(true); // encoded empty segment
  });

  it("never resolves a /** target outside the configured base", () => {
    for (const raw of [
      "/api/orders/list.json",
      "/api/orders/",
      "/api/orders//..%2fadmin",
      "/api/orders//..%2f..%2fetc%2fpasswd",
      "/api/orders/foo%2f..%2fbar",
      "/api/orders/a//b%2f..%2f..%2fc",
      "/api/orders//..%255c..%255cwin",
      "/api/orders/%2e%2e%2f%2e%2e%2froot",
    ]) {
      let target: string | undefined;
      try {
        target = resolve(raw);
      } catch (error: any) {
        expect(error?.status).toBe(400); // out-of-scope inputs are rejected
        continue;
      }
      // whatever is forwarded must canonicalize within the upstream base
      expect(isPathInScope(new URL(target!).pathname, "/orders")).toBe(true);
    }
  });
});

describe("method-scoped rules (end-to-end)", () => {
  it("apply only to their method", async () => {
    const app = createApp({ "GET /api/**": { headers: { "x-m": "get" } } });
    app.get("/api/x", () => "get");
    app.post("/api/x", () => "post");
    const get = await app.fetch(new Request("http://test/api/x"));
    expect(get.headers.get("x-m")).toBe("get");
    const post = await app.fetch(new Request("http://test/api/x", { method: "POST" }));
    expect(post.headers.get("x-m")).toBeNull();
  });

  it("a GET-scoped short-circuiting rule is not bypassable with HEAD", async () => {
    // h3 serves HEAD from the GET route (`~findRoute` falls back, RFC 9110), so
    // a GET-scoped rule must apply to HEAD too — otherwise the handler runs
    // unruled (headers, and any side effect it performs, still reach the client).
    const app = createApp({ "GET /admin/**": { redirect: "/elsewhere" } });
    app.get("/admin/x", (event) => {
      event.res.headers.set("x-ran", "1");
      return "from the handler";
    });
    const head = await app.fetch(new Request("http://test/admin/x", { method: "HEAD" }));
    expect(head.status).toBe(307);
    expect(head.headers.get("x-ran")).toBeNull();
    const get = await app.fetch(new Request("http://test/admin/x"));
    expect(get.status).toBe(307);
  });

  it("GET-scoped rules apply to HEAD, and HEAD-scoped rules still override them", async () => {
    const app = createApp({
      "GET /api/**": { headers: { "x-m": "get", "x-get-only": "1" } },
      "HEAD /api/**": { headers: { "x-m": "head" } },
    });
    app.get("/api/x", () => "ok");
    const head = await app.fetch(new Request("http://test/api/x", { method: "HEAD" }));
    expect(head.headers.get("x-m")).toBe("head"); // HEAD layer wins
    expect(head.headers.get("x-get-only")).toBe("1"); // …merged over the GET layer
    const get = await app.fetch(new Request("http://test/api/x"));
    expect(get.headers.get("x-m")).toBe("get"); // HEAD rules never leak into GET
  });

  it("the HEAD fallback holds under preMerge", async () => {
    // preMerge resolves each pattern's chain at startup over a `method × path`
    // matrix, so the HEAD registration must exist before that analysis runs.
    const app = createApp(
      {
        "GET /admin/**": { redirect: "/elsewhere" },
        "/admin/**": { headers: { "x-all": "1" } },
      },
      { preMerge: true },
    );
    app.get("/admin/x", () => "from the handler");
    const head = await app.fetch(new Request("http://test/admin/x", { method: "HEAD" }));
    expect(head.status).toBe(307);
    // …and the method-agnostic layer still merges into the HEAD registration.
    expect(head.headers.get("x-all")).toBe("1");
  });

  it("only GET falls back — other method-scoped rules stay scoped for HEAD", async () => {
    const app = createApp({ "POST /api/**": { headers: { "x-m": "post" } } });
    app.get("/api/x", () => "ok");
    const head = await app.fetch(new Request("http://test/api/x", { method: "HEAD" }));
    expect(head.headers.get("x-m")).toBeNull();
  });

  it("a method-scoped rule is not bypassable with a lowercase/mixed-case method", async () => {
    // Rule keys are uppercased at parse time (internal/key.ts), so the lookup
    // method must be too: rou3 resolves `methods[method] || methods[""]` and a
    // method-scoped rule never populates `methods[""]`, making a case mismatch a
    // *total* miss that fails OPEN over a method-agnostic route (`app.all`, and
    // every `app.mount()` base, which registers `all(base + "/**")`).
    //
    // Reachable on every runtime: the Fetch spec only byte-uppercases
    // DELETE/GET/HEAD/OPTIONS/POST/PUT, so `patch`/`query` reach the app
    // verbatim (raw-socket parsers that forward the token expose the six too).
    const app = createApp({
      "PATCH /admin/**": { redirect: "/elsewhere" },
      "QUERY /admin/**": { redirect: "/elsewhere" },
    });
    let ran = 0;
    app.all("/admin/**", () => {
      ran++;
      return "from the handler";
    });
    for (const method of ["PATCH", "patch", "PaTcH", "QUERY", "query", "QuErY"]) {
      const res = await app.fetch(new Request("http://test/admin/x", { method }));
      expect([method, res.status, ran]).toEqual([method, 307, 0]);
    }
    // …and a method the rule is not scoped to still reaches the handler.
    const post = await app.fetch(new Request("http://test/admin/x", { method: "POST" }));
    expect([post.status, ran]).toEqual([200, 1]);
  });

  it("a lowercase method resolves the same layers as its canonical spelling", async () => {
    // Normalization must not stop at gates: header/scope resolution has to agree
    // too, and a differently-cased method must not pick up another method's rules.
    const app = createApp({
      "/api/**": { headers: { "x-all": "1" } },
      "PATCH /api/**": { headers: { "x-m": "patch" } },
      "POST /api/**": { headers: { "x-m": "post" } },
    });
    app.all("/api/x", () => "ok");
    for (const method of ["PATCH", "patch", "PaTcH"]) {
      const res = await app.fetch(new Request("http://test/api/x", { method }));
      expect([method, res.headers.get("x-m"), res.headers.get("x-all")]).toEqual([
        method,
        "patch",
        "1",
      ]);
    }
  });

  it("path-only rules apply to every method spelling", async () => {
    // Unaffected by the method lookup (they live under rou3's `methods[""]`) —
    // pinned so a normalization regression cannot go unnoticed here either.
    const app = createApp({ "/admin/**": { redirect: "/elsewhere" } });
    let ran = 0;
    app.all("/admin/**", () => (ran++, "from the handler"));
    for (const method of ["GET", "PATCH", "patch", "query"]) {
      const res = await app.fetch(new Request("http://test/admin/x", { method }));
      expect([method, res.status]).toEqual([method, 307]);
    }
    expect(ran).toBe(0);
  });
});

describe("method-scoped cors preflight", () => {
  const preflight = (path: string, method = "PUT") =>
    new Request(`http://test${path}`, {
      method: "OPTIONS",
      headers: {
        origin: "https://example.com",
        "access-control-request-method": method,
      },
    });

  it("answers a preflight for a cors rule scoped to the requested method", async () => {
    // The preflight itself is an OPTIONS request, so a `PUT /api/**` cors rule
    // would never be constructed for it and the browser would fail the actual
    // request — the rule must be resolved against `access-control-request-method`.
    const app = createApp({ "PUT /api/**": { cors: { origin: ["https://example.com"] } } });
    app.put("/api/x", () => "ok");
    const res = await app.fetch(preflight("/api/x"));
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("https://example.com");
  });

  it("lifts only `cors` from the preflight lookup (no other rule)", async () => {
    // Browsers send preflights without credentials, so lifting any other
    // method-scoped rule out of that lookup — a redirect, a gate an app layers on
    // top — would answer the preflight with it and break CORS entirely.
    const app = createApp({
      "PUT /api/**": {
        cors: { origin: ["https://example.com"] },
        redirect: "/elsewhere",
        headers: { "x-lifted": "1" },
      },
    });
    app.put("/api/x", () => "ok");
    const res = await app.fetch(preflight("/api/x"));
    expect(res.status).toBe(204);
    expect(res.headers.get("x-lifted")).toBeNull();
    expect(res.headers.get("location")).toBeNull();
    // …while the real PUT still runs the method-scoped rules.
    const real = await app.fetch(
      new Request("http://test/api/x", { method: "PUT", headers: { origin: "https://a" } }),
    );
    expect(real.status).toBe(307);
    expect(real.headers.get("x-lifted")).toBe("1");
  });

  it("prefers the requested method's cors policy over an OPTIONS-visible one", async () => {
    const app = createApp({
      "/api/**": { cors: { origin: ["https://broad.com"] } },
      "PUT /api/**": { cors: { origin: ["https://example.com"] } },
    });
    app.put("/api/x", () => "ok");
    const res = await app.fetch(preflight("/api/x"));
    expect(res.headers.get("access-control-allow-origin")).toBe("https://example.com");
  });

  it("leaves a plain OPTIONS request (no preflight header) alone", async () => {
    const app = createApp({ "PUT /api/**": { cors: true } });
    app.on("OPTIONS", "/api/x", () => "options");
    const res = await app.fetch(new Request("http://test/api/x", { method: "OPTIONS" }));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("options");
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("exposes the lifted cors rule on event.context.routeRules", async () => {
    // The preflight is answered by the cors rule, but a `cors: false` reset on a
    // more specific pattern must still win for the requested method.
    const app = createApp({
      "PUT /api/**": { cors: { origin: ["https://example.com"] } },
      "PUT /api/off": { cors: false },
    });
    app.put("/api/off", () => "ok");
    const res = await app.fetch(preflight("/api/off"));
    expect(res.status).not.toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });
});

describe("matcher options", () => {
  it("prefixes patterns with baseURL (trailing slash trimmed)", async () => {
    const app = createApp({ "/x": { headers: { "x-a": "1" } } }, { baseURL: "/base/" });
    app.get("/base/x", () => "ok");
    const res = await app.fetch(new Request("http://test/base/x"));
    expect(res.headers.get("x-a")).toBe("1");
    // no match outside the base
    const app2 = createApp({ "/x": { headers: { "x-a": "1" } } }, { baseURL: "/base/" });
    app2.get("/x", () => "ok");
    const res2 = await app2.fetch(new Request("http://test/x"));
    expect(res2.headers.get("x-a")).toBeNull();
  });

  it("composes baseURL into the wildcard redirect scope base", async () => {
    // The scope check runs against the full request path (baseURL included) —
    // without composition every in-scope request would 400.
    const app = createApp({ "/old/**": { redirect: "/new/**" } }, { baseURL: "/base" });
    const res = await app.fetch(new Request("http://test/base/old/x"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("/new/x");
    // out-of-scope traversal under the mounted base still throws
    const traversal = await app.fetch(new Request("http://test/base/old/..%2f..%2fsecret"));
    expect(traversal.status).toBe(400);
  });

  it("composes baseURL into the wildcard proxy scope base", async () => {
    const app = createApp({ "/p/**": { proxy: "/api/echo/**" } }, { baseURL: "/base" });
    app.get("/api/echo/**", (event) => event.url.pathname);
    const res = await app.fetch(new Request("http://test/base/p/hello"));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("/api/echo/hello");
  });

  it("composes baseURL into a *dynamic* wildcard proxy scope base", async () => {
    // `base` stays rou3 pattern text (`/mount/:tenant/p`), and the effective
    // base is derived per request from its segment count — so plain prefix
    // concatenation with `baseURL` must keep the counts adding up (no extra or
    // missing separator, no normalization of `:`).
    const app = createApp({ "/:tenant/p/**": { proxy: "/api/echo/**" } }, { baseURL: "/mount" });
    app.get("/api/echo/**", (event) => event.url.pathname);
    const res = await app.fetch(new Request("http://test/mount/acme/p/hello"));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("/api/echo/hello");
    // …and traversal out of the mounted, tenant-scoped base is still rejected.
    const traversal = await app.fetch(
      new Request("http://test/mount/acme/p/..%2f..%2f..%2fsecret"),
    );
    expect(traversal.status).toBe(400);
  });

  it("custom handlers extend the registry", async () => {
    const app = createApp(
      { "/x": { shout: "hello" } },
      {
        handlers: {
          shout: {
            handler: (m) => (event) => {
              event.res.headers.set("x-shout", String(m.options).toUpperCase());
            },
          },
        },
      },
    );
    app.get("/x", () => "ok");
    const res = await app.fetch(new Request("http://test/x"));
    expect(res.headers.get("x-shout")).toBe("HELLO");
  });

  it("setting a built-in handler to undefined makes the rule data-only", async () => {
    const app = createApp({ "/x": { redirect: "/y" } }, { handlers: { redirect: undefined } });
    app.get("/x", (event) => ({ redirect: event.context.routeRules?.redirect }));
    const res = await app.fetch(new Request("http://test/x"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ redirect: { to: "/y", status: 307 } });
  });
});
