import { describe, expect, it, vi } from "vitest";
import { createMatcherFromFind, createRouteRulesMatcher } from "../../src/rules/match.ts";
import { mergeMatchedRouteRules } from "../../src/rules/merge.ts";
import type { RouteRuleLayer } from "../../src/rules/merge.ts";
import { normalizeRouteRules } from "../../src/rules/normalize.ts";
import type { RouteRuleConfig } from "../../src/rules/types.ts";
import { FIXTURE_HANDLERS } from "./_fixture.ts";

// The cascades below include cache/swr rules; register the fixture handler set
// (the core registry ships no `cache` handler).
const matcher = (config: Record<string, RouteRuleConfig>) =>
  createRouteRulesMatcher(normalizeRouteRules(config), { handlers: FIXTURE_HANDLERS });

describe("merge algorithm", () => {
  it("more specific patterns win (specificity ordering)", () => {
    const match = matcher({
      "/api/**": { headers: { "x-a": "broad" } },
      "/api/x": { headers: { "x-a": "narrow" } },
    });
    expect(match("GET", "/api/x").routeRules.headers!.options).toEqual({ "x-a": "narrow" });
    expect(match("GET", "/api/y").routeRules.headers!.options).toEqual({ "x-a": "broad" });
  });

  // rou3's `findAllRoutes` order is containment order for plain patterns but not
  // for modifier params (`:x?`, `:x*`, `:x+`), and merging a chain in the wrong
  // order lets the BROADER pattern win — its options override the narrower
  // pattern's, and its `false` reset deletes the narrower pattern's rule outright.
  // This is the default (no `preMerge`, no compiler) path.
  describe("matched layers are merged in containment order, not findAllRoutes order", () => {
    // Two distinct upstream shapes: `/api/*​/:path*` subsumes `/api/*​/**` and comes
    // back last in BOTH registration orders (rou3 sorts it there), while
    // `/admin/:page?` subsumes `/admin` and gets no specificity sort at all (both
    // weigh 0 in `pushSorted`, so config order survives) — hence both orders below.
    const SHAPES: Array<[string, string, string, string]> = [
      ["stable inversion", "/api/*/**", "/api/*/:path*", "/api/v1/x"],
      ["unsorted (config order)", "/admin", "/admin/:page?", "/admin"],
    ];

    it.each(SHAPES)("%s: the narrower pattern's options win", (_l, narrow, broad, pathname) => {
      for (const config of [
        { [narrow]: { headers: { who: "narrow" } }, [broad]: { headers: { who: "broad" } } },
        { [broad]: { headers: { who: "broad" } }, [narrow]: { headers: { who: "narrow" } } },
      ]) {
        const rule = matcher(config)("GET", pathname).routeRules.headers!;
        expect(rule.options, JSON.stringify(config)).toEqual({ who: "narrow" });
        expect(rule.route).toBe(narrow);
      }
    });

    const gate = { basicAuth: { username: "admin", password: "s3cret" } } satisfies RouteRuleConfig;
    const reset = { basicAuth: false } satisfies RouteRuleConfig;

    it.each(SHAPES)("%s: a broader `false` never resets a narrower gate", (_l, n, b, pathname) => {
      for (const config of [
        { [n]: gate, [b]: reset },
        { [b]: reset, [n]: gate },
      ]) {
        const { routeRules } = matcher(config)("GET", pathname);
        expect(routeRules.basicAuth?.options, JSON.stringify(config)).toMatchObject({
          username: "admin",
        });
      }
    });

    it.each(SHAPES)("%s: a narrower `false` still resets a broader rule", (_l, n, b, pathname) => {
      // The other direction must keep working: reordering may not turn a
      // legitimate narrow reset into a no-op.
      expect(
        matcher({ [b]: gate, [n]: reset })("GET", pathname).routeRules.basicAuth,
      ).toBeUndefined();
    });
  });

  it("object options shallow-merge across layers", () => {
    const match = matcher({
      "/api/**": { headers: { "x-a": "1", "x-b": "1" } },
      "/api/x": { headers: { "x-b": "2", "x-c": "2" } },
    });
    expect(match("GET", "/api/x").routeRules.headers!.options).toEqual({
      "x-a": "1",
      "x-b": "2",
      "x-c": "2",
    });
  });

  it("non-object options override", () => {
    const match = matcher({
      "/api/**": { custom: { nested: true } },
      "/api/x": { custom: "flat" },
    });
    expect(match("GET", "/api/x").routeRules.custom!.options).toBe("flat");
  });

  it("`null` options override an inherited object (typeof null quirk)", () => {
    // `typeof null === "object"`: a spread-merge would silently keep the
    // inherited object; `null` must behave like any other non-object override.
    const match = matcher({
      "/api/**": { custom: { x: 1 } },
      "/api/x": { custom: null },
    });
    expect(match("GET", "/api/x").routeRules.custom!.options).toBe(null);
    expect(match("GET", "/api/y").routeRules.custom!.options).toEqual({ x: 1 });
  });

  it("`redirect: false` / `proxy: false` reset inherited rules", () => {
    const match = matcher({
      "/old/**": { redirect: "/new", proxy: "/upstream" },
      "/old/keep/**": { redirect: false, proxy: false },
    });
    const inherited = match("GET", "/old/x");
    expect(inherited.routeRules.redirect).toBeDefined();
    expect(inherited.routeRules.proxy).toBeDefined();
    const reset = match("GET", "/old/keep/x");
    expect(reset.routeRules.redirect).toBeUndefined();
    expect(reset.routeRules.proxy).toBeUndefined();
    expect(reset.routeRuleMiddleware).toHaveLength(0);
  });

  it("params stay undefined when no matched layer carries params", () => {
    // Multi-layer merges must not materialize a phantom `{}` (also keeps plain
    // and preMerge results structurally identical).
    const match = matcher({
      "/a": { headers: { x: "agnostic" } },
      "GET /a": { headers: { x: "get" } },
    });
    const rule = match("GET", "/a").routeRules.headers!;
    expect(rule.options).toEqual({ x: "get" });
    expect(rule.params).toBeUndefined();
  });

  it("`false` resets an inherited rule (noncached cascade)", () => {
    // Mirrors the Nitro fixture `/rules/_/noncached/**` + `/rules/_/noncached/cached`
    const match = matcher({
      "/rules/_/noncached/cached": { swr: true },
      "/rules/_/noncached/**": { swr: false, cache: false },
      "/rules/_/cached/noncached": { cache: false, swr: false },
      "/rules/_/cached/**": { swr: true },
    });
    // `cache: false` on the subtree resets, the more specific rule re-adds
    expect(match("GET", "/rules/_/noncached/cached").routeRules.cache!.options).toEqual({
      swr: true,
    });
    expect(match("GET", "/rules/_/noncached/other").routeRules.cache).toBeUndefined();
    // inherited cache reset by a more specific `false`
    expect(match("GET", "/rules/_/cached/noncached").routeRules.cache).toBeUndefined();
    expect(match("GET", "/rules/_/cached/other").routeRules.cache!.options).toEqual({
      swr: true,
    });
  });

  it("bare `swr: false` disables an inherited swr cache rule", () => {
    // A broad rule expands `swr` -> `cache`; a more specific rule sets bare
    // `swr: false` WITHOUT an explicit `cache: false`. The reset must still fire.
    const match = matcher({
      "/**": { swr: 3600 },
      "/api/test": { swr: false },
    });
    expect(match("GET", "/api/other").routeRules.cache!.options).toMatchObject({
      swr: true,
      maxAge: 3600,
    });
    expect(match("GET", "/api/test").routeRules.cache).toBeUndefined();
  });

  it("`false` on the most specific layer yields no middleware for that rule", () => {
    const match = matcher({
      "/rules/basic-auth/**": { basicAuth: { username: "admin", password: "secret" } },
      "/rules/basic-auth/no-auth/**": { basicAuth: false },
    });
    const on = match("GET", "/rules/basic-auth/test");
    expect(on.routeRules.basicAuth).toBeDefined();
    expect(on.routeRuleMiddleware).toHaveLength(1);
    const off = match("GET", "/rules/basic-auth/no-auth/x");
    expect(off.routeRules.basicAuth).toBeUndefined();
    expect(off.routeRuleMiddleware).toHaveLength(0);
  });

  it("route and params take the more specific match's values (params merged)", () => {
    const match = matcher({
      "/api/:section/**": { custom: { a: 1 } },
      "/api/:section/:id": { custom: { b: 2 } },
    });
    const { routeRules } = match("GET", "/api/users/42");
    expect(routeRules.custom!.route).toBe("/api/:section/:id");
    expect(routeRules.custom!.params).toMatchObject({ section: "users", id: "42" });
    expect(routeRules.custom!.options).toEqual({ a: 1, b: 2 });
  });

  it("a matched rule carries no `name`/`method` (key is the name; scope is not one field)", () => {
    // `name` is the map key, and `method` would be meaningless on a rule merged
    // from a method-agnostic layer plus a method-scoped one (below: `x` comes
    // from the agnostic layer, `y` from the POST layer).
    const config = {
      "/api/**": { custom: { x: 1 } },
      "POST /api/**": { custom: { y: 2 } },
    } satisfies Record<string, RouteRuleConfig>;
    for (const preMerge of [false, true]) {
      const match = createRouteRulesMatcher(normalizeRouteRules(config), {
        handlers: FIXTURE_HANDLERS,
        preMerge,
      });
      const rule = match("POST", "/api/x").routeRules.custom!;
      expect(Object.keys(rule).sort()).toEqual(["handler", "options", "params", "route"]);
      expect(rule.options).toEqual({ x: 1, y: 2 });
    }
  });

  it("middleware is sorted by handler order (basicAuth first)", () => {
    const match = matcher({
      "/app/**": { redirect: "/login", basicAuth: { username: "u", password: "p" } },
    });
    const { routeRules, routeRuleMiddleware } = match("GET", "/app/x");
    expect(routeRuleMiddleware).toHaveLength(2);
    // basicAuth has order -2 (outer to headers at -1): its middleware comes first
    expect(routeRules.basicAuth!.handler!.order).toBe(-2);
    expect(routeRuleMiddleware[0]).toBe(
      routeRuleMiddleware.find((mw) => mw.name === "authRouteRule"),
    );
  });

  it("sorts middleware by numeric handler order (ascending, custom bands mixed with defaults)", () => {
    const mk = (name: string) => ({
      // name the produced middleware so the resulting order is observable
      handler: () => Object.defineProperty(() => undefined, "name", { value: name }),
    });
    const match = createRouteRulesMatcher(
      normalizeRouteRules({
        "/x": { isr: true, custom: true, tags: true, shout: true, "my-rule": true },
      }),
      {
        handlers: {
          isr: { ...mk("isr"), order: 2 },
          custom: { ...mk("custom"), order: -5 }, // outer to all built-ins
          tags: { ...mk("tags"), order: -1 }, // the `headers` band
          shout: mk("shout"), // default 0
          "my-rule": { ...mk("my-rule"), order: 1 },
        },
      },
    );
    const { routeRuleMiddleware } = match("GET", "/x");
    expect(routeRuleMiddleware.map((mw) => mw.name)).toEqual([
      "custom", // -5
      "tags", // -1
      "shout", // 0
      "my-rule", // 1
      "isr", // 2
    ]);
  });

  it("data-only rules are merged but produce no middleware", () => {
    const match = matcher({
      "/blog/**": { prerender: true, isr: 60 },
    });
    const { routeRules, routeRuleMiddleware } = match("GET", "/blog/post");
    expect(routeRules.prerender!.options).toBe(true);
    expect(routeRules.isr!.options).toBe(60);
    expect(routeRuleMiddleware).toHaveLength(0);
  });
});

