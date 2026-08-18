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
import { HTTP_METHODS } from "./internal/key.ts";
import { normalizeRouteRules } from "./normalize.ts";
import type { MatchResult, RouteRuleConfig } from "./types.ts";

/** Options for the plug-and-play {@link routeRules} middleware. */
export interface RouteRulesOptions extends RouteRulesMatcherOptions {
  /**
   * Memoize matches by method and pathname. Enabled by default with a 1024-entry
   * FIFO cap; shared results must be treated as read-only.
   * @default true
   */
  memoize?: boolean | MatcherMemoizeOptions;
}

/**
 * Match route rules, expose merged options on `event.context.routeRules`, and
 * run their middleware before the route handler.
 *
 * Results are memoized and shared by default; treat exposed rule options as
 * read-only or disable memoization.
 */
export function routeRules(
  config: Record<string, RouteRuleConfig>,
  opts?: RouteRulesOptions,
): Middleware {
  const memoize = opts?.memoize ?? true;
  const matcher = createRouteRulesMatcher(normalizeRouteRules(config), opts);
  const match = memoize
    ? memoizeRouteRulesMatcher(matcher, memoize === true ? undefined : memoize)
    : matcher;
  return function routeRulesMiddleware(event, next) {
    const pathname = event.url.pathname;
    // Method-scoped rule keys are normalized to uppercase.
    const method = event.req.method.toUpperCase();
    let matched = match(method, pathname);
    if (method === "OPTIONS" && isPreflightRequest(event)) {
      matched = liftPreflightCors(matched, match, event, pathname);
    }
    const { routeRules, routeRuleMiddleware } = matched;
    // Compose multiple instances without mutating memoized match results.
    const prev = event.context.routeRules;
    event.context.routeRules = prev
      ? Object.assign(Object.create(null) as NonNullable<typeof prev>, prev, routeRules)
      : routeRules;
    return routeRuleMiddleware.length > 0
      ? callMiddleware(event, routeRuleMiddleware, () => next())
      : next();
  };
}

/**
 * Lift only the requested method's CORS rule for preflight; lifting auth or
 * other method-scoped rules would incorrectly reject credentialless preflights.
 */
function liftPreflightCors(
  matched: MatchResult,
  match: RouteRulesMatcher,
  event: H3Event,
  pathname: string,
): MatchResult {
  const requested = event.req.headers.get("access-control-request-method");
  if (!requested) {
    return matched;
  }
  // Only a method a rule key can name is worth a second lookup — the header is
  // attacker-controlled, and a free-form token would key a fresh entry in the
  // shared match memo on every preflight.
  const method = requested.toUpperCase();
  if (method === "OPTIONS" || !HTTP_METHODS.has(method)) {
    return matched;
  }
  const cors = match(method, pathname).matchedRules.cors;
  if (!cors || cors === matched.matchedRules.cors) {
    return matched;
  }
  const matchedRules = Object.assign(
    Object.create(null) as MatchResult["matchedRules"],
    matched.matchedRules,
    { cors },
  );
  const routeRules = Object.assign(
    Object.create(null) as MatchResult["routeRules"],
    matched.routeRules,
    { cors: cors.options },
  );
  return { routeRules, matchedRules, routeRuleMiddleware: buildRouteRuleMiddleware(matchedRules) };
}
