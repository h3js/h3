import { H3, setCookie } from "../../src/index.ts";
import type { EventHandler } from "../../src/index.ts";
import { describe, expect, it, vi } from "vitest";
import { routeRules } from "../../src/rules/middleware.ts";
import type { RouteRuleConfig, RuleHandler } from "../../src/rules/types.ts";
import { createCacheRuleHandler } from "../../src/rules/handlers/cache.ts";
import { cache, createOcacheRuleHandler } from "../../src/rules/cache.ts";
import type { OcacheRuleHandlerOptions } from "../../src/rules/cache.ts";

const createApp = (config: Record<string, RouteRuleConfig>, cacheHandler: RuleHandler<"cache">) => {
  const app = new H3();
  app.use(routeRules(config, { handlers: { cache: cacheHandler } }));
  return app;
};

// Core injection path: a matcher-scoped handler around a mock implementation.
const createInjectedApp = (
  config: Record<string, RouteRuleConfig>,
  opts: Parameters<typeof createCacheRuleHandler>[0],
) => createApp(config, createCacheRuleHandler(opts));

describe("cache rule registration", () => {
  it("matcher construction throws when rules use cache/swr with no handler", () => {
    expect(() => routeRules({ "/cached/**": { swr: 60 } })).toThrow(
      /no `cache` handler is registered/,
    );
    expect(() => routeRules({ "/cached/**": { cache: { maxAge: 60 } } })).toThrow(
      /h3\/rules\/cache/,
    );
  });

  it("a rule set with only `cache: false` resets needs no handler", () => {
    // Nothing to wrap — no middleware could ever be built from a bare reset.
    expect(() => routeRules({ "/cached/**": { cache: false } })).not.toThrow();
  });

  it("explicit `handlers: { cache: undefined }` keeps the rule data-only", async () => {
    const app = new H3();
    app.use(routeRules({ "/cached/**": { swr: 60 } }, { handlers: { cache: undefined } }));
    app.get("/cached/:id", (event) => ({
      cache: event.context.routeRules?.cache,
    }));
    const res = await app.fetch(new Request("http://test/cached/a"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ cache: { swr: true, maxAge: 60 } });
  });
});