describe("method-scoped rules", () => {
  it("apply only to their method", () => {
    const match = matcher({
      "GET /api/**": { headers: { "x-m": "get" } },
    });
    expect(match("GET", "/api/x").routeRules.headers!.options).toEqual({ "x-m": "get" });
    expect(match("POST", "/api/x").routeRules.headers).toBeUndefined();
  });

  it("merge after (override) method-agnostic rules for the same pattern", () => {
    const match = matcher({
      "/api/**": { headers: { "x-a": "all", "x-b": "all" } },
      "GET /api/**": { headers: { "x-b": "get" } },
    });
    // GET: agnostic merges first, method-scoped overrides on top
    expect(match("GET", "/api/x").routeRules.headers!.options).toEqual({
      "x-a": "all",
      "x-b": "get",
    });
    // Other methods: agnostic rule only
    expect(match("POST", "/api/x").routeRules.headers!.options).toEqual({
      "x-a": "all",
      "x-b": "all",
    });
  });

  it("method-scoped `false` resets an agnostic rule for that method only", () => {
    const match = matcher({
      "/api/**": { basicAuth: { username: "u", password: "p" } },
      "GET /api/**": { basicAuth: false },
    });
    expect(match("GET", "/api/x").routeRules.basicAuth).toBeUndefined();
    expect(match("POST", "/api/x").routeRules.basicAuth).toBeDefined();
  });

  it("method-agnostic-only rule sets behave identically for all methods", () => {
    const match = matcher({
      "/api/**": { headers: { "x-a": "1" } },
    });
    for (const method of ["GET", "POST", "PUT", "DELETE", ""]) {
      expect(match(method, "/api/x").routeRules.headers!.options).toEqual({ "x-a": "1" });
    }
  });
});

