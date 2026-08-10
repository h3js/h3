import { H3 } from "../../src/index.ts";
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
      cache: event.context.routeRules?.cache?.options,
    }));
    const res = await app.fetch(new Request("http://test/cached/a"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ cache: { swr: true, maxAge: 60 } });
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

  it("never caches or serves cached bodies to unauthorized requests (basicAuth order -1)", async () => {
    let calls = 0;
    const app = createApp(
      {
        "/cached-auth/**": {
          cache: { maxAge: 60 },
          basicAuth: { username: "u", password: "p", realm: "R" },
        },
      },
      createOcacheRuleHandler(),
    );
    app.get("/cached-auth/:id", () => ({ calls: ++calls }));

    // unauthorized before anything is cached: 401, handler never runs
    const unauth = await app.fetch(new Request("http://test/cached-auth/a"));
    expect(unauth.status).toBe(401);
    expect(calls).toBe(0);

    // authorized: handler runs, response is cached
    const auth = { Authorization: "Basic " + btoa("u:p") };
    const ok = await app.fetch(new Request("http://test/cached-auth/a", { headers: auth }));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ calls: 1 });

    // entry is cached now — an unauthorized request must still 401,
    // never be served the cached body
    const unauthAfter = await app.fetch(new Request("http://test/cached-auth/a"));
    expect(unauthAfter.status).toBe(401);
    expect(calls).toBe(1);

    // and the cache still serves authorized requests
    const okAgain = await app.fetch(new Request("http://test/cached-auth/a", { headers: auth }));
    expect(await okAgain.json()).toEqual({ calls: 1 });
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
