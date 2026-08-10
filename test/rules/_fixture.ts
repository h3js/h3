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
// scoping, auth ordering, named params, and data-only rules (mined from the
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
  "/rules/basic-auth/**": {
    basicAuth: { username: "admin", password: "secret", realm: "Secure Area" },
  },
  "/rules/basic-auth/no-auth/**": { basicAuth: false },
  "/rules/ba-nested/**": { basicAuth: { username: "broad", password: "s", realm: "Broad" } },
  "/rules/ba-nested/admin/**": { basicAuth: { username: "admin", password: "s", realm: "Admin" } },
  "/rules/ba-off/**": { basicAuth: { username: "admin", password: "s", realm: "Off" } },
  "/rules/ba-off/*": { basicAuth: false },
  "/blog/**": { prerender: true, isr: 60 },
  "GET /api/cached/**": { swr: 60 },
  "/api/cached/**": { headers: { "x-all": "1" } },
  "/params/:section/**": { custom: { a: 1 } },
  "/params/:section/:id": { custom: { b: 2 } },
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
  ["GET", "/rules/basic-auth/test"],
  ["GET", "/rules/basic-auth/no-auth/x"],
  ["GET", "/rules/ba-nested/admin%2fpanel"],
  ["GET", "/rules/ba-off/a"],
  ["GET", "/rules/ba-off/a%2fb"],
  ["GET", "/blog/post"],
  ["GET", "/api/cached/x"],
  ["POST", "/api/cached/x"],
  ["DELETE", "/api/cached/x"],
  ["GET", "/params/users/42"],
  ["POST", "/params/users/42"],
  ["GET", "/params/users/42/nested"],
  ["GET", "/params/users"],
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
  const rules = Object.fromEntries(
    Object.entries(result.routeRules).map(([name, rule]) => {
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
