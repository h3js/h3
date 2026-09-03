import { callMiddleware, H3 } from "../../src/index.ts";
import { describe, expect, it, vi } from "vitest";
import {
  createMatcherFromFind,
  createRouteRulesMatcher,
  memoizeRouteRulesMatcher,
} from "../../src/rules/match.ts";
import type { RouteRuleLayer } from "../../src/rules/merge.ts";
import { normalizeRouteRules } from "../../src/rules/normalize.ts";
import type { MatchedRouteRules, RouteRuleConfig, RouteRuleName } from "../../src/rules/types.ts";

const RULES: Record<string, RouteRuleConfig> = {
  "/**": { headers: { "x-catch": "all" } },
  "/api/**": { cors: true },
  "/api/:section/:id": { custom: { a: 1 } },
  "/admin/**": { redirect: "/elsewhere" },
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
      for (const name of Object.keys(a.routeRules) as RouteRuleName[]) {
        expect(b.routeRules[name]).toEqual(a.routeRules[name]);
        expect(b.matchedRules[name]!.params).toEqual(a.matchedRules[name]!.params);
        expect(b.matchedRules[name]!.route).toBe(a.matchedRules[name]!.route);
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
    // `/x/off/a` (rule reset by `/x/off/**`) and `/x/off%2fa` (raw single opaque
    // segment, so the canonical reading's `false` may not strip the broad rule)
    // canonicalize to the same path but must resolve differently. Keying the
    // memo on the canonical path collapses them into one entry: whichever is
    // requested first wins, and the other path gets the wrong rule set.
    const rules = normalizeRouteRules({
      "/x/**": { cors: { origin: ["https://a.example"] } },
      "/x/off/**": { cors: false },
    });
    for (const order of [
      ["/x/off/a", "/x/off%2fa"],
      ["/x/off%2fa", "/x/off/a"],
    ]) {
      const memoized = memoizeRouteRulesMatcher(createRouteRulesMatcher(rules));
      for (const path of order) memoized("GET", path);
      expect(memoized("GET", "/x/off/a").routeRules.cors).toBeUndefined();
      expect(memoized("GET", "/x/off%2fa").routeRules.cors).toBeDefined();
    }
  });

  it("returns the same result object for repeat requests (shared)", () => {
    const matcher = memoizeRouteRulesMatcher(createRouteRulesMatcher(normalizeRouteRules(RULES)));
    expect(matcher("GET", "/api/x")).toBe(matcher("GET", "/api/x"));
  });

  it("evicts past the entry cap and re-resolves evicted paths", () => {
    let calls = 0;
    const memoized = memoizeRouteRulesMatcher(
      () => (calls++, { routeRules: {}, matchedRules: {}, routeRuleMiddleware: [] }),
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
      () => (calls++, { routeRules: {}, matchedRules: {}, routeRuleMiddleware: [] }),
    );
    for (let i = 0; i < 1024; i++) memoized("GET", `/p/${i}`);
    expect(calls).toBe(1024);
    memoized("GET", "/p/0"); // still memoized at exactly the cap
    expect(calls).toBe(1024);
    // The 1025th entry forces an eviction. `/p/0` was just requested, so the
    // hand spares it and takes the oldest untouched entry (`/p/1`) instead.
    memoized("GET", "/p/1024");
    memoized("GET", "/p/0"); // survived → still a hit
    expect(calls).toBe(1025);
    memoized("GET", "/p/1"); // evicted in its place → re-resolved
    expect(calls).toBe(1026);
  });

  it("spares an entry hit since the hand last passed it (SIEVE, not FIFO)", () => {
    let calls = 0;
    const memoized = memoizeRouteRulesMatcher(
      () => (calls++, { routeRules: {}, matchedRules: {}, routeRuleMiddleware: [] }),
      { max: 4 },
    );
    for (const p of ["/a", "/b", "/c", "/d"]) memoized("GET", p);
    expect(calls).toBe(4);
    memoized("GET", "/a"); // hit — marks /a as visited
    // Each miss evicts one entry. /a is spared on the pass that reaches it, so
    // the three untouched entries go first.
    memoized("GET", "/x");
    memoized("GET", "/y");
    memoized("GET", "/z");
    expect(calls).toBe(7);
    memoized("GET", "/a"); // still resident; plain FIFO would have evicted it
    expect(calls).toBe(7);
    for (const p of ["/b", "/c", "/d"]) memoized("GET", p); // all evicted
    expect(calls).toBe(10);
  });

  it("keeps a hot path cached under a flood of one-shot paths", () => {
    let calls = 0;
    const memoized = memoizeRouteRulesMatcher(
      () => (calls++, { routeRules: {}, matchedRules: {}, routeRuleMiddleware: [] }),
      { max: 16 },
    );
    let hotMisses = 0;
    for (let i = 0; i < 500; i++) {
      const before = calls;
      memoized("GET", "/hot");
      if (calls !== before) hotMisses++;
      // One-shot dynamic paths, interleaved 1:1 with the hot path.
      memoized("GET", `/scan/${i}`);
    }
    // Resolved once, then never evicted again.
    expect(hotMisses).toBe(1);
  });

  it("holds the cap when the key space exceeds it", () => {
    let calls = 0;
    const memoized = memoizeRouteRulesMatcher(
      () => (calls++, { routeRules: {}, matchedRules: {}, routeRuleMiddleware: [] }),
      { max: 8 },
    );
    // 200 distinct keys cycled through an 8-entry cache. No key is ever hit
    // twice while resident, so nothing is ever spared and every request misses.
    // If the cap leaked, the second lap onward would be all hits and `calls`
    // would settle at 200.
    for (let lap = 0; lap < 10; lap++) {
      for (let i = 0; i < 200; i++) memoized("GET", `/p/${i}`);
    }
    expect(calls).toBe(2000);
  });

  it("evicts a just-cleared entry when the whole cache is visited", () => {
    // The sweep's termination case: with every entry spared, the hand clears
    // all of them, runs off the end, wraps to the oldest and evicts the entry
    // whose reprieve it just spent. A hand that stopped at the end instead of
    // wrapping would return without evicting and let the map outgrow the cap.
    let calls = 0;
    const memoized = memoizeRouteRulesMatcher(
      () => (calls++, { routeRules: {}, matchedRules: {}, routeRuleMiddleware: [] }),
      { max: 3 },
    );
    for (const p of ["/a", "/b", "/c"]) memoized("GET", p);
    for (const p of ["/a", "/b", "/c"]) memoized("GET", p); // all now visited
    expect(calls).toBe(3);
    memoized("GET", "/d"); // full sweep, wrap, evict /a
    expect(calls).toBe(4);
    memoized("GET", "/b"); // spared by the sweep, still resident
    memoized("GET", "/c");
    expect(calls).toBe(4);
    memoized("GET", "/a"); // the one the wrap took
    expect(calls).toBe(5);
  });

  it("a non-positive cap disables memoization (not a cap of 1)", () => {
    for (const max of [0, -1]) {
      let calls = 0;
      const memoized = memoizeRouteRulesMatcher(
        () => (calls++, { routeRules: {}, matchedRules: {}, routeRuleMiddleware: [] }),
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
    // Per-rule provenance (which pattern matched, its params) is not on the
    // context — it rides the matched rules, which a hand-rolled integration
    // keeps hold of exactly like `routeRules()` does.
    let matchedRules: MatchedRouteRules | undefined;
    app.use((event, next) => {
      const matched = matcher(event.req.method, event.url.pathname);
      event.context.routeRules = matched.routeRules;
      matchedRules = matched.matchedRules;
      return matched.routeRuleMiddleware.length > 0
        ? callMiddleware(event, matched.routeRuleMiddleware, () => next())
        : next();
    });
    app.get("/api/:section/:id", () => ({ params: matchedRules?.custom?.params }));
    for (let i = 0; i < 3; i++) {
      const res = await app.fetch(new Request("http://test/api/users/42"));
      expect(await res.json()).toEqual({ params: { section: "users", id: "42" } });
      // the `cors` rule (h3 handleCors) sets the permissive origin
      expect(res.headers.get("access-control-allow-origin")).toBe("*");
    }
    // encoded separator still resolves the canonical `/admin/**` rule when memoized
    const canonical = await app.fetch(new Request("http://test/admin%2fpanel"));
    expect(canonical.status).toBe(307);
    const canonicalAgain = await app.fetch(new Request("http://test/admin%2fpanel"));
    expect(canonicalAgain.status).toBe(307);
  });
});
