import { H3 } from "../../src/index.ts";
import { describe, expect, it } from "vitest";
import { routeRules } from "../../src/rules/middleware.ts";
import { canonicalPath, isPathInScope } from "../../src/rules/internal/scope.ts";
import { proxy } from "../../src/rules/proxy.ts";
import { resolveRuleTarget } from "../../src/rules/handlers/_utils.ts";
import type { RouteRuleConfig } from "../../src/rules/types.ts";
import type { RouteRulesMatcherOptions } from "../../src/rules/match.ts";

// `proxy` is an opt-in subpath handler (`h3/rules/proxy`) — register it by
// default so the proxy-rule cases below construct, while letting a test override.
const createApp = (config: Record<string, RouteRuleConfig>, opts?: RouteRulesMatcherOptions) => {
  const app = new H3();
  app.use(routeRules(config, { ...opts, handlers: { proxy, ...opts?.handlers } }));
  return app;
};

const basic = (user: string, pass: string) => "Basic " + btoa(`${user}:${pass}`);

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

  it("preflight short-circuits before basicAuth (browsers send no credentials)", async () => {
    const app = createApp({
      "/api/**": { cors: true, basicAuth: { username: "u", password: "p" } },
    });
    app.get("/api/x", () => "ok");
    // Preflight OPTIONS: answered by cors (204), never hitting the auth gate.
    const preflight = await app.fetch(
      new Request("http://test/api/x", {
        method: "OPTIONS",
        headers: { origin: "https://example.com", "access-control-request-method": "GET" },
      }),
    );
    expect(preflight.status).toBe(204);
    // A real (non-preflight) request is still gated by basicAuth.
    const guarded = await app.fetch(
      new Request("http://test/api/x", { headers: { origin: "https://example.com" } }),
    );
    expect(guarded.status).toBe(401);
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

  it("returns 400 for an out-of-scope encoded traversal", async () => {
    const app = createApp({
      "/rules/redirect/wildcard/**": { redirect: "https://h3.dev/**" },
    });
    const res = await app.fetch(new Request("http://test/rules/redirect/wildcard/..%2f..%2fadmin"));
    expect(res.status).toBe(400);
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
    // `resolveRuleTarget` is pinned separately below.
    const app = createApp({ "/rules/proxy/legacy/**": { proxy: "/api/wildcard/**" } });
    app.get("/api/wildcard/**", (event) => event.context.params?._ ?? "");
    const res = await app.fetch(new Request("http://test/rules/proxy/legacy//evil.com"));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("evil.com");
  });

  it("collapses a leading `//` for base-less wildcard targets (shared branch)", () => {
    // `resolveRuleTarget` is shared by redirect and proxy; a catch-all proxy
    // rule cannot be exercised end-to-end without proxying to itself, so pin
    // the base-less `//` collapse branch directly.
    const event = { url: new URL("http://test//evil.com") } as Parameters<
      typeof resolveRuleTarget
    >[0];
    expect(resolveRuleTarget(event, { to: "/upstream/**" })).toBe("/upstream/evil.com");
    expect(resolveRuleTarget(event, { to: "/**" })).toBe("/evil.com");
  });
});

