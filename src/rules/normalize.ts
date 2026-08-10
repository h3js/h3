import { decodeRoutePattern, formatRouteKey, parseRouteKey } from "./internal/key.ts";
import { mergeRuleOptions } from "./merge.ts";
import type { RouteRuleConfig, RouteRules } from "./types.ts";

/**
 * Normalize user route-rule config into runtime rules.
 *
 * Expands the `swr` shortcut, normalizes `cors` (`true` → permissive options)
 * and `redirect`/`proxy` string forms, and attaches a first-class `base` field
 * to `/**` redirect/proxy rules — the rule key's *pattern* prefix, which the
 * runtime resolves per request when it carries dynamic segments (see
 * `prepareRuleTarget`). Keys may carry a `"METHOD /path"` prefix (see
 * {@link parseRouteKey}); the result is re-keyed in canonical form. Unknown/
 * custom keys pass through untouched (data-only rules).
 *
 * Config-time validation (fail fast at startup/build rather than per request):
 * a falsy non-`false` value for a built-in rule, a `basicAuth` rule with no
 * `password`, a credentialed wildcard `cors` origin, a reserved rule name, and
 * top-level array options are all rejected here.
 */
export function normalizeRouteRules(
  config: Record<string, RouteRuleConfig>,
): Record<string, RouteRules> {
  const normalizedRules: Record<string, RouteRules> = {};
  for (const key in config) {
    const routeConfig = config[key]!;
    const { method, path: rawPath } = parseRouteKey(key);
    // A pattern's literal characters are matched against a decoded reading of
    // the request path, so an escaped one (`/%40admin/**`) has to decode here or
    // it would cover only the encoded spelling (see `decodeRoutePattern`).
    const path = decodeRoutePattern(rawPath);
    const canonicalKey = formatRouteKey(method, path);

    validateBuiltinRules(routeConfig, canonicalKey);

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
      // The falsy test mirrors h3's own emission condition (`!originOption`,
      // `utils/cors.ts`) exactly: a defined-but-falsy origin (`null`, `""`) is
      // a wildcard there too, so anything narrower here would let the
      // credentialed-wildcard pair ship anyway.
      if (
        corsOptions.credentials === true &&
        (!corsOptions.origin ||
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

// ------------------------------------------------------------------------
// Internal
// ------------------------------------------------------------------------

// Every rule name this module gives meaning to. Custom/data-only keys are
// deliberately excluded from the checks below: their values are opaque data,
// where `null`/`""`/`0` are legitimate.
const BUILTIN_RULE_NAMES: readonly (keyof RouteRuleConfig)[] = [
  "cache",
  "headers",
  "redirect",
  "proxy",
  "basicAuth",
  "cors",
  "swr",
];

/**
 * Reject built-in rule shapes that can only misbehave at runtime.
 *
 * - **Falsy non-`false` value.** `false` is the one reset marker (it deletes an
 *   inherited rule at merge time). Any other falsy value is a config mistake:
 *   normalization would silently drop the rule (`redirect: null`), or hand a
 *   handler options it cannot act on — `basicAuth: null` used to fail *open*
 *   and serve the guarded route unauthenticated.
 * - **`basicAuth` with no `password`.** `validate` is deliberately not a rule
 *   option (see `BasicAuthRuleOptions`), so `password` is the only credential a
 *   rule can carry; without it `requireBasicAuth` throws a 500 on every request.
 */
function validateBuiltinRules(routeConfig: RouteRuleConfig, canonicalKey: string): void {
  for (const name of BUILTIN_RULE_NAMES) {
    const value = routeConfig[name];
    if (value || value === undefined || value === false) {
      continue;
    }
    // `swr: 0` is a real value (serve stale, revalidate immediately).
    if (name === "swr" && value === 0) {
      continue;
    }
    throw new Error(
      `[h3] rules: \`${name}\` rule for \`${canonicalKey}\` is \`${String(value)}\` — use \`false\` to disable a rule inherited from a less-specific pattern, or provide options`,
    );
  }

  const { basicAuth } = routeConfig;
  if (basicAuth && !basicAuth.password) {
    throw new Error(
      `[h3] rules: \`basicAuth\` rule for \`${canonicalKey}\` has no \`password\` — provide \`{ password, username?, realm? }\`, or \`false\` to disable auth inherited from a less-specific pattern`,
    );
  }
}