// NOTE: keep this describe *before* the storage test at the end of the
// ocache-backed block — that test swaps ocache's process-global storage.
describe("cache rule (isolation & credential safety)", () => {
  it("never serves one app's cached body to another app (F2, shared `cache` export)", async () => {
    // The `cache` export of `h3/rules/cache` is module-scoped: every app in the
    // process registers the same handler instance. Identical rule pattern +
    // identical matched route must NOT resolve to the same storage entry —
    // `integrity` cannot save us (ohash serializes a function by source, so two
    // apps whose route handlers share a source text hash identically), and with
    // `swr` a mismatch serves the *stale* — i.e. the other app's — body anyway.
    const mkApp = (secret: string) => {
      const app = new H3();
      app.use(routeRules({ "/leak/**": { swr: 60 } }, { handlers: { cache } }));
      app.get("/leak/me", () => ({ secret }));
      return app;
    };

    const a = await mkApp("APP-A-SECRET").fetch(new Request("http://test/leak/me"));
    expect(await a.json()).toEqual({ secret: "APP-A-SECRET" });

    const b = await mkApp("APP-B-SECRET").fetch(new Request("http://test/leak/me"));
    expect(b.headers.get("x-cache")).toBe("MISS");
    expect(await b.json()).toEqual({ secret: "APP-B-SECRET" });
  });

  it("never shares cache entries between two handler instances (F2, per-instance)", async () => {
    const mkApp = (secret: string) => {
      const app = new H3();
      app.use(
        routeRules(
          { "/leak-inst/**": { cache: { maxAge: 60 } } },
          { handlers: { cache: createOcacheRuleHandler() } },
        ),
      );
      app.get("/leak-inst/me", () => ({ secret }));
      return app;
    };

    const a = await mkApp("INST-A").fetch(new Request("http://test/leak-inst/me"));
    expect(await a.json()).toEqual({ secret: "INST-A" });

    const b = await mkApp("INST-B").fetch(new Request("http://test/leak-inst/me"));
    expect(b.headers.get("x-cache")).toBe("MISS");
    expect(await b.json()).toEqual({ secret: "INST-B" });
  });

  it("shares entries again when an explicit `id` opts into a stable key (F2)", async () => {
    // Escape hatch for persistent storage: an explicit `id` makes the key stable
    // across handler instances (and processes). Two instances with the same `id`
    // are declared to serve the same app, so they may share.
    let calls = 0;
    const mkApp = () => {
      const app = new H3();
      app.use(
        routeRules(
          { "/leak-id/**": { cache: { maxAge: 60 } } },
          { handlers: { cache: createOcacheRuleHandler({ id: "stable-app-id" }) } },
        ),
      );
      app.get("/leak-id/me", () => ({ calls: ++calls }));
      return app;
    };

    expect(await (await mkApp().fetch(new Request("http://test/leak-id/me"))).json()).toEqual({
      calls: 1,
    });
    const second = await mkApp().fetch(new Request("http://test/leak-id/me"));
    expect(second.headers.get("x-cache")).toBe("HIT");
    expect(await second.json()).toEqual({ calls: 1 });
  });

  it("does not let a HEAD request poison the GET cache entry (F3)", async () => {
    // h3 serves HEAD from the GET route and h3's `toResponse` strips the body
    // for HEAD — so a HEAD-first request would serialize a *body-less* entry
    // that ocache's `validate` accepts (`""` is not `undefined`) and that a
    // method-free cache key then serves to every subsequent GET.
    let calls = 0;
    const app = createApp({ "/article/**": { swr: 3600 } }, createOcacheRuleHandler());
    app.get("/article/:id", () => ({ calls: ++calls }));

    const head = await app.fetch(new Request("http://test/article/hello", { method: "HEAD" }));
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");

    // The GET is a genuine miss (the HEAD entry is not its entry) and gets a body.
    const get = await app.fetch(new Request("http://test/article/hello"));
    expect(get.status).toBe(200);
    expect(get.headers.get("x-cache")).toBe("MISS");
    expect(await get.text()).toBe(JSON.stringify({ calls: 2 }));

    // ...and it is the GET entry that later GETs are served from.
    const get2 = await app.fetch(new Request("http://test/article/hello"));
    expect(get2.headers.get("x-cache")).toBe("HIT");
    expect(await get2.text()).toBe(JSON.stringify({ calls: 2 }));

    // HEAD keeps its own (body-less) entry.
    const head2 = await app.fetch(new Request("http://test/article/hello", { method: "HEAD" }));
    expect(head2.headers.get("x-cache")).toBe("HIT");
    expect(await head2.text()).toBe("");
    expect(calls).toBe(2);
  });

  it("strips `Authorization` from the cached dispatch by default (F8)", async () => {
    // ocache strips `Cookie` (and never keys on it) but forwards `Authorization`
    // untouched while keying on neither — so a per-user response would be cached
    // and served to everyone, and advertised `public, s-maxage=N` to CDNs.
    let calls = 0;
    const app = createApp({ "/priv/**": { cache: { maxAge: 60 } } }, createOcacheRuleHandler());
    app.get("/priv/me", (event) => ({
      calls: ++calls,
      auth: event.req.headers.get("authorization"),
      proxyAuth: event.req.headers.get("proxy-authorization"),
    }));

    const alice = await app.fetch(
      new Request("http://test/priv/me", {
        headers: { authorization: "Bearer alice-token", "proxy-authorization": "Basic zzz" },
      }),
    );
    expect(await alice.json()).toEqual({ calls: 1, auth: null, proxyAuth: null });

    const anon = await app.fetch(new Request("http://test/priv/me"));
    expect(await anon.json()).toEqual({ calls: 1, auth: null, proxyAuth: null });
  });

  it("forwards `Authorization` only with an explicit `allowAuthorization` (F8)", async () => {
    let calls = 0;
    const app = createApp(
      { "/priv-opt/**": { cache: { maxAge: 60, allowAuthorization: true } } },
      createOcacheRuleHandler(),
    );
    app.get("/priv-opt/me", (event) => ({
      calls: ++calls,
      auth: event.req.headers.get("authorization"),
    }));

    const alice = await app.fetch(
      new Request("http://test/priv-opt/me", { headers: { authorization: "Bearer alice" } }),
    );
    expect(await alice.json()).toEqual({ calls: 1, auth: "Bearer alice" });
    // ...and the credential participates in caching, like an allowlisted cookie:
    // its own entry, and a `Vary` telling shared caches the same.
    expect(alice.headers.get("vary")).toMatch(/authorization/i);

    const aliceAgain = await app.fetch(
      new Request("http://test/priv-opt/me", { headers: { authorization: "Bearer alice" } }),
    );
    expect(aliceAgain.headers.get("x-cache")).toBe("HIT");
    expect(await aliceAgain.json()).toEqual({ calls: 1, auth: "Bearer alice" });

    const bob = await app.fetch(
      new Request("http://test/priv-opt/me", { headers: { authorization: "Bearer bob" } }),
    );
    expect(bob.headers.get("x-cache")).toBe("MISS");
    expect(await bob.json()).toEqual({ calls: 2, auth: "Bearer bob" });

    const anon = await app.fetch(new Request("http://test/priv-opt/me"));
    expect(anon.headers.get("x-cache")).toBe("MISS");
    expect(await anon.json()).toEqual({ calls: 3, auth: null });
  });

  it("fails the request closed when the credential strip cannot be applied (F8)", async () => {
    // Force *both* routes out: request headers that throw on mutation (the
    // in-place rewrite) and an unparseable `req.url` (the replacement
    // `Request`). h3 parses `event.url` in the event constructor, before this
    // middleware runs, so routing and the cache key are unaffected.
    class ImmutableHeaders extends Headers {
      override delete(): never {
        throw new TypeError("immutable headers");
      }
      override set(): never {
        throw new TypeError("immutable headers");
      }
    }
    // ocache's own request filter hits the same unparseable URL and logs.
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    let calls = 0;
    const app = new H3();
    app.use((event, next) => {
      const req = event.req;
      const headers = new ImmutableHeaders(req.headers);
      Object.defineProperty(req, "headers", { get: () => headers, configurable: true });
      Object.defineProperty(req, "url", { get: () => "::: not a url :::", configurable: true });
      return next();
    });
    app.use(
      routeRules(
        { "/failclosed/**": { cache: { maxAge: 60 } } },
        { handlers: { cache: createOcacheRuleHandler() } },
      ),
    );
    app.get("/failclosed/me", () => ({ calls: ++calls }));

    try {
      const res = await app.fetch(
        new Request("http://test/failclosed/me", {
          headers: { authorization: "Bearer alice" },
        }),
      );
      // A credential we cannot strip must never reach a handler whose response
      // is stored under a credential-free key.
      expect(res.status).toBe(500);
      expect(calls).toBe(0);
      expect((await res.json()).message).toMatch(/strip the credential headers/);

      // ...and only that case fails closed: nothing to strip is a success, even
      // though the request is exactly as hostile.
      const anon = await app.fetch(new Request("http://test/failclosed/me"));
      expect(anon.status).toBe(200);
      expect(await anon.json()).toEqual({ calls: 1 });
    } finally {
      consoleError.mockRestore();
    }
  });

  it("does not send `Authorization` to a bypassed (non-GET) request (F8)", async () => {
    const app = createApp(
      { "/priv-post/**": { cache: { maxAge: 60 } } },
      createOcacheRuleHandler(),
    );
    app.post("/priv-post/me", (event) => ({ auth: event.req.headers.get("authorization") }));
    const res = await app.fetch(
      new Request("http://test/priv-post/me", {
        method: "POST",
        headers: { authorization: "Bearer alice" },
      }),
    );
    // Non-cacheable methods bypass the cache entirely and must reach the handler
    // with their request untouched (same contract ocache applies to `Cookie`).
    expect(await res.json()).toEqual({ auth: "Bearer alice" });
  });

  it("keeps a handler's `private, no-store` cache-control intact (F9)", async () => {
    const app = createApp({ "/pv/**": { cache: { maxAge: 60 } } }, createOcacheRuleHandler());
    app.get("/pv/dashboard", (event) => {
      event.res.headers.set("cache-control", "private, no-store");
      return { balance: 1234 };
    });

    const res = await app.fetch(new Request("http://test/pv/dashboard"));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(await res.json()).toEqual({ balance: 1234 });
  });

  it("keeps `private` on a handler-returned Response (F9)", async () => {
    const app = createApp({ "/pv2/**": { swr: 60 } }, createOcacheRuleHandler());
    app.get(
      "/pv2/dashboard",
      () =>
        new Response(JSON.stringify({ secret: 1 }), {
          headers: { "cache-control": "private", "content-type": "application/json" },
        }),
    );

    const res = await app.fetch(new Request("http://test/pv2/dashboard"));
    expect(res.headers.get("cache-control")).toBe("private");
    expect(await res.json()).toEqual({ secret: 1 });
  });

  it("does not advertise cache-control when `sendCacheControl` is false (F9)", async () => {
    const app = createApp(
      { "/nocc/**": { cache: { maxAge: 60, sendCacheControl: false } } },
      createOcacheRuleHandler(),
    );
    app.get("/nocc/a", () => ({ ok: true }));
    const res = await app.fetch(new Request("http://test/nocc/a"));
    expect(res.headers.get("cache-control")).toBeNull();
    // server-side caching still applies
    const hit = await app.fetch(new Request("http://test/nocc/a"));
    expect(hit.headers.get("x-cache")).toBe("HIT");
    // ...and the hit must not advertise it either: ocache honors the flag only
    // in its serialize step, so a hit is served entirely by the
    // `handleCacheHeaders` hook, whose `cache-control` set is unconditional.
    expect(hit.headers.get("cache-control")).toBeNull();
  });

  it("does not bake a handler's `Set-Cookie` into the shared cache (F15)", async () => {
    // A cookie is per-requester by definition. ocache's serialize deletes it
    // from the very Response the *miss* response is rebuilt from, so the
    // handler's cookie was lost even on the request that ran it — while
    // `event.res` had already been consumed by h3's `toResponse`. Same move as
    // the volatile CORS headers: back onto the live `event.res`, never into the
    // entry.
    let calls = 0;
    const app = createApp({ "/sc/**": { swr: 60 } }, createOcacheRuleHandler());
    app.get("/sc/page", (event) => {
      setCookie(event, "sid", `s${++calls}`);
      return { calls };
    });

    const miss = await app.fetch(new Request("http://test/sc/page"));
    expect(miss.status).toBe(200);
    expect(miss.headers.get("x-cache")).toBe("MISS");
    expect(await miss.json()).toEqual({ calls: 1 });
    expect(miss.headers.get("set-cookie")).toBe("sid=s1; Path=/");

    // ...and the next requester is served the cached body without inheriting
    // the first requester's session.
    const hit = await app.fetch(new Request("http://test/sc/page"));
    expect(hit.headers.get("x-cache")).toBe("HIT");
    expect(await hit.json()).toEqual({ calls: 1 });
    expect(hit.headers.get("set-cookie")).toBeNull();
  });

  it("does not replay an allowlisted cookie from the cache either (F15)", async () => {
    // `allowCookies` is a *request*-side allowlist (which cookies key the
    // entry). ocache additionally keeps a matching `Set-Cookie` in the stored
    // entry, which replays the first requester's value to everyone sharing that
    // key — session fixation dressed as a cache hit.
    let calls = 0;
    const app = createApp(
      { "/sc-allow/**": { cache: { maxAge: 60, allowCookies: ["sid"] } } },
      createOcacheRuleHandler(),
    );
    app.get("/sc-allow/page", (event) => {
      setCookie(event, "sid", `s${++calls}`);
      return { calls };
    });

    const miss = await app.fetch(new Request("http://test/sc-allow/page"));
    expect(miss.headers.get("set-cookie")).toBe("sid=s1; Path=/");

    const hit = await app.fetch(new Request("http://test/sc-allow/page"));
    expect(hit.headers.get("x-cache")).toBe("HIT");
    expect(await hit.json()).toEqual({ calls: 1 });
    expect(hit.headers.get("set-cookie")).toBeNull();
  });

  it("lets the cached handler read the headers it varies on (F15)", async () => {
    // ocache filters every `varies` name out of the forwarded request, so a
    // handler could not read the header its own entry is keyed on: the
    // docstring's own `["accept-language"]` example produced one entry per
    // language, each holding the *default* rendering.
    let calls = 0;
    const app = createApp(
      { "/i18n/**": { cache: { maxAge: 60, varies: ["accept-language"] } } },
      createOcacheRuleHandler(),
    );
    app.get("/i18n/page", (event) => ({
      calls: ++calls,
      lang: event.req.headers.get("accept-language"),
    }));

    const fr = await app.fetch(
      new Request("http://test/i18n/page", { headers: { "accept-language": "fr" } }),
    );
    expect(await fr.json()).toEqual({ calls: 1, lang: "fr" });
    expect(fr.headers.get("vary")).toMatch(/accept-language/i);

    const en = await app.fetch(
      new Request("http://test/i18n/page", { headers: { "accept-language": "en" } }),
    );
    expect(en.headers.get("x-cache")).toBe("MISS");
    expect(await en.json()).toEqual({ calls: 2, lang: "en" });

    // ...and each language keeps its own entry.
    const frAgain = await app.fetch(
      new Request("http://test/i18n/page", { headers: { "accept-language": "fr" } }),
    );
    expect(frAgain.headers.get("x-cache")).toBe("HIT");
    expect(await frAgain.json()).toEqual({ calls: 1, lang: "fr" });
    expect(calls).toBe(2);
  });

  it("keeps `Cookie` away from the handler when `allowCookies` filters it (F15)", async () => {
    // A `varies: ["cookie"]` + `allowCookies` combination is ocache's one
    // documented exception: the allowlist wins, `cookie` drops out of the key,
    // and the request keeps only the allowlisted crumbs. Restoring varying
    // headers must not undo that.
    const app = createApp(
      { "/ck/**": { cache: { maxAge: 60, varies: ["cookie"], allowCookies: ["theme"] } } },
      createOcacheRuleHandler(),
    );
    app.get("/ck/page", (event) => ({ cookie: event.req.headers.get("cookie") }));

    const res = await app.fetch(
      new Request("http://test/ck/page", { headers: { cookie: "theme=dark; sid=secret" } }),
    );
    expect(await res.json()).toEqual({ cookie: "theme=dark" });
  });

  it("still strips `Authorization` when it is listed in `varies` (F15)", async () => {
    // `allowAuthorization` is the only switch that lets a credential through:
    // naming it in `varies` keys the entry per credential but must not reopen
    // the forwarding path the default deliberately closes.
    const app = createApp(
      { "/vauth/**": { cache: { maxAge: 60, varies: ["authorization"] } } },
      createOcacheRuleHandler(),
    );
    app.get("/vauth/me", (event) => ({ auth: event.req.headers.get("authorization") }));

    const res = await app.fetch(
      new Request("http://test/vauth/me", { headers: { authorization: "Bearer alice" } }),
    );
    expect(await res.json()).toEqual({ auth: null });
  });
});