describe("basicAuth rule", () => {
  const AUTH_RULES: Record<string, RouteRuleConfig> = {
    "/rules/basic-auth/**": {
      basicAuth: { username: "admin", password: "secret", realm: "Secure Area" },
    },
    "/rules/basic-auth/no-auth/**": { basicAuth: false },
  };

  it("rejects requests without credentials", async () => {
    const app = createApp(AUTH_RULES);
    app.get("/rules/basic-auth/**", () => "ok");
    const res = await app.fetch(new Request("http://test/rules/basic-auth/test"));
    expect(res.status).toBe(401);
    // h3 only echoes the realm once credentials were presented
    expect(res.headers.get("www-authenticate")).toMatch(/^Basic realm=/);
  });

  it("rejects requests with bad creds", async () => {
    const app = createApp(AUTH_RULES);
    app.get("/rules/basic-auth/**", () => "ok");
    const res = await app.fetch(
      new Request("http://test/rules/basic-auth/test", {
        headers: { Authorization: basic("user", "wrongpass") },
      }),
    );
    expect(res.status).toBe(401);
    // Prefix-matched, not exact: the realm is what these tests are about, while the
    // rest of the challenge belongs to h3's `basicAuth` (rc.26 appended RFC 7617
    // `charset="UTF-8"`), so don't pin h3's exact header formatting here.
    expect(res.headers.get("www-authenticate")).toMatch(/^Basic realm="Secure Area"/);
  });

  it("allows request with correct password", async () => {
    const app = createApp(AUTH_RULES);
    app.get("/rules/basic-auth/**", () => "ok");
    const res = await app.fetch(
      new Request("http://test/rules/basic-auth/test", {
        headers: { Authorization: basic("admin", "secret") },
      }),
    );
    expect(res.status).toBe(200);
  });

  it("disabled basic-auth for sub-rules", async () => {
    const app = createApp(AUTH_RULES);
    app.get("/rules/basic-auth/**", () => "ok");
    const res = await app.fetch(new Request("http://test/rules/basic-auth/no-auth/x"));
    expect(res.status).toBe(200);
  });

  it("runs before a redirect rule from a less specific layer", async () => {
    const app = createApp({
      "/rules/ba-redirect/**": { redirect: "/base" },
      "/rules/ba-redirect/secure/**": {
        basicAuth: { username: "admin", password: "secret", realm: "Secure Area" },
      },
    });
    const res = await app.fetch(
      new Request("http://test/rules/ba-redirect/secure/page", {
        headers: { Authorization: basic("user", "wrongpass") },
      }),
    );
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toMatch(/^Basic realm="Secure Area"/);
    expect(res.headers.get("location")).toBeNull();
  });

  it("runs before a proxy rule from a less specific layer", async () => {
    const app = createApp({
      "/rules/ba-proxy/**": { proxy: "/api/echo" },
      "/rules/ba-proxy/secure/**": {
        basicAuth: { username: "admin", password: "secret", realm: "Secure Area" },
      },
    });
    app.get("/api/echo", () => "leaked");
    const res = await app.fetch(
      new Request("http://test/rules/ba-proxy/secure/page", {
        headers: { Authorization: basic("user", "wrongpass") },
      }),
    );
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toMatch(/^Basic realm="Secure Area"/);
  });
});