describe("dual-path union (Nitro #4396)", () => {
  it("canonical-path match adds a rule the raw path missed", () => {
    // `/app/admin%2fpanel` is served by the broad rule on the raw path but
    // canonicalizes to `/app/admin/panel`, which the auth rule guards.
    const match = matcher({
      "/app/**": { headers: { "x-app": "1" } },
      "/app/admin/**": { basicAuth: { username: "admin", password: "secret" } },
    });
    const { routeRules } = match("GET", "/app/admin%2fpanel");
    expect(routeRules.headers!.options).toEqual({ "x-app": "1" });
    expect(routeRules.basicAuth!.options).toMatchObject({ username: "admin" });
  });

  it("a %5c separator is canonicalized at the matcher level too", () => {
    // `%5c` is opaque in `event.url.pathname` (canonicalization never decodes a
    // separator), so this branch *is* reachable e2e — see rules.test.ts. Pinned
    // here at the matcher level too, since `h3/rules` is usable standalone.
    const match = matcher({
      "/app/**": { headers: { "x-app": "1" } },
      "/app/admin/**": { basicAuth: { username: "admin", password: "secret" } },
    });
    const { routeRules } = match("GET", "/app/admin%5cpanel");
    expect(routeRules.headers!.options).toEqual({ "x-app": "1" });
    expect(routeRules.basicAuth!.options).toMatchObject({ username: "admin" });
  });

  it("canonical rule overrides raw on overlap (more specific wins)", () => {
    // Mirrors `/rules/ba-nested/**` (Broad Area) + `/rules/ba-nested/admin/**`
    // (Admin Area): the narrower canonical realm must win.
    const match = matcher({
      "/rules/ba-nested/**": {
        basicAuth: { username: "broad", password: "secret", realm: "Broad Area" },
      },
      "/rules/ba-nested/admin/**": {
        basicAuth: { username: "admin", password: "secret", realm: "Admin Area" },
      },
    });
    const { routeRules } = match("GET", "/rules/ba-nested/admin%2fpanel");
    expect(routeRules.basicAuth!.options).toMatchObject({ realm: "Admin Area" });
  });

  it("a single-segment `false` cannot dodge auth once decoded to multiple segments", () => {
    // Mirrors `/rules/ba-off/*` + `/rules/ba-off/**`: the `false` reset applies
    // to the served path's own resolution, but the canonical path still enables
    // auth.
    const match = matcher({
      "/rules/ba-off/**": {
        basicAuth: { username: "admin", password: "secret", realm: "Off Area" },
      },
      "/rules/ba-off/*": { basicAuth: false },
    });
    // genuine single segment: auth disabled
    expect(match("GET", "/rules/ba-off/a").routeRules.basicAuth).toBeUndefined();
    // encoded separator: canonical two-segment path re-enables auth
    const { routeRules } = match("GET", "/rules/ba-off/a%2fb");
    expect(routeRules.basicAuth!.options).toMatchObject({ realm: "Off Area" });
  });

  it("a `false` reset on the canonical path never strips a rule the raw path resolved", () => {
    // Mirrors `/rules/ba-strip/**` + `/rules/ba-strip/off/**`: the served path
    // (single opaque segment) matches the broad auth rule; the canonical path's
    // `false` (targeting the two-segment subtree) must not delete it.
    const match = matcher({
      "/rules/ba-strip/**": {
        basicAuth: { username: "admin", password: "secret", realm: "Strip Area" },
      },
      "/rules/ba-strip/off/**": { basicAuth: false },
    });
    const { routeRules } = match("GET", "/rules/ba-strip/off%2fx");
    expect(routeRules.basicAuth!.options).toMatchObject({ realm: "Strip Area" });
    // genuine two-segment path: auth disabled as configured
    expect(match("GET", "/rules/ba-strip/off/x").routeRules.basicAuth).toBeUndefined();
  });

  it("a `..` next to an encoded separator cannot dodge a narrower gate on a slash-merging downstream", () => {
    // Report vuln-12006 (HackerOne #3721382): h3's canonical form keeps the
    // empty segment a `..` adjacent to an encoded separator produces
    // (`/api/foo/%2e%2e/%2fadmin/secret` → `/api//admin/secret`), so rou3's
    // per-segment match misses `/api/admin/**` and `basicAuth` never runs — yet a
    // downstream that decodes `%2f` then merges slashes resolves it to
    // `/api/admin/secret`. The matcher must also match the slash-merged canonical
    // reading (`/api/admin/secret`), like `isPathInScope` already does for scope.
    //
    // Payloads below are pre-h3 wire forms fed straight to the matcher. Through
    // real h3 the `%2e%2e` is decoded and resolved first, so e.g.
    // `/api/foo/%2e%2e/%2fadmin/secret` arrives as `/api/%2fadmin/secret` — which
    // reaches the same canonical (`/api//admin/secret`) and slash-merged
    // (`/api/admin/secret`) readings, so the invariant and these assertions hold
    // either way. `%2f` is the only part of these payloads h3 leaves opaque, and
    // it is the part that makes the bypass real; see `test/h3-decode.test.ts`.
    const match = matcher({
      "/api/**": { headers: { "x-app": "1" } },
      "/api/admin/**": { basicAuth: { username: "admin", password: "secret" } },
    });
    // Baseline: the raw and canonical-only variants already fire.
    expect(match("GET", "/api/admin/secret").routeRules.basicAuth).toBeDefined();
    expect(match("GET", "/api/foo/%2e%2e%2fadmin/secret").routeRules.basicAuth).toBeDefined();
    expect(match("GET", "/api/foo/..%2fadmin/secret").routeRules.basicAuth).toBeDefined();
    // The surviving bypass: `..` separated from `%2f` by a literal `/`.
    for (const payload of [
      "/api/foo/%2e%2e/%2fadmin/secret",
      "/api/foo/..%2f%2fadmin/secret",
      "/api/foo/%2e%2e%2f%2fadmin/secret",
      "/api/foo/%2e%2e/%5cadmin/secret",
      "/api/foo/%252e%252e/%252fadmin/secret",
    ]) {
      const { routeRules } = match("GET", payload);
      expect(routeRules.basicAuth, payload).toBeDefined();
      expect(routeRules.basicAuth!.options, payload).toMatchObject({ username: "admin" });
      // union-only: the broad rule the raw path resolved is never stripped.
      expect(routeRules.headers!.options, payload).toEqual({ "x-app": "1" });
    }
  });

  it("the slash-merged lookup never strips a rule the raw path resolved (union-only)", () => {
    // A benign doubled slash whose merged canonical form lands on a `false`-reset
    // subtree must not delete the rule the served path resolved.
    const match = matcher({
      "/api/**": {
        basicAuth: { username: "admin", password: "secret", realm: "Broad" },
      },
      "/api/off/**": { basicAuth: false },
    });
    // Raw path stays a single opaque segment under `/api/**`; the merged reading
    // (`/api/off/x`) hits the reset but union-only must keep the broad rule.
    const { routeRules } = match("GET", "/api/off%2f%2fx");
    expect(routeRules.basicAuth!.options).toMatchObject({ realm: "Broad" });
  });

  it("a SIBLING-scope `false` reading never strips a gate the served (raw) path resolved", () => {
    // The mutation-tight strip case: unlike an ancestor `false` (which deletes
    // within its own reading before the union, so it can't test cross-reading
    // leakage), a *sibling* `false` is matched ONLY by the crafted canonical
    // reading — no co-matching protector deletes it first. `/app/admin/**`
    // matches the payload as given, while its canonical reading `/app/public/x`
    // matches only the `basicAuth: false` sibling. The union must NOT let that
    // sibling `false` delete the admin gate.
    //
    // SYNTHETIC INPUT — defense-in-depth for non-h3 callers of the exported
    // matchers (compiled matchers, other frameworks), NOT h3 traffic. h3 decodes
    // `%2e` and resolves the dots *before* dispatch (see `test/h3-decode.test.ts`),
    // so a real h3 request for `/app/admin/%2e%2e/public/x` reaches the matcher as
    // `/app/public/x` and is legitimately served under the `false` sibling — the
    // encoded `..` does NOT stay opaque in dispatch. Feeding the pre-decode wire
    // form directly is what makes the `%2e` climb testable at all here.
    const match = matcher({
      "/app/admin/**": {
        basicAuth: { username: "admin", password: "s3cret", realm: "Admin" },
      },
      "/app/public/**": { basicAuth: false },
    });
    for (const payload of [
      "/app/admin/%2e%2e/public/x", // encoded `..` climbs to the sibling
      "/app/admin/%252e%252e/public/x", // double-encoded `..`
      "/app/admin/x/%2e%2e/%2e%2e/public/y", // deeper climb
    ]) {
      const { routeRules } = match("GET", payload);
      expect(routeRules.basicAuth?.options, payload).toMatchObject({ username: "admin" });
    }
    // Control: a request genuinely served under the sibling is disabled.
    expect(match("GET", "/app/public/x").routeRules.basicAuth).toBeUndefined();
  });

  it("a non-basicAuth disabling value (`cors: false`) also never leaks across readings", () => {
    // The `false`-reset invariant is value-agnostic — the delete branch keys off
    // `options === false`, not the rule name. A sibling `cors: false` reached only
    // via a decoded reading must not strip the `cors` policy the served (raw) path
    // resolved, exactly as with `basicAuth`.
    const match = matcher({
      "/app/api/**": { cors: { origin: ["https://trusted.example"] } },
      "/app/open/**": { cors: false },
    });
    for (const payload of ["/app/api/%2e%2e/open/x", "/app/api/%252e%252e/open/x"]) {
      const { routeRules } = match("GET", payload);
      expect(routeRules.cors?.options, payload).toMatchObject({
        origin: ["https://trusted.example"],
      });
    }
    // Control: genuinely served under the sibling — cors disabled as configured.
    expect(match("GET", "/app/open/x").routeRules.cors).toBeUndefined();
  });

  it("no encoding of a protected path ever weakens or drops its gate (over-decode invariant)", () => {
    // The core safety property behind pessimistic decoding, stated adversarially:
    // for ANY alternate reading of a genuinely-admin path, the resolved gate must
    // be at least as strong as the raw reading — never the broad `guest` rule,
    // never absent, never the sibling `off` reset. Encodes the fan-out an
    // attacker controls (encoded separators/dots at any nesting, empty segments,
    // no-op `..`) as an enumerated matrix so a regression in any single reading
    // (canonical, merged, or the union direction) trips this.
    const match = matcher({
      "/app/**": { basicAuth: { username: "guest", password: "guest" } },
      "/app/admin/**": {
        basicAuth: { username: "admin", password: "s3cret", realm: "Admin" },
      },
      "/app/admin/off/**": { basicAuth: false },
    });
    // Every payload below is an encoding of the genuinely-admin `/app/admin/panel`
    // — none resolves into the `off` subtree — so all must stay admin-gated.
    for (const payload of [
      "/app/admin/panel", // baseline
      "/app/admin%2fpanel", // encoded separator
      "/app/admin%252fpanel", // double-encoded separator
      "/app/admin/pane%6c", // encoded non-separator byte (opaque)
      "/app/admin/./panel", // no-op dot segment
      "/app/admin//panel", // interior empty segment
      "/app/admin/x/%2e%2e/panel", // encoded `..` that resolves back inside admin
      "/app/%2e/admin/panel", // leading no-op dot
      "/app/admin/off%2f..%2fpanel", // brushes `off` then climbs back out — still admin
    ]) {
      const { routeRules } = match("GET", payload);
      expect(routeRules.basicAuth?.options, payload).toMatchObject({ username: "admin" });
    }
    // Control: a path that genuinely resolves into the `off` subtree is disabled,
    // proving the matrix above passes because the paths stay admin — not because
    // the reset is inert.
    expect(match("GET", "/app/admin/off/x").routeRules.basicAuth).toBeUndefined();
  });

  // A `false` reset is implemented as a `delete`, so a reset rule would otherwise
  // be indistinguishable from one that never matched and a broader alternate
  // reading would take the unguarded ADD branch, restoring it at full breadth.
  // `/app/private/x%2f..%2f..%2fy` is served by h3 under `/app/private/**` (the
  // `%2f` stays opaque in dispatch, so the private handler really runs), yet its
  // canonical reading `/app/y` matches only `/**` — re-adding `cors: *` there
  // makes the private response cross-origin readable.
  //
  // Gating the ADD on `canOverride(resetRoute, incomingRoute)` cannot fix this:
  // this config is isomorphic (under pattern containment) to the
  // `/rules/ba-off/**` + `/rules/ba-off/*` pair three tests above, where the
  // re-add is exactly what keeps the auth gate — both are `{broad B, narrow N
  // carrying the reset}` with the served path matching `{B, N}` and the alternate
  // reading matching `{B}` only. What separates them is the *rule*, not the
  // patterns: re-adding a gate is fail-closed, re-adding a permission undoes the
  // exemption. Hence `RuleHandler.restricting`.
  it("an alternate reading never RESURRECTS a permission the served path reset", () => {
    const match = matcher({
      "/**": { cors: { origin: "*" } },
      "/app/private/**": { cors: false },
    });
    // Control: the reset holds on an uncrafted path.
    expect(match("GET", "/app/private/x").routeRules.cors).toBeUndefined();
    expect(match("GET", "/app/private/x%2f..%2f..%2fy").routeRules.cors).toBeUndefined();
  });

  it("…but a restriction is still re-added, so a reset cannot dodge a gate", () => {
    // The isomorphic counterpart: `basicAuth` is `restricting`, so the exemption
    // written for a single segment does not survive into a reading with two.
    const match = matcher({
      "/app/gate/**": { basicAuth: { username: "admin", password: "s3cret" } },
      "/app/gate/*": { basicAuth: false },
    });
    expect(match("GET", "/app/gate/a").routeRules.basicAuth).toBeUndefined();
    expect(match("GET", "/app/gate/a%2fb").routeRules.basicAuth!.options).toMatchObject({
      username: "admin",
    });
  });

  it("a reset re-resolved later in the same reading is not treated as a reset", () => {
    // `false` then a narrower re-enable: the rule is present, so the union takes
    // the ordinary override path and the reset must not linger as a veto.
    const match = matcher({
      "/**": { cors: { origin: "*" } },
      "/app/**": { cors: false },
      "/app/ok/**": { cors: { origin: ["https://ok.example"] } },
    });
    expect(match("GET", "/app/ok/x").routeRules.cors!.options).toMatchObject({
      origin: ["https://ok.example"],
    });
  });

  it("a broader canonical rule never DOWNGRADES a narrower rule the served path resolved", () => {
    // Encoded-dot escalation: a crafted `%2e%2e` path is served (raw) under a
    // strict narrow gate but canonicalizes *up* to a broad weak rule. The union
    // may only override with an equal-or-more-specific pattern, so the broad rule
    // must NOT weaken the strict gate the served admin path hits.
    // Raw `/app/admin/x/%2e%2e/%2e%2e/%2e%2e/y` matches `/app/admin/**` (h3 serves
    // the admin handler on this literal path); canonical collapses to `/y`, which
    // matches only `/**`.
    const match = matcher({
      "/**": { basicAuth: { username: "guest", password: "guest" } },
      "/app/admin/**": {
        basicAuth: { username: "admin", password: "s3cret", realm: "Admin" },
      },
    });
    const { routeRules } = match("GET", "/app/admin/x/%2e%2e/%2e%2e/%2e%2e/y");
    // Strict admin credentials must survive — not be shallow-merged down to guest.
    expect(routeRules.basicAuth!.options).toMatchObject({
      username: "admin",
      password: "s3cret",
    });
  });

  it("a narrower canonical gate still OVERRIDES a broader raw rule (strengthen path intact)", () => {
    // Guard the other direction: the specificity gate must not block a legitimate
    // strengthen. `/app/admin%2fpanel` is served under `/app/**` (headers) on the
    // raw path; the canonical `/app/admin/panel` reveals the narrower auth gate.
    const match = matcher({
      "/app/**": { headers: { "x-app": "1" } },
      "/app/admin/**": { basicAuth: { username: "admin", password: "secret" } },
    });
    const { routeRules } = match("GET", "/app/admin%2fpanel");
    expect(routeRules.basicAuth!.options).toMatchObject({ username: "admin" });
    expect(routeRules.headers!.options).toEqual({ "x-app": "1" });
  });

  it("a single-wildcard rule still applies to a raw path with an encoded separator", () => {
    // Mirrors `/single-headers/*`: h3 serves the raw single-segment path, so
    // rules matched there must not be dropped by canonicalization.
    const match = matcher({
      "/single-headers/*": { headers: { "x-single": "single" } },
    });
    const { routeRules } = match("GET", "/single-headers/a%2fb");
    expect(routeRules.headers!.options).toEqual({ "x-single": "single" });
  });

  it("skips the second lookup when canonical === raw (fast path)", () => {
    const findRouteRules = vi.fn(() => [] as RouteRuleLayer[]);
    const match = createMatcherFromFind(findRouteRules);
    match("GET", "/plain/path");
    expect(findRouteRules).toHaveBeenCalledTimes(1);
    findRouteRules.mockClear();
    match("GET", "/enc%2foded");
    expect(findRouteRules).toHaveBeenCalledTimes(2);
    expect(findRouteRules).toHaveBeenNthCalledWith(2, "GET", "/enc/oded");
  });
});