describe("cache rule (ocache-backed, h3/rules/cache)", () => {
  it("caches the matched route handler end-to-end", async () => {
    let calls = 0;
    const app = createApp(
      { "/cached-default/**": { swr: true, cache: { maxAge: 60 } } },
      createOcacheRuleHandler(),
    );
    app.get("/cached-default/:id", () => ({ calls: ++calls }));

    const first = await app.fetch(new Request("http://test/cached-default/a"));
    expect(await first.json()).toEqual({ calls: 1 });
    const second = await app.fetch(new Request("http://test/cached-default/a"));
    expect(await second.json()).toEqual({ calls: 1 }); // served from cache
    expect(calls).toBe(1);
  });

  it("the shared `cache` export works as a registry handler", async () => {
    let calls = 0;
    const app = createApp({ "/cached-shared/**": { cache: { maxAge: 60 } } }, cache);
    app.get("/cached-shared/:id", () => ({ calls: ++calls }));
    await app.fetch(new Request("http://test/cached-shared/a"));
    const res = await app.fetch(new Request("http://test/cached-shared/a"));
    expect(await res.json()).toEqual({ calls: 1 });
  });

  it("cache: false on a nested pattern disables caching", async () => {
    let calls = 0;
    const app = createApp(
      {
        "/cached-off/**": { cache: { maxAge: 60 } },
        "/cached-off/dynamic": { cache: false },
      },
      createOcacheRuleHandler(),
    );
    app.get("/cached-off/dynamic", () => ({ calls: ++calls }));
    await app.fetch(new Request("http://test/cached-off/dynamic"));
    const res = await app.fetch(new Request("http://test/cached-off/dynamic"));
    expect(await res.json()).toEqual({ calls: 2 }); // not cached
  });

  it("lets a `headers` cache-control override win over the cache handler (post-cache order)", async () => {
    // Regression for h3js/h3-rules#5: the cache handler returns its own Response
    // (and ocache computes `cache-control`), so a request-phase header set would
    // be clobbered. `headers` runs post-response (order -1), applying over the
    // cached response on both the miss and the subsequent hit.
    let calls = 0;
    const app = createApp(
      {
        "/cached-headers/**": {
          cache: { swr: true, maxAge: 60 },
          headers: { "cache-control": "public, max-age=1", "x-extra": "1" },
        },
      },
      createOcacheRuleHandler(),
    );
    app.get("/cached-headers/:id", () => ({ calls: ++calls }));

    // miss: handler runs, response cached, but our headers still win
    const first = await app.fetch(new Request("http://test/cached-headers/a"));
    expect(await first.json()).toEqual({ calls: 1 });
    expect(first.headers.get("cache-control")).toBe("public, max-age=1");
    expect(first.headers.get("x-extra")).toBe("1");

    // hit: served from cache (handler not re-run), headers still applied
    const second = await app.fetch(new Request("http://test/cached-headers/a"));
    expect(await second.json()).toEqual({ calls: 1 });
    expect(second.headers.get("cache-control")).toBe("public, max-age=1");
    expect(second.headers.get("x-extra")).toBe("1");
    expect(calls).toBe(1);
  });

  it("an outer rule still short-circuits ahead of the cache, hit or miss", async () => {
    // Ordering is what keeps a rule an app layers *outside* the cache (anything
    // in the negative band — h3 ships no such built-in beyond `cors`/`headers`)
    // from being skipped once an entry exists: a cached response must never be
    // served past a rule that would have rejected the request.
    const blocked: RuleHandler<"restricted"> = {
      order: -2,
      handler: () => (event, next) =>
        event.req.headers.get("x-pass") === "1" ? next() : new Response("blocked", { status: 403 }),
    };
    let calls = 0;
    const app = new H3();
    app.use(
      routeRules(
        { "/cached-outer/**": { cache: { maxAge: 60 }, restricted: { label: "x" } } },
        { handlers: { cache: createOcacheRuleHandler(), restricted: blocked } },
      ),
    );
    app.get("/cached-outer/:id", () => ({ calls: ++calls }));

    // rejected before anything is cached: the handler never runs
    const first = await app.fetch(new Request("http://test/cached-outer/a"));
    expect(first.status).toBe(403);
    expect(calls).toBe(0);

    // allowed: handler runs, response is cached
    const pass = { "x-pass": "1" };
    const ok = await app.fetch(new Request("http://test/cached-outer/a", { headers: pass }));
    expect(await ok.json()).toEqual({ calls: 1 });

    // entry is cached now — a rejected request must still get 403,
    // never be served the cached body
    const after = await app.fetch(new Request("http://test/cached-outer/a"));
    expect(after.status).toBe(403);
    expect(await after.text()).toBe("blocked");
    expect(calls).toBe(1);

    // and the cache still serves allowed requests
    const again = await app.fetch(new Request("http://test/cached-outer/a", { headers: pass }));
    expect(await again.json()).toEqual({ calls: 1 });
  });

  it("never bakes reflected CORS headers into the shared cache (cors + swr)", async () => {
    // The `cors` rule (order -3) appends per-request headers — an
    // `access-control-allow-origin` reflected from the request Origin — before
    // the cache handler serializes the response. Storing them would serve the
    // first requester's origin to everyone (the entry's own `vary: origin`
    // forbids that, RFC 9111 §4.1) — with credentials, a cross-origin leak.
    let calls = 0;
    const app = createApp(
      {
        "/cached-cors/**": {
          cors: { origin: ["https://a.com"], credentials: true },
          swr: true,
          cache: { maxAge: 60 },
        },
      },
      createOcacheRuleHandler(),
    );
    app.get("/cached-cors/:id", () => ({ calls: ++calls }));

    // miss, allowed origin: live response carries its correct CORS headers
    const first = await app.fetch(
      new Request("http://test/cached-cors/a", { headers: { origin: "https://a.com" } }),
    );
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ calls: 1 });
    expect(first.headers.get("access-control-allow-origin")).toBe("https://a.com");
    expect(first.headers.get("access-control-allow-credentials")).toBe("true");
    expect(first.headers.get("vary")).toMatch(/origin/i);

    // hit, different origin: must NOT receive the first requester's origin
    const evil = await app.fetch(
      new Request("http://test/cached-cors/a", { headers: { origin: "https://evil.com" } }),
    );
    expect(await evil.json()).toEqual({ calls: 1 }); // served from cache
    expect(evil.headers.get("access-control-allow-origin")).toBeNull();
    // `access-control-allow-credentials` is appended live by the cors rule on
    // every request (h3 reflects the *config*, not the origin — identical to
    // an uncached route); without an allow-origin it grants nothing.
    expect(evil.headers.get("access-control-allow-credentials")).toBe("true");

    // hit, absent origin: no CORS headers either
    const none = await app.fetch(new Request("http://test/cached-cors/a"));
    expect(await none.json()).toEqual({ calls: 1 });
    expect(none.headers.get("access-control-allow-origin")).toBeNull();

    // hit, allowed origin: still gets its correct CORS headers
    const okHit = await app.fetch(
      new Request("http://test/cached-cors/a", { headers: { origin: "https://a.com" } }),
    );
    expect(await okHit.json()).toEqual({ calls: 1 });
    expect(okHit.headers.get("access-control-allow-origin")).toBe("https://a.com");
    expect(okHit.headers.get("access-control-allow-credentials")).toBe("true");
    expect(okHit.headers.get("vary")).toMatch(/origin/i);
    expect(calls).toBe(1);
  });

  it("serves conditional 304s with etag/cache-control and `headers`-rule headers", async () => {
    // RFC 9110 §15.4.5: a 304 must carry what the 200 would. ocache's
    // revalidation path builds a bare 304 Response, and h3's `prepareResponse`
    // only merges `event.res.headers` into 2xx Response instances — the glue
    // must hand back a mergeable response so the conditional headers set by
    // `handleCacheHeaders` and by `headers` rules reach the client.
    let calls = 0;
    const app = createApp(
      { "/cached-304/**": { cache: { maxAge: 60 }, headers: { "x-rule": "1" } } },
      createOcacheRuleHandler(),
    );
    app.get("/cached-304/:id", () => ({ calls: ++calls }));

    const first = await app.fetch(new Request("http://test/cached-304/a"));
    expect(first.status).toBe(200);
    const etag = first.headers.get("etag");
    expect(etag).toBeTruthy();

    const revalidated = await app.fetch(
      new Request("http://test/cached-304/a", { headers: { "if-none-match": etag! } }),
    );
    expect(revalidated.status).toBe(304);
    expect(await revalidated.text()).toBe("");
    expect(revalidated.headers.get("etag")).toBe(etag);
    expect(revalidated.headers.get("cache-control")).toBeTruthy();
    expect(revalidated.headers.get("x-rule")).toBe("1");
    expect(calls).toBe(1);
  });

  it("dispatches the route exactly once for a `headersOnly` cache rule (F12)", async () => {
    // ocache's `headersOnly` path returns `handler(event)` raw (no `toResponse`),
    // so a handler with no return value hands back `undefined` — which h3's
    // `callLayer` reads as unhandled and re-dispatches the whole route.
    let calls = 0;
    const app = createApp(
      { "/cached-headers-only/**": { cache: { headersOnly: true, maxAge: 60 } } },
      createOcacheRuleHandler(),
    );
    app.get("/cached-headers-only/:id", (event) => {
      calls++;
      event.res.headers.set("x-calls", String(calls));
    });

    const res = await app.fetch(new Request("http://test/cached-headers-only/a"));
    expect(res.status).toBe(200);
    expect(calls).toBe(1);
    expect(res.headers.get("x-calls")).toBe("1");
  });

  // NOTE: keep this test last in this describe — the `storage` option mutates
  // ocache's process-global storage (`setStorage`), so it would leak into the
  // default-storage tests above if it ran first.
  it("honors a consumer-provided storage", async () => {
    const store = new Map<string, unknown>();
    const storage = {
      get: vi.fn((key: string) => store.get(key) ?? null),
      set: vi.fn((key: string, value: unknown) => {
        store.set(key, value);
      }),
    };
    let handlerCalls = 0;
    const app = createApp(
      { "/cached-storage/**": { cache: { maxAge: 60 } } },
      createOcacheRuleHandler({ storage: storage as OcacheRuleHandlerOptions["storage"] }),
    );
    app.get("/cached-storage/:id", () => (++handlerCalls, "stored"));

    const first = await app.fetch(new Request("http://test/cached-storage/a"));
    expect(await first.text()).toBe("stored");
    expect(storage.set).toHaveBeenCalled();
    const key = storage.set.mock.calls[0]![0] as string;
    expect(key).toContain("h3/route-rules");

    // second fetch: served from the provided storage, not the handler
    storage.get.mockClear();
    const second = await app.fetch(new Request("http://test/cached-storage/a"));
    expect(await second.text()).toBe("stored");
    expect(storage.get).toHaveBeenCalled();
    expect(handlerCalls).toBe(1);
  });
});