describe("encoded-separator hardening", () => {
  it("auth is not bypassed by a percent-encoded path separator", async () => {
    // `secure%2fpage` must still match the `/rules/ba-proxy/secure/**` auth
    // rule, otherwise the request is forwarded by the broader proxy rule with
    // no credentials and the downstream decodes `%2f` back to `/`.
    const app = createApp({
      "/rules/ba-proxy/**": { proxy: "/api/echo" },
      "/rules/ba-proxy/secure/**": {
        basicAuth: { username: "admin", password: "secret", realm: "Secure Area" },
      },
    });
    app.get("/api/echo", () => "leaked");
    const res = await app.fetch(
      new Request("http://test/rules/ba-proxy/secure%2fpage", {
        headers: { Authorization: basic("user", "wrongpass") },
      }),
    );
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toMatch(/^Basic realm="Secure Area"/);
  });

  it("a single-wildcard auth rule is not bypassed by an encoded separator", async () => {
    // h3 routes on the raw path, so `/ba-single/a%2fb` is a single opaque
    // segment there and matches the `/ba-single/*` auth rule — even though it
    // canonicalizes to the two-segment `/ba-single/a/b`.
    const app = createApp({
      "/ba-single/*": {
        basicAuth: { username: "admin", password: "secret", realm: "Secure Area" },
      },
    });
    app.get("/ba-single/:id", () => "ok");
    const res = await app.fetch(
      new Request("http://test/ba-single/a%2fb", {
        headers: { Authorization: basic("user", "wrongpass") },
      }),
    );
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toMatch(/^Basic realm="Secure Area"/);
  });

  it("a more specific auth rule revealed by decoding overrides a broader one", async () => {
    const app = createApp({
      "/rules/ba-nested/**": {
        basicAuth: { username: "broad", password: "secret", realm: "Broad Area" },
      },
      "/rules/ba-nested/admin/**": {
        basicAuth: { username: "admin", password: "secret", realm: "Admin Area" },
      },
    });
    app.get("/rules/ba-nested/**", () => "ok");
    const res = await app.fetch(
      new Request("http://test/rules/ba-nested/admin%2fpanel", {
        headers: { Authorization: basic("broad", "secret") },
      }),
    );
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toMatch(/^Basic realm="Admin Area"/);
  });

  it("a single-segment `false` cannot dodge auth once decoded to multiple segments", async () => {
    const app = createApp({
      "/rules/ba-off/**": {
        basicAuth: { username: "admin", password: "secret", realm: "Off Area" },
      },
      "/rules/ba-off/*": { basicAuth: false },
    });
    app.get("/rules/ba-off/**", () => "ok");
    const res = await app.fetch(
      new Request("http://test/rules/ba-off/a%2fb", {
        headers: { Authorization: basic("user", "wrongpass") },
      }),
    );
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toMatch(/^Basic realm="Off Area"/);
  });

  it("a `false` reset on a deeper subtree does not strip auth from the served path", async () => {
    const app = createApp({
      "/rules/ba-strip/**": {
        basicAuth: { username: "admin", password: "secret", realm: "Strip Area" },
      },
      "/rules/ba-strip/off/**": { basicAuth: false },
    });
    app.get("/rules/ba-strip/**", () => "ok");
    const res = await app.fetch(
      new Request("http://test/rules/ba-strip/off%2fx", {
        headers: { Authorization: basic("user", "wrongpass") },
      }),
    );
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toMatch(/^Basic realm="Strip Area"/);
  });

  it("a %5c separator variant is guarded too (h3 decodes %5c upstream)", async () => {
    // srvx/h3 already decode `%5c` to `/` in `event.url.pathname`, so this
    // request reaches the matcher as `/app/admin/panel` and is guarded by
    // plain raw-path matching — no dual-path resolution involved. The
    // matcher-level `%5c` dual-path pin lives in merge.test.ts
    // ("dual-path union").
    const app = createApp({
      "/app/**": { headers: { "x-app": "1" } },
      "/app/admin/**": {
        basicAuth: { username: "admin", password: "secret", realm: "Admin" },
      },
    });
    app.get("/app/**", () => "ok");
    const res = await app.fetch(new Request("http://test/app/admin%5cpanel"));
    expect(res.status).toBe(401);
  });

  it("a single-wildcard non-auth rule still applies to an encoded separator", async () => {
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
    // Note: `%2f` stays opaque in `event.url.pathname` (the library's threat
    // model), so these reach the scope check raw. A `%5c` variant is omitted
    // here because srvx pre-normalizes backslashes at the URL layer (resolving
    // it to a benign in-scope path before the rules middleware runs); `test/scope.test.ts`
    // still covers `%5c` as a defensive `isPathInScope` input.
    for (const path of [
      "/rules/proxy/legacy/a//..%2f..%2fc",
      "/rules/proxy/legacy/a//..%252f..%252fc",
      "/rules/proxy/legacy/a%2f%2f..%2f..%2fc",
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
describe("resolveRuleTarget final-target scope", () => {
  const opts = { to: "http://upstream/orders/**", base: "/api/orders" };
  const evt = (raw: string) =>
    ({ url: new URL("http://localhost" + raw) }) as Parameters<typeof resolveRuleTarget>[0];
  const resolve = (raw: string) => resolveRuleTarget(evt(raw), opts);
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
    app.get("/x", (event) => ({ redirect: event.context.routeRules?.redirect?.options }));
    const res = await app.fetch(new Request("http://test/x"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ redirect: { to: "/y", status: 307 } });
  });
});
