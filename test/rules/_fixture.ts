import { cache } from "../../src/rules/cache.ts";
import { proxy } from "../../src/rules/proxy.ts";
import type { RouteRulesMatcher } from "../../src/rules/match.ts";
import { ruleHandlers } from "../../src/rules/handlers/index.ts";
import type { MatchedRouteRule, RouteRuleConfig, RuleHandlers } from "../../src/rules/types.ts";

// The fixture uses `cache`/`swr` and `proxy` rules, and the core registry ships
// neither handler (they live in `h3/rules/cache` / `h3/rules/proxy`) — runtime
// matchers over the fixture must register them (`{ handlers: FIXTURE_HANDLERS }`),
// and compiled-parity harnesses bind the same set as `<ns>$<name>` locals.
export const FIXTURE_HANDLERS: RuleHandlers = { ...ruleHandlers, cache, proxy };

// Shared parity-grid fixture for compiler.test.ts and premerge.test.ts
// (chain-clean by construction so it is valid under `preMerge` too).
// Representative rule set exercising merging, cascades, wildcards, method
// scoping, rule ordering, named params, and data-only rules (mined from the
// Nitro fixture).
export const FIXTURE: Record<string, RouteRuleConfig> = {
  "/rules/headers": { headers: { "cache-control": "s-maxage=60" } },
  "/rules/cors": { cors: true, headers: { "access-control-allow-methods": "GET" } },
  "/rules/redirect": { redirect: "/base" },
  "/rules/redirect/obj": { redirect: { to: "https://h3.dev/", status: 308 } },
  "/rules/redirect/wildcard/**": { redirect: "https://h3.dev/**" },
  "/rules/nested/**": { redirect: "/base", headers: { "x-test": "test" } },
  "/rules/nested/override": { redirect: { to: "/other" } },
  "/rules/_/noncached/cached": { swr: true },
  "/rules/_/noncached/**": { swr: false, cache: false, isr: false },
  "/rules/_/cached/noncached": { cache: false, swr: false, isr: false },
  "/rules/_/cached/**": { swr: true },
  "/api/proxy/**": { proxy: "/api/echo" },
  // `cors` carries both an options object and the `false` reset marker, so the
  // cascade/reset shapes below are spelled with it.
  "/policy/**": { cors: { origin: ["https://secure.example"] } },
  "/policy/open/**": { cors: false },
  "/policy-nested/**": { cors: { origin: ["https://broad.example"] } },
  "/policy-nested/admin/**": { cors: { origin: ["https://admin.example"] } },
  "/policy-off/**": { cors: { origin: ["https://off.example"] } },
  "/policy-off/*": { cors: false },
  // Reserved character in the pattern: matched through the decoded reading when
  // the request spells it `%40` (see encoding.test.ts).
  "/@handles/**": { cors: { origin: ["https://handles.example"] } },
  "/blog/**": { prerender: true, isr: 60 },
  "GET /api/cached/**": { swr: 60 },
  "/api/cached/**": { headers: { "x-all": "1" } },
  "/params/:section/**": { custom: { a: 1 } },
  "/params/:section/:id": { custom: { b: 2 } },
  // Modifier params: rou3 returns these layers out of containment order —
  // `/mod/opt/:page?` subsumes `/mod/opt` yet comes back after it, and
  // `/mod/rep/*/:path*` subsumes `/mod/rep/*/**`. The narrower pattern's rule is
  // the one a layer-order regression drops, so that is where it sits.
  "/mod/opt": { cors: { origin: ["https://opt.example"] } },
  "/mod/opt/:page?": { headers: { "x-mod-opt": "1" } },
  "/mod/rep/*/**": { cors: { origin: ["https://rep.example"] } },
  "/mod/rep/*/:path*": { headers: { "x-mod-rep": "1" } },
  // …and the shape that decides a reset: a broader modifier pattern resetting
  // the narrower pattern's rule.
  "/mod/reset/*/**": { cors: { origin: ["https://reset.example"] } },
  "/mod/reset/*/:path*": { cors: false },
  "/**": { headers: { "x-catch": "all" } },
};

// Probe grid: method × path over interesting cases (incl. encoded separators
// and named-param extraction).
export const PROBES: Array<[string, string]> = [
  ["GET", "/rules/headers"],
  ["GET", "/rules/cors"],
  ["GET", "/rules/redirect"],
  ["GET", "/rules/redirect/obj"],
  ["GET", "/rules/redirect/wildcard/docs"],
  ["GET", "/rules/nested/override"],
  ["GET", "/rules/nested/base"],
  ["GET", "/rules/_/noncached/cached"],
  ["GET", "/rules/_/noncached/other"],
  ["GET", "/rules/_/cached/noncached"],
  ["GET", "/rules/_/cached/other"],
  ["POST", "/api/proxy/hello"],
  ["GET", "/policy/test"],
  ["GET", "/policy/open/x"],
  ["GET", "/policy-nested/admin%2fpanel"],
  ["GET", "/policy-off/a"],
  ["GET", "/policy-off/a%2fb"],
  ["GET", "/@handles/pooya"],
  ["GET", "/%40handles/pooya"],
  ["GET", "/blog/post"],
  ["GET", "/api/cached/x"],
  // HEAD resolves the GET layer (RFC 9110) — pins that the fallback lives in the
  // shared router build, so compiled and pre-merged matchers inherit it.
  ["HEAD", "/api/cached/x"],
  ["POST", "/api/cached/x"],
  ["DELETE", "/api/cached/x"],
  ["GET", "/params/users/42"],
  ["POST", "/params/users/42"],
  ["GET", "/params/users/42/nested"],
  ["GET", "/params/users"],
  // Modifier-param chains, where rou3's layer order contradicts containment.
  ["GET", "/mod/opt"],
  ["GET", "/mod/opt/page1"],
  ["GET", "/mod/rep/v1/x"],
  ["GET", "/mod/rep/v1"],
  ["GET", "/mod/reset/v1/x"],
  ["GET", "/unmatched-by-specific/x"],
  ["GET", "/"],
];

export interface RuleSnapshot {
  route: string;
  options: unknown;
  params: Record<string, string> | undefined;
  hasHandler: boolean;
  order: number | undefined;
}

export interface MatchSnapshot {
  rules: Record<string, RuleSnapshot>;
  middlewareCount: number;
}

// Structural view of a match result (handler functions compared by presence +
// order only — the runtime matcher's cache handler is instance-scoped, so
// identity intentionally differs from the compiled registry reference).
export function snapshotResult(result: ReturnType<RouteRulesMatcher>): MatchSnapshot {
  // Snapshot the *matched* rules: the published `routeRules` map carries only
  // the merged options, so a parity check built on it could not see the
  // provenance (route/params) or the handler binding the three execution modes
  // must agree on.
  const rules = Object.fromEntries(
    Object.entries(result.matchedRules).map(([name, rule]) => {
      const r = rule as MatchedRouteRule;
      return [
        name,
        {
          route: r.route,
          options: r.options,
          params: r.params ?? undefined,
          hasHandler: !!r.handler,
          order: r.handler?.order,
        },
      ];
    }),
  );
  return { rules, middlewareCount: result.routeRuleMiddleware.length };
}
