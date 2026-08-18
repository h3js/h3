import { H3 } from "../../src/index.ts";
import type { H3Event } from "../../src/index.ts";
import { describe, expect, it } from "vitest";
import { routeRules } from "../../src/rules/middleware.ts";
import type { RouteRulesOptions } from "../../src/rules/middleware.ts";
import type { RouteRuleConfig, RuleHandler } from "../../src/rules/types.ts";
import { cache } from "../../src/rules/cache.ts";

// Whatever `routeRules()` actually puts on the context — read off h3's own
// context type (which `src/h3.ts` augments) rather than restating the internal
// shape, so this probe tracks the exposed contract instead of drifting from it.
type ContextRouteRules = NonNullable<H3Event["context"]["routeRules"]>;

// Build an app that records the per-request `event.context.routeRules` object
// (identity included) for a catch-all GET handler.
function appWithContextProbe(
  config: Record<string, RouteRuleConfig>,
  opts?: RouteRulesOptions,
): { app: H3; seen: ContextRouteRules[] } {
  const seen: ContextRouteRules[] = [];
  const app = new H3();
  app.use(routeRules(config, opts));
  app.get("/**", (event) => {
    seen.push(event.context.routeRules!);
    return "ok";
  });
  return { app, seen };
}

describe("routeRules() middleware", () => {
  it("applies matched rules and exposes event.context.routeRules", async () => {
    const { app, seen } = appWithContextProbe({
      "/api/**": { headers: { "x-api": "1" } },
    });
    const res = await app.fetch(new Request("http://test/api/users"));
    expect(res.status).toBe(200);
    expect(res.headers.get("x-api")).toBe("1");
    expect(seen[0]!.headers).toEqual({ "x-api": "1" });
  });

  it("memoizes match results by default (shared result across repeat requests)", async () => {
    const { app, seen } = appWithContextProbe({
      "/api/**": { headers: { "x-api": "1" } },
    });
    for (let i = 0; i < 3; i++) {
      const res = await app.fetch(new Request("http://test/api/users"));
      expect(res.headers.get("x-api")).toBe("1"); // rules stay applied on memo hits
    }
    expect(seen).toHaveLength(3);
    expect(seen[1]).toBe(seen[0]);
    expect(seen[2]).toBe(seen[0]);
    // no-match paths are memoized (and shared) too
    await app.fetch(new Request("http://test/other"));
    await app.fetch(new Request("http://test/other"));
    expect(seen[4]).toEqual({});
    expect(seen[4]).toBe(seen[3]);
  });

  it("default memoization stays keyed on the raw pathname (no canonical collapse)", async () => {
    // `/x/off/a` (rule reset by `/x/off/**`) and `/x/off%2fa` (raw single opaque
    // segment, so the reset must not strip the broad rule) canonicalize to the
    // same path but must keep resolving differently — in either warm-up order.
    for (const order of [
      ["/x/off/a", "/x/off%2fa"],
      ["/x/off%2fa", "/x/off/a"],
    ]) {
      const app = new H3();
      app.use(
        routeRules({
          "/x/**": { cors: { origin: ["https://ok.example"] } },
          "/x/off/**": { cors: false },
        }),
      );
      app.get("/x/**", () => "ok");
      const get = (path: string) =>
        app.fetch(new Request(`http://test${path}`, { headers: { origin: "https://ok.example" } }));
      for (const path of order) await get(path); // warm the memo
      // reset by the more specific pattern: no policy headers
      expect((await get("/x/off/a")).headers.get("access-control-allow-origin")).toBeNull();
      // raw single opaque segment: the broad rule still applies
      expect((await get("/x/off%2fa")).headers.get("access-control-allow-origin")).toBe(
        "https://ok.example",
      );
    }
  });

  it("memoize: false resolves every request from scratch (fresh result objects)", async () => {
    const { app, seen } = appWithContextProbe(
      { "/api/**": { headers: { "x-api": "1" } } },
      { memoize: false },
    );
    for (let i = 0; i < 2; i++) {
      const res = await app.fetch(new Request("http://test/api/users"));
      expect(res.headers.get("x-api")).toBe("1");
    }
    expect(seen[1]).not.toBe(seen[0]);
    expect(seen[1]).toEqual(seen[0]);
    // the no-match fast path also allocates per request when un-memoized
    await app.fetch(new Request("http://test/other"));
    await app.fetch(new Request("http://test/other"));
    expect(seen[2]).toEqual({});
    expect(seen[3]).not.toBe(seen[2]);
  });

  it("memoize accepts MatcherMemoizeOptions (FIFO entry cap)", async () => {
    const { app, seen } = appWithContextProbe(
      { "/api/**": { headers: { "x-api": "1" } } },
      { memoize: { max: 1 } },
    );
    await app.fetch(new Request("http://test/api/a")); // miss
    await app.fetch(new Request("http://test/api/a")); // hit
    await app.fetch(new Request("http://test/api/b")); // miss, evicts /api/a
    await app.fetch(new Request("http://test/api/a")); // evicted → re-resolved
    expect(seen[1]).toBe(seen[0]);
    expect(seen[3]).not.toBe(seen[0]);
    expect(seen[3]).toEqual(seen[0]);
  });

  it("normalizes the request method before the lookup (and before the memo key)", async () => {
    // Rule keys are uppercased at parse time, so the lookup method must be too —
    // otherwise a method-scoped rule (which never populates rou3's `methods[""]`)
    // misses entirely and fails open. Normalizing here rather than inside the
    // matcher also keeps the memo keyed on one spelling per method: the shared
    // result identity below is what pins that ordering.
    const seen: ContextRouteRules[] = [];
    const app = new H3();
    app.use(routeRules({ "PATCH /api/**": { headers: { "x-m": "patch" } } }));
    app.all("/api/x", (event) => {
      seen.push(event.context.routeRules!);
      return "ok";
    });
    for (const method of ["PATCH", "patch", "PaTcH"]) {
      const res = await app.fetch(new Request("http://test/api/x", { method }));
      expect([method, res.headers.get("x-m")]).toEqual([method, "patch"]);
    }
    expect(seen).toHaveLength(3);
    expect(seen[1]).toBe(seen[0]); // one memo entry, not one per spelling
    expect(seen[2]).toBe(seen[0]);
  });

  it("merges over an earlier instance's context rules instead of replacing them", async () => {
    // Two instances (e.g. a framework-level rule set plus an app-level one) must
    // compose: the second must not erase what the first exposed.
    const seen: ContextRouteRules[] = [];
    const app = new H3();
    app.use(routeRules({ "/api/**": { headers: { "x-first": "1" } } }));
    app.use(routeRules({ "/api/**": { custom: { a: 1 } } }));
    app.get("/api/x", (event) => {
      seen.push(event.context.routeRules!);
      return "ok";
    });
    const res = await app.fetch(new Request("http://test/api/x"));
    expect(res.headers.get("x-first")).toBe("1");
    expect(Object.keys(seen[0]!).sort()).toEqual(["custom", "headers"]);
    // The merged map must be freshly allocated per request, never a mutated
    // memoized result (both instances memoize by default and share their maps).
    await app.fetch(new Request("http://test/api/x"));
    expect(seen[1]).not.toBe(seen[0]);
    expect(seen[1]).toEqual(seen[0]);
  });

  it("a second instance that matches nothing keeps the first instance's rules", async () => {
    const seen: ContextRouteRules[] = [];
    const app = new H3();
    app.use(routeRules({ "/api/**": { headers: { "x-first": "1" } } }));
    app.use(routeRules({ "/other/**": { headers: { "x-second": "2" } } }));
    app.get("/api/x", (event) => {
      seen.push(event.context.routeRules!);
      return "ok";
    });
    await app.fetch(new Request("http://test/api/x"));
    expect(Object.keys(seen[0]!)).toEqual(["headers"]);
    expect(seen[0]!.headers).toEqual({ "x-first": "1" });
  });

  it("a later instance wins per rule name", async () => {
    const seen: ContextRouteRules[] = [];
    const app = new H3();
    app.use(routeRules({ "/api/**": { headers: { "x-h": "first" } } }));
    app.use(routeRules({ "/api/**": { headers: { "x-h": "second" } } }));
    app.get("/api/x", (event) => {
      seen.push(event.context.routeRules!);
      return "ok";
    });
    const res = await app.fetch(new Request("http://test/api/x"));
    expect(seen[0]!.headers).toEqual({ "x-h": "second" });
    // Both instances still run their own middleware; the `headers` rule applies
    // after `next()`, so the *outer* (first) instance writes the header last.
    // Only the context map is merged — rule middleware is not deduplicated.
    expect(res.headers.get("x-h")).toBe("first");
  });

  it("runs rule middleware sorted by numeric handler order (lower first)", async () => {
    const ran: string[] = [];
    const mk = (name: string, order?: number) => ({
      order,
      handler: () => (_event: unknown, next: () => unknown) => (ran.push(name), next()),
    });
    const app = new H3();
    app.use(
      routeRules(
        // `custom`/`tags` are augmented keys (test/_augment.ts) given handlers
        // here; `headers` (built-in) sits at -1.
        { "/api/**": { headers: { "x-api": "1" }, custom: { a: 1 }, tags: { b: 2 } } },
        { handlers: { custom: mk("custom", -4), tags: mk("tags", 1), headers: mk("headers", -1) } },
      ),
    );
    app.get("/api/**", () => "ok");
    await app.fetch(new Request("http://test/api/x"));
    expect(ran).toEqual(["custom", "headers", "tags"]);
  });

  // Regression: the chain used to fall back to `matchedRules` key order for
  // equal orders, which is normalize's fixed order only when every rule comes
  // from the same pattern — across patterns it is layer order (broad → narrow).
  // Since none of the terminating rules calls `next()`, the first one merged
  // swallowed the rest, so splitting a rule set across two patterns changed
  // which one answered.
  describe("terminating rules do not depend on which pattern contributed them", () => {
    // The `/**` redirect keeps its own base, so its target carries the full
    // matched tail — only *which* rule answers is under test here.
    const authorings: [label: string, config: Record<string, RouteRuleConfig>, to: string][] = [
      [
        "broad cache + narrow redirect",
        { "/**": { swr: 60 }, "/old/**": { redirect: "/new/**" } },
        "/new/a",
      ],
      ["one pattern", { "/old/**": { redirect: "/new/**", swr: 60 } }, "/new/a"],
      [
        "narrow cache + broad redirect",
        { "/**": { redirect: "/new/**" }, "/old/**": { swr: 60 } },
        "/new/old/a",
      ],
    ];

    for (const [label, config, to] of authorings) {
      it(`redirect wins over cache (${label})`, async () => {
        const app = new H3();
        app.use(routeRules(config, { handlers: { cache } }));
        app.get("/old/**", () => "handler-ran");
        const res = await app.fetch(new Request("http://test/old/a"));
        expect([res.status, res.headers.get("location")]).toEqual([307, to]);
      });
    }

    // A custom handler left at the default `0` is a gate for anyone who did not
    // read the `-2` note; a broader `cache` must not answer (and cache) ahead of
    // it, since `cache` dispatches the route handler itself.
    it("a default-order custom rule runs ahead of a broader cache rule", async () => {
      const gate: RuleHandler<"custom"> = {
        handler: () => () => new Response("denied", { status: 401 }),
      };
      const app = new H3();
      app.use(
        routeRules(
          { "/**": { swr: 60 }, "/admin/**": { custom: true } },
          { handlers: { cache, custom: gate } },
        ),
      );
      app.get("/admin/**", () => "SECRET");
      const res = await app.fetch(new Request("http://test/admin/x"));
      expect([res.status, await res.text()]).toEqual([401, "denied"]);
    });

    it("breaks equal orders by rule name, not by contributing pattern", async () => {
      const ran: string[] = [];
      const mk = (name: string): RuleHandler<"custom"> => ({
        handler: () => (_event, next) => (ran.push(name), next()),
      });
      const handlers = { custom: mk("custom"), tags: mk("tags") };
      const authorings: Record<string, RouteRuleConfig>[] = [
        { "/**": { tags: 1 }, "/api/**": { custom: 1 } },
        { "/**": { custom: 1 }, "/api/**": { tags: 1 } },
        { "/api/**": { tags: 1, custom: 1 } },
      ];
      for (const config of authorings) {
        ran.length = 0;
        const app = new H3();
        app.use(routeRules(config, { handlers }));
        app.get("/api/**", () => "ok");
        await app.fetch(new Request("http://test/api/x"));
        expect(ran).toEqual(["custom", "tags"]);
      }
    });
  });
});
