import { callMiddleware, H3 } from "../../src/index.ts";
import { describe, expect, it, vi } from "vitest";
import {
  createMatcherFromFind,
  createRouteRulesMatcher,
  memoizeRouteRulesMatcher,
} from "../../src/rules/match.ts";
import type { RouteRuleLayer } from "../../src/rules/merge.ts";
import { normalizeRouteRules } from "../../src/rules/normalize.ts";
import type { RouteRuleConfig } from "../../src/rules/types.ts";

const RULES: Record<string, RouteRuleConfig> = {
  "/**": { headers: { "x-catch": "all" } },
  "/api/**": { cors: true },
  "/api/:section/:id": { custom: { a: 1 } },
  "/admin/**": { basicAuth: { username: "a", password: "b" } },
};

describe("memoizeRouteRulesMatcher", () => {
  it("returns results identical to the unmemoized matcher", () => {
    const plain = createRouteRulesMatcher(normalizeRouteRules(RULES));
    const memoized = memoizeRouteRulesMatcher(createRouteRulesMatcher(normalizeRouteRules(RULES)));
    for (const [method, path] of [
      ["GET", "/api/users/42"],
      ["GET", "/api/users/42"], // repeat (memo hit)
      ["POST", "/api/users/42"], // method is part of the key
      ["GET", "/admin/panel"],
      ["GET", "/admin%2fpanel"], // encoded separator still resolves dual-path
      ["GET", "/plain"],
    ] as const) {
      const a = plain(method, path);
      const b = memoized(method, path);
      expect(Object.keys(b.routeRules)).toEqual(Object.keys(a.routeRules));
      for (const name of Object.keys(a.routeRules)) {
        expect(b.routeRules[name]!.options).toEqual(a.routeRules[name]!.options);
        expect(b.routeRules[name]!.params).toEqual(a.routeRules[name]!.params);
        expect(b.routeRules[name]!.route).toBe(a.routeRules[name]!.route);
      }
      expect(b.routeRuleMiddleware).toHaveLength(a.routeRuleMiddleware.length);
    }
  });

  it("resolves each method + pathname only once", () => {
    const find = vi.fn(() => [] as RouteRuleLayer[]);
    const matcher = memoizeRouteRulesMatcher(createMatcherFromFind(find));
    matcher("GET", "/a");
    matcher("GET", "/a");
    matcher("GET", "/a");
    expect(find).toHaveBeenCalledTimes(1);
    matcher("POST", "/a"); // different method → separate entry
    expect(find).toHaveBeenCalledTimes(2);
    matcher("GET", "/b");
    expect(find).toHaveBeenCalledTimes(3);
  });

  it("memo entries are keyed on the raw pathname, never the canonical one", () => {
    // `/x/off/a` (auth reset by `/x/off/**`) and `/x/off%2fa` (raw single
    // opaque segment: the canonical `false` may not strip the broad auth rule)
    // canonicalize to the same path but must resolve differently. Keying the
    // memo on the canonical path collapses them into one entry: whichever is
    // requested first wins — an auth bypass for the encoded path in one order,
    // a spurious 401 for the legitimately auth-free path in the other.
    const rules = normalizeRouteRules({
      "/x/**": { basicAuth: { username: "a", password: "b" } },
      "/x/off/**": { basicAuth: false },
    });
    for (const order of [
      ["/x/off/a", "/x/off%2fa"],
      ["/x/off%2fa", "/x/off/a"],
    ]) {
      const memoized = memoizeRouteRulesMatcher(createRouteRulesMatcher(rules));
      for (const path of order) memoized("GET", path);
      expect(memoized("GET", "/x/off/a").routeRules.basicAuth).toBeUndefined();
      expect(memoized("GET", "/x/off%2fa").routeRules.basicAuth).toBeDefined();
    }
  });

  it("returns the same result object for repeat requests (shared)", () => {
    const matcher = memoizeRouteRulesMatcher(createRouteRulesMatcher(normalizeRouteRules(RULES)));
    expect(matcher("GET", "/api/x")).toBe(matcher("GET", "/api/x"));
  });

  it("evicts FIFO past the entry cap and re-resolves evicted paths", () => {
    let calls = 0;
    const memoized = memoizeRouteRulesMatcher(
      () => (calls++, { routeRules: {}, routeRuleMiddleware: [] }),
      { max: 2 },
    );
    memoized("GET", "/1"); // calls=1
    memoized("GET", "/2"); // calls=2 (cap reached)
    memoized("GET", "/3"); // calls=3, evicts /1
    expect(calls).toBe(3);
    memoized("GET", "/3"); // hit
    expect(calls).toBe(3);
    memoized("GET", "/1"); // evicted → re-resolved
    expect(calls).toBe(4);
  });

  it("defaults the entry cap to 1024", () => {
    let calls = 0;
    const memoized = memoizeRouteRulesMatcher(
      () => (calls++, { routeRules: {}, routeRuleMiddleware: [] }),
    );
    for (let i = 0; i < 1024; i++) memoized("GET", `/p/${i}`);
    expect(calls).toBe(1024);
    memoized("GET", "/p/0"); // still memoized at exactly the cap
    expect(calls).toBe(1024);
    memoized("GET", "/p/1024"); // 1025th entry evicts the oldest (/p/0)
    memoized("GET", "/p/0"); // → re-resolved
    expect(calls).toBe(1026);
  });

  it("a non-positive cap disables memoization (not a cap of 1)", () => {
    for (const max of [0, -1]) {
      let calls = 0;
      const memoized = memoizeRouteRulesMatcher(
        () => (calls++, { routeRules: {}, routeRuleMiddleware: [] }),
        { max },
      );
      memoized("GET", "/a");
      memoized("GET", "/a");
      expect(calls).toBe(2);
    }
  });

  it("works end-to-end with a memoized matcher composed into middleware", async () => {
    const app = new H3();
    const matcher = memoizeRouteRulesMatcher(createRouteRulesMatcher(normalizeRouteRules(RULES)));
    app.use((event, next) => {
      const { routeRules, routeRuleMiddleware } = matcher(event.req.method, event.url.pathname);
      event.context.routeRules = routeRules;
      return routeRuleMiddleware.length > 0
        ? callMiddleware(event, routeRuleMiddleware, () => next())
        : next();
    });
    app.get("/api/:section/:id", (event) => ({
      params: event.context.routeRules?.custom?.params,
    }));
    for (let i = 0; i < 3; i++) {
      const res = await app.fetch(new Request("http://test/api/users/42"));
      expect(await res.json()).toEqual({ params: { section: "users", id: "42" } });
      // the `cors` rule (h3 handleCors) sets the permissive origin
      expect(res.headers.get("access-control-allow-origin")).toBe("*");
    }
    // encoded separator still hits the canonical auth gate when memoized
    const guarded = await app.fetch(new Request("http://test/admin%2fpanel"));
    expect(guarded.status).toBe(401);
    const guardedAgain = await app.fetch(new Request("http://test/admin%2fpanel"));
    expect(guardedAgain.status).toBe(401);
  });
});
