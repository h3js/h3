import { formatRouteKey, parseRouteKey } from "./internal/key.ts";
import { mergeRuleOptions } from "./merge.ts";
import type { RouteRuleConfig, RouteRules } from "./types.ts";

/**
 * Normalize user route-rule config into runtime rules.
 *
 * Expands the `swr` shortcut, normalizes `cors` (`true` → permissive options)
 * and `redirect`/`proxy` string forms, and attaches a first-class `base` field
 * to `/**` redirect/proxy rules. Keys may carry a `"METHOD /path"` prefix (see
 * {@link parseRouteKey}); the result is re-keyed in canonical form. Unknown/
 * custom keys pass through untouched (data-only rules).
 */
export function normalizeRouteRules(
  config: Record<string, RouteRuleConfig>,
): Record<string, RouteRules> {
  const normalizedRules: Record<string, RouteRules> = {};
  for (const key in config) {
    const routeConfig = config[key]!;
    const { method, path } = parseRouteKey(key);
    const canonicalKey = formatRouteKey(method, path);

    // Re-added below in this same fixed order (redirect, proxy, cors, cache) so
    // normalization is key-order idempotent — the compiler depends on this for
    // byte-identical codegen. Rest-destructure avoids mutating the caller's config.
    const { redirect, proxy, cors, swr, cache, ...rest } = routeConfig;
    const routeRules: RouteRules = rest;

    if (redirect) {
      const redirectOptions: { to?: string; status?: number } =
        typeof redirect === "string" ? { to: redirect } : redirect;
      routeRules.redirect = { to: "/", status: 307, ...redirectOptions };
      if (path.endsWith("/**")) {
        routeRules.redirect.base = path.slice(0, -3);
      }
    }

    if (proxy) {
      routeRules.proxy = typeof proxy === "string" ? { to: proxy } : { ...proxy };
      if (path.endsWith("/**")) {
        routeRules.proxy.base = path.slice(0, -3);
      }
    }

    // `true` → permissive defaults (h3 fills origin/methods/allowHeaders `*`);
    // `false` is handled with the other reset markers below.
    if (cors !== undefined && cors !== false) {
      const corsOptions = cors === true ? {} : { ...cors };
      // `Access-Control-Allow-Origin: *` is invalid for credentialed requests
      // (Fetch spec) — reject at normalize time. A function `origin` can't be
      // checked statically, so it passes (as does h3's literal `"null"`).
      if (
        corsOptions.credentials === true &&
        (corsOptions.origin === undefined ||
          corsOptions.origin === "*" ||
          (Array.isArray(corsOptions.origin) && corsOptions.origin.includes("*")))
      ) {
        throw new Error(
          `[h3] rules: \`cors\` rule for \`${canonicalKey}\` sets \`credentials: true\` with a wildcard origin — \`Access-Control-Allow-Origin: *\` is invalid for credentialed requests; set an explicit \`origin\` allowlist (or validation function)`,
        );
      }
      routeRules.cors = corsOptions;
    }

    // 0 is a valid swr value (serve stale, revalidate immediately) — don't falsy-check.
    if (swr !== undefined && swr !== false) {
      // Copy — `cache` aliases the user's config object here.
      const cacheOptions: Exclude<RouteRules["cache"], false | undefined> = {
        ...(cache || undefined),
      };
      cacheOptions.swr = true;
      if (typeof swr === "number") {
        cacheOptions.maxAge = swr;
      }
      routeRules.cache = cacheOptions;
    } else if (swr === false && cache === undefined) {
      // Bare `swr: false` (no explicit `cache`) resets cache like `cache: false`;
      // an explicit `cache` alongside it wins instead (branch below).
      routeRules.cache = false;
    } else if (cache !== undefined && cache !== false) {
      routeRules.cache = cache;
    }

    // `false` reset markers (delete an inherited rule at runtime merge)
    if (cache === false) {
      routeRules.cache = false;
    }
    if (redirect === false) {
      routeRules.redirect = false;
    }
    if (proxy === false) {
      routeRules.proxy = false;
    }
    if (cors === false) {
      routeRules.cors = false;
    }

    // Reserved keys (`__proto__`/`constructor`/`prototype`) would shadow the
    // prototype at match time — reject at config time (`for..in` also catches
    // an own `__proto__` from JSON-sourced config).
    // Top-level arrays have no defined merge (shallow-spread would splice them
    // into an index-keyed object) — reject rather than silently corrupt.
    for (const name in routeRules) {
      if (name === "__proto__" || name === "constructor" || name === "prototype") {
        throw new Error(
          `[h3] rules: \`${name}\` is a reserved name and cannot be used as a rule for \`${canonicalKey}\``,
        );
      }
      if (Array.isArray(routeRules[name])) {
        throw new Error(
          `[h3] rules: \`${name}\` rule for \`${canonicalKey}\` is an array — rule options cannot be top-level arrays (ambiguous merge semantics); wrap it in an object`,
        );
      }
    }

    // Distinct config keys can collide once canonicalized (`"get /x"` vs
    // `"GET /x"`) — merge per rule name instead of dropping the earlier rule.
    const existing = normalizedRules[canonicalKey];
    if (existing) {
      for (const [name, options] of Object.entries(routeRules)) {
        existing[name] = mergeRuleOptions(existing[name], options);
      }
    } else {
      normalizedRules[canonicalKey] = routeRules;
    }
  }
  return normalizedRules;
}
