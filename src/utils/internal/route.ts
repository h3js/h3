import { createRouter, addRoute, findRoute } from "rou3";

/**
 * Verdict of a route-pattern match: `false` when the pattern does not match the
 * path, otherwise the params it bound — or `undefined` when it binds none, so a
 * param-less pattern costs no allocation on the hot path.
 */
export type RouteMatchResult = false | undefined | Record<string, string>;

export type RouteMatcher = (pathname: string) => RouteMatchResult;

// A route pattern whose every segment is a plain literal. rou3's group (`{}`),
// escape (`\`), regex (`()`), param (`:`) and wildcard (`*`) syntax each key off
// one of these characters, and an empty segment (`//`) makes rou3's trailing
// slash handling non-obvious — so a pattern matching this is a plain string
// comparison away from a verdict, and anything else goes to rou3 itself.
const LITERAL_ROUTE_RE = /^(?:\/[^/:*(){}\\]+)*\/?$/;

// The same, followed by a trailing catch-all: `/api/**`.
const LITERAL_PREFIX_ROUTE_RE = /^((?:\/[^/:*(){}\\]+)*)\/\*\*\/?$/;

/**
 * Compile a rou3 route pattern into a matcher over `event.url.pathname`.
 *
 * The two shapes route-scoped middleware almost always uses — `/api` and
 * `/api/**` — are matched by string comparison. Every other pattern is matched
 * by rou3 itself, one single-route router per pattern, so a middleware scope
 * can never disagree with the routes it is meant to guard: the general case
 * *is* the router, and the fast paths are exact reimplementations of it for
 * patterns with no dynamic segments.
 *
 * Trailing slashes follow rou3: `findRoute` drops one from the path and
 * `splitPath` then drops one empty trailing segment, so a literal `/api` is
 * also reached by `/api/` and `/api//` (but not `/api///`).
 */
export function createRouteMatcher(route: string): RouteMatcher {
  if (route.charCodeAt(0) !== 47 /* / */) {
    route = `/${route}`; // rou3's `addRoute` does the same
  }

  const prefixMatch = LITERAL_PREFIX_ROUTE_RE.exec(route);
  if (prefixMatch) {
    // `/api/**`: everything at or below the prefix, on a segment boundary.
    const base = prefixMatch[1];
    const prefix = `${base}/`;
    return (pathname) =>
      pathname.startsWith(prefix)
        ? { _: trimTrailingSlashes(pathname.slice(prefix.length)) }
        : pathname === base
          ? { _: "" }
          : false;
  }

  if (LITERAL_ROUTE_RE.test(route)) {
    // `/api`: no params to bind, so a match reports `undefined`.
    const base = route.endsWith("/") ? route.slice(0, -1) : route;
    return (pathname) =>
      pathname === base || pathname === `${base}/` || pathname === `${base}//` ? undefined : false;
  }

  const router = createRouter<true>();
  addRoute(router, "", route, true);
  return (pathname) => {
    // `params` is `undefined` for a pattern that binds none (an escape or a
    // group that expanded to literals), which is a match, not a miss.
    const match = findRoute(router, "", pathname);
    return match ? match.params : false;
  };
}

/**
 * Drop the trailing slashes rou3 drops before it binds a `**` param: one in
 * `findRoute`, then one empty trailing segment in `splitPath`.
 */
function trimTrailingSlashes(rest: string): string {
  if (rest.endsWith("/")) {
    rest = rest.slice(0, -1);
    if (rest.endsWith("/")) {
      rest = rest.slice(0, -1);
    }
  }
  return rest;
}
