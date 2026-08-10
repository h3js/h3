import { H3 } from "../../src/index.ts";
import type { H3Event } from "../../src/index.ts";
import { describe, expect, it } from "vitest";
import { routeRules } from "../../src/rules/middleware.ts";
import type { RouteRulesOptions } from "../../src/rules/middleware.ts";
import type { RouteRuleConfig } from "../../src/rules/types.ts";

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
    expect(seen[0]!.headers?.options).toEqual({ "x-api": "1" });
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
    // `/x/off/a` (auth reset by `/x/off/**`) and `/x/off%2fa` (raw single opaque
    // segment: the reset must not strip the broad auth rule) canonicalize to the
    // same path but must keep resolving differently — in either warm-up order.
    for (const order of [
      ["/x/off/a", "/x/off%2fa"],
      ["/x/off%2fa", "/x/off/a"],
    ]) {
      const app = new H3();
      app.use(
        routeRules({
          "/x/**": { basicAuth: { username: "u", password: "p" } },
          "/x/off/**": { basicAuth: false },
        }),
      );
      app.get("/x/**", () => "ok");
      for (const path of order) await app.fetch(new Request(`http://test${path}`)); // warm the memo
      expect((await app.fetch(new Request("http://test/x/off/a"))).status).toBe(200);
      expect((await app.fetch(new Request("http://test/x/off%2fa"))).status).toBe(401);
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
    expect(seen[0]!.headers?.options).toEqual({ "x-first": "1" });
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
    expect(seen[0]!.headers?.options).toEqual({ "x-h": "second" });
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
});
