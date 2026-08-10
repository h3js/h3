import { callMiddleware } from "../middleware.ts";
import { isPreflightRequest } from "../utils/cors.ts";
import type { H3Event } from "../event.ts";
import type { Middleware } from "../types/handler.ts";
import {
  buildRouteRuleMiddleware,
  createRouteRulesMatcher,
  memoizeRouteRulesMatcher,
} from "./match.ts";
import type {
  MatcherMemoizeOptions,
  RouteRulesMatcher,
  RouteRulesMatcherOptions,
} from "./match.ts";
import { normalizeRouteRules } from "./normalize.ts";
import type { MatchResult, RouteRuleConfig } from "./types.ts";

// The built-in rules are declared on h3's own `RouteRules` interface (the type
// behind `event.context.routeRules`) in `src/types/route-rules.ts`, since rules
// now ship inside h3 — see the note there for why each key is named explicitly.

/** Options for the plug-and-play {@link routeRules} middleware. */
export interface RouteRulesOptions extends RouteRulesMatcherOptions {
  /**
   * Memoize match results per `method + pathname` (composes
   * {@link memoizeRouteRulesMatcher}) — **enabled by default**, FIFO-capped at
   * 1024 entries. Memoized results are shared across requests: treat
   * `event.context.routeRules` and its rule options as read-only. Pass `false`
   * to resolve every request from scratch (each request gets fresh result
   * objects), or an options object to tune the entry cap.
   * @default true
   */
  memoize?: boolean | MatcherMemoizeOptions;
}

/**
 * Plug-and-play H3 middleware: matches route rules for each request, exposes the
 * merged rule map as `event.context.routeRules`, and runs matched rule
 * middleware (redirect, proxy, headers, basic auth, cache, …) before the route
 * handler.
 *
 * Match results are memoized by default (see {@link RouteRulesOptions.memoize});
 * treat `event.context.routeRules` as read-only, or pass `memoize: false`.
 *
 * @example
 * ```ts
 * import { H3, serve } from "h3";
 * import { routeRules } from "h3/rules";
 * import { cache } from "h3/rules/cache"; // needed for cache/swr rules (ocache peer)
 *
 * const app = new H3();
 * app.use(
 *   routeRules(
 *     {
 *       "/blog/**": { swr: 60 },
 *       "/old/**": { redirect: { to: "/new/**", status: 301 } },
 *       "/api/**": { cors: true },
 *     },
 *     { handlers: { cache } },
 *   ),
 * );
 * ```
 */
export function routeRules(
  config: Record<string, RouteRuleConfig>,
  opts?: RouteRulesOptions,
): Middleware {
  // Composed here (not in createRouteRulesMatcher, which stays memoize-free so
  // matcher-only bundles can tree-shake the wrapper away) since this module
  // already imports the full core.
  const memoize = opts?.memoize ?? true;
  const matcher = createRouteRulesMatcher(normalizeRouteRules(config), opts);
  const match = memoize
    ? memoizeRouteRulesMatcher(matcher, memoize === true ? undefined : memoize)
    : matcher;
  return function routeRulesMiddleware(event, next) {
    const pathname = event.url.pathname;
    let matched = match(event.req.method, pathname);
    // Method check first: it keeps every non-`OPTIONS` request off the header reads.
    if (event.req.method === "OPTIONS" && isPreflightRequest(event)) {
      matched = liftPreflightCors(matched, match, event, pathname);
    }
    const { routeRules, routeRuleMiddleware } = matched;
    // Merge over a previous `routeRules()` instance instead of replacing it: two
    // middleware instances (e.g. framework-level + app-level) each own a rule
    // set, and a plain assignment — including the `{}` of a miss — would erase
    // the earlier one. Later instances win per rule name. The merged map is a
    // fresh (null-prototype, like the matcher's own) object: memoized results
    // are shared across requests and must never be mutated. With a single
    // instance the matcher's object is exposed as-is, so its identity (and the
    // memoization it comes from) is preserved.
    const prev = event.context.routeRules;
    event.context.routeRules = prev
      ? Object.assign(Object.create(null) as NonNullable<typeof prev>, prev, routeRules)
      : routeRules;
    return routeRuleMiddleware.length > 0
      ? callMiddleware(event, routeRuleMiddleware, () => next())
      : next();
  };
}

// A single method token — anything else is not a preflight this can resolve
// (and would only pollute the matcher's memo with junk keys).
const METHOD_TOKEN_RE = /^[A-Za-z]+$/;

/**
 * A CORS preflight arrives as `OPTIONS`, so a `cors` rule scoped to the method
 * the browser is asking about (`PUT /api/**`) is invisible to the primary
 * lookup and the preflight goes unanswered. Resolve the requested method
 * (`Access-Control-Request-Method`) and lift **only** its `cors` rule.
 *
 * Nothing else may be lifted: browsers send preflights without credentials, so
 * applying a method-scoped `basicAuth` (or any other gate) from that lookup
 * would reject every preflight and break CORS entirely. Since the matcher
 * prepends method-agnostic entries to each method-scoped registration, the
 * requested-method lookup already subsumes the agnostic `cors` layers; a lookup
 * without a `cors` rule (including one reset by `cors: false`) leaves the
 * primary result untouched, so an `OPTIONS`-scoped rule still applies.
 *
 * Kept here rather than behind a widened `RouteRulesMatcher` signature: the
 * matcher resolves `(method, pathname)` and has no access to request headers,
 * while the preflight protocol (which header, which rule may be lifted) is
 * request-level knowledge the middleware already owns.
 */
function liftPreflightCors(
  matched: MatchResult,
  match: RouteRulesMatcher,
  event: H3Event,
  pathname: string,
): MatchResult {
  const requested = event.req.headers.get("access-control-request-method");
  if (!requested || !METHOD_TOKEN_RE.test(requested)) {
    return matched;
  }
  const method = requested.toUpperCase();
  if (method === "OPTIONS") {
    return matched; // same layer the primary lookup already resolved
  }
  const cors = match(method, pathname).routeRules.cors;
  if (!cors || cors === matched.routeRules.cors) {
    return matched;
  }
  // Fresh map (memoized results are shared and read-only) with only `cors`
  // replaced; the chain is rebuilt through the shared builder so handler
  // ordering stays defined in exactly one place.
  const routeRules = Object.assign(
    Object.create(null) as MatchResult["routeRules"],
    matched.routeRules,
    { cors },
  );
  return { routeRules, routeRuleMiddleware: buildRouteRuleMiddleware(routeRules) };
}