describe("mergeMatchedRouteRules (pure)", () => {
  const layer = (
    route: string,
    entries: Array<{ name: string; options: unknown }>,
    params?: Record<string, string>,
  ): RouteRuleLayer => ({
    data: entries.map((e) => ({ ...e, route })),
    params,
  });

  it("merges layers least → most specific", () => {
    const merged = mergeMatchedRouteRules([
      layer("/a/**", [{ name: "headers", options: { a: "1" } }]),
      layer("/a/b", [{ name: "headers", options: { a: "2", b: "2" } }]),
    ]);
    expect(merged.headers!.options).toEqual({ a: "2", b: "2" });
    expect(merged.headers!.route).toBe("/a/b");
  });

  it("unions canonical layers without deleting raw rules", () => {
    const merged = mergeMatchedRouteRules(
      [layer("/a/**", [{ name: "headers", options: { a: "raw" } }])],
      [
        [
          layer("/a/**", [{ name: "headers", options: { a: "raw" } }]),
          layer("/a/b/**", [
            { name: "headers", options: false },
            { name: "basicAuth", options: { username: "u" } },
          ]),
        ],
      ],
    );
    // canonical `false` resolved within its own pass deletes there, but the
    // union can never delete what the raw path resolved
    expect(merged.headers!.options).toEqual({ a: "raw" });
    expect(merged.basicAuth!.options).toEqual({ username: "u" });
  });

  it("orders matched layers by `rank`, with no override predicate involved", () => {
    // Layer ordering must be decided by the build-time rank alone: the only
    // predicate a compiled matcher has by default is `canOverrideRouteShape`,
    // which is *not* exact for modifier params (it reports `/api/*​/**` as
    // subsuming the `/api/*​/:path*` that subsumes it), so a predicate-driven
    // order fails open exactly here. No `canOverride` is passed below.
    const gate = {
      data: [{ name: "basicAuth", route: "/api/*/**", options: { username: "admin" }, rank: 1 }],
    };
    const reset = {
      data: [{ name: "basicAuth", route: "/api/*/:path*", options: false, rank: 0 }],
    };
    // Either arrival order — rou3 hands the broader `:path*` layer over last.
    for (const layers of [
      [gate, reset],
      [reset, gate],
    ]) {
      expect(mergeMatchedRouteRules(layers).basicAuth!.options).toEqual({ username: "admin" });
    }
    // The legitimate direction is untouched: a *narrower* `false` still resets.
    const broadGate = {
      data: [
        { name: "basicAuth", route: "/api/*/:path*", options: { username: "admin" }, rank: 0 },
      ],
    };
    const narrowReset = {
      data: [{ name: "basicAuth", route: "/api/*/**", options: false, rank: 1 }],
    };
    expect(mergeMatchedRouteRules([narrowReset, broadGate]).basicAuth).toBeUndefined();
  });

  it("returns empty map for no layers", () => {
    expect(mergeMatchedRouteRules(undefined)).toEqual({});
    expect(mergeMatchedRouteRules([], [])).toEqual({});
  });

  it("a `__proto__` / `constructor` rule name cannot pollute Object.prototype", () => {
    // Rule names are attacker-influenceable config keys. The merge accumulator is
    // a null-prototype object, so `routeRules["__proto__"]` is a plain own key
    // rather than the inherited `Object.prototype` getter — otherwise the update
    // branch would assign `currentRule.options/route/method` onto Object.prototype
    // (a process-wide DoS). This path bypasses `normalizeRouteRules` (compiled /
    // hand-built matchers), so the runtime merge must be self-defending.
    for (const name of ["__proto__", "constructor"]) {
      const layers = [
        { data: [{ name, route: "/x", options: { polluted: true } }], params: undefined },
      ];
      const merged = mergeMatchedRouteRules(layers as never);
      expect(Object.hasOwn(Object.prototype, "options")).toBe(false);
      expect(Object.hasOwn(Object.prototype, "polluted")).toBe(false);
      expect(({} as Record<string, unknown>).options).toBeUndefined();
      // the rule is still carried as an own key of the (null-proto) result
      expect(Object.keys(merged)).toContain(name);
    }
  });
});