describe("cache rule (core defineCachedHandler injection)", () => {
  it("does not cache without a matched route (falls through to next)", async () => {
    const app = createInjectedApp(
      { "/cached-nomatch/**": { cache: { maxAge: 60 } } },
      { defineCachedHandler: (handler) => handler },
    );
    // no route registered — middleware must call next() and 404
    const res = await app.fetch(new Request("http://test/cached-nomatch/x"));
    expect(res.status).toBe(404);
  });

  it("wraps the matched handler through the injected implementation", async () => {
    const defineCachedHandler = vi.fn(
      (handler: EventHandler, _opts: unknown): EventHandler =>
        (event) => {
          event.res.headers.set("x-custom-cache", "1");
          return handler(event);
        },
    );
    const app = createInjectedApp(
      { "/cached-custom/**": { cache: { maxAge: 5 } } },
      { defineCachedHandler },
    );
    app.get("/cached-custom/:id", () => "ok");

    const res = await app.fetch(new Request("http://test/cached-custom/a"));
    expect(res.headers.get("x-custom-cache")).toBe("1");
    expect(defineCachedHandler).toHaveBeenCalledTimes(1);
    expect(defineCachedHandler.mock.calls[0]![1]).toMatchObject({
      group: "h3/route-rules",
      maxAge: 5,
    });
  });

  it("merges `defaults` under rule options (rule options win)", async () => {
    const defineCachedHandler = vi.fn(
      (handler: EventHandler, _opts: unknown): EventHandler => handler,
    );
    const app = createInjectedApp(
      { "/cached-defaults/**": { cache: { maxAge: 5 } } },
      { defineCachedHandler, defaults: { maxAge: 99, staleMaxAge: 10 } },
    );
    app.get("/cached-defaults/:id", () => "ok");
    await app.fetch(new Request("http://test/cached-defaults/a"));
    expect(defineCachedHandler.mock.calls[0]![1]).toMatchObject({
      maxAge: 5, // rule option wins over defaults
      staleMaxAge: 10, // default preserved
    });
  });

  it("wraps the same route exactly once across requests (memoization)", async () => {
    const defineCachedHandler = vi.fn((handler: EventHandler): EventHandler => handler);
    const app = createInjectedApp(
      { "/cached-memo/**": { cache: { maxAge: 60 } } },
      { defineCachedHandler },
    );
    app.get("/cached-memo/:id", () => "ok");

    await app.fetch(new Request("http://test/cached-memo/a"));
    await app.fetch(new Request("http://test/cached-memo/a"));
    await app.fetch(new Request("http://test/cached-memo/b"));
    // same rule route + same matched route → single wrap
    expect(defineCachedHandler).toHaveBeenCalledTimes(1);
  });

  it("runs per-route middleware for cache-matched routes (F1)", async () => {
    // The cache rule replaces the route dispatch, so it must invoke the route's
    // composed (middleware + handler) pair, not the bare handler.
    const seen: string[] = [];
    const app = createInjectedApp(
      { "/cached-route-mw/**": { cache: { maxAge: 60 } } },
      { defineCachedHandler: (handler) => handler },
    );
    app.get("/cached-route-mw/:id", () => "ok", {
      middleware: [
        (event, next) => {
          seen.push("route-mw");
          event.res.headers.set("x-route-mw", "1");
          return next();
        },
      ],
    });

    const res = await app.fetch(new Request("http://test/cached-route-mw/a"));
    expect(await res.text()).toBe("ok");
    expect(seen).toEqual(["route-mw"]);
    expect(res.headers.get("x-route-mw")).toBe("1");
  });

  it("wraps same-path routes of different methods separately (F3)", async () => {
    const defineCachedHandler = vi.fn((handler: EventHandler): EventHandler => handler);
    const app = createInjectedApp(
      { "/cached-method/**": { cache: { maxAge: 60 } } },
      { defineCachedHandler },
    );
    app.get("/cached-method/x", () => "get");
    app.post("/cached-method/x", () => "post");

    const get = await app.fetch(new Request("http://test/cached-method/x"));
    expect(await get.text()).toBe("get");
    const post = await app.fetch(new Request("http://test/cached-method/x", { method: "POST" }));
    expect(await post.text()).toBe("post");
    expect(defineCachedHandler).toHaveBeenCalledTimes(2);
  });

  it("does not share wrappers across apps using one handler instance (F3)", async () => {
    // The `cache` export of `h3/rules/cache` is module-scoped, so a single
    // handler instance is shared process-wide across apps.
    const defineCachedHandler = vi.fn((handler: EventHandler): EventHandler => handler);
    const shared = createCacheRuleHandler({ defineCachedHandler });
    const config: Record<string, RouteRuleConfig> = {
      "/cached-apps/**": { cache: { maxAge: 60 } },
    };
    const app1 = createApp(config, shared);
    const app2 = createApp(config, shared);
    app1.get("/cached-apps/x", () => "one");
    app2.get("/cached-apps/x", () => "two");

    const first = await app1.fetch(new Request("http://test/cached-apps/x"));
    expect(await first.text()).toBe("one");
    const second = await app2.fetch(new Request("http://test/cached-apps/x"));
    expect(await second.text()).toBe("two");
    expect(defineCachedHandler).toHaveBeenCalledTimes(2);
  });

  it("memoization is instance-scoped, not global", async () => {
    const wrap1 = vi.fn((handler: EventHandler): EventHandler => handler);
    const wrap2 = vi.fn((handler: EventHandler): EventHandler => handler);
    const app1 = createInjectedApp(
      { "/cached-inst/**": { cache: { maxAge: 60 } } },
      { defineCachedHandler: wrap1 },
    );
    const app2 = createInjectedApp(
      { "/cached-inst/**": { cache: { maxAge: 60 } } },
      { defineCachedHandler: wrap2 },
    );
    app1.get("/cached-inst/:id", () => "one");
    app2.get("/cached-inst/:id", () => "two");

    await app1.fetch(new Request("http://test/cached-inst/a"));
    await app2.fetch(new Request("http://test/cached-inst/a"));
    // each matcher instance wraps independently (no shared/global map)
    expect(wrap1).toHaveBeenCalledTimes(1);
    expect(wrap2).toHaveBeenCalledTimes(1);
  });
});
