// Every export must stay tree-shakeable, including namespace member access
// (`import * as rules from "h3/rules"; rules.xyz`): no module-level side
// effects, `/* @__PURE__ */` on module-scope instantiations. Pinned by
// test/rules/treeshake.test.ts.

export { routeRules } from "./middleware.ts";
export type { RouteRulesOptions } from "./middleware.ts";

export {
  createRouteRulesMatcher,
  createMatcherFromFind,
  memoizeRouteRulesMatcher,
} from "./match.ts";

export type {
  RouteRulesMatcher,
  RouteRulesMatcherOptions,
  MatcherMemoizeOptions,
  FindRouteRules,
} from "./match.ts";

export { normalizeRouteRules } from "./normalize.ts";

export { mergeMatchedRouteRules } from "./merge.ts";
export type { RouteRuleEntry, RouteRuleLayer } from "./merge.ts";

export { ruleHandlers } from "./handlers/index.ts";
export { headers } from "./handlers/headers.ts";
export { redirect } from "./handlers/redirect.ts";
export { basicAuth } from "./handlers/basic-auth.ts";
export { cors } from "./handlers/cors.ts";
// `proxy`/`cache` handlers are opt-in subpaths (h3/rules/proxy, h3/rules/cache)
// so proxyRequest/ocache stay out of bundles that don't use them; this factory
// builds a cache handler from an injected `defineCachedHandler`.
export { createCacheRuleHandler } from "./handlers/cache.ts";
export type { CacheRuleHandlerOptions, DefineCachedHandler } from "./handlers/cache.ts";

export type {
  RouteRuleConfig,
  // Re-exported from h3's core types (src/types/route-rules.ts) — one interface,
  // so `declare module "h3/rules"` and `declare module "h3"` merge into the same
  // declaration and a custom rule is declared once.
  RouteRules,
  ResolvedRouteRules,
  BuiltinRouteRules,
  NormalizedRouteRules,
  CacheRuleOptions,
  RedirectRuleOptions,
  ProxyRuleOptions,
  MatchedRouteRule,
  MatchedRouteRules,
  MatchResult,
  RuleHandler,
  RuleHandlers,
  HTTPStatus,
} from "./types.ts";
