import { decodeRoutePattern, formatRouteKey, parseRouteKey } from "./internal/key.ts";
import { mergeRuleOptions } from "./merge.ts";
import type {
  CacheRuleOptions,
  NormalizedRouteRules,
  ProxyRuleOptions,
  RedirectRuleOptions,
  RouteRuleConfig,
} from "./types.ts";

/**
 * Normalize authored route rules by expanding shortcuts, canonicalizing keys,
 * and validating built-in options. Custom rules pass through unchanged.
 */
export function normalizeRouteRules(
  config: Record<string, RouteRuleConfig>,
): Record<string, NormalizedRouteRules> {
  const normalizedRules: Record<string, NormalizedRouteRules> = {};
  for (const key in config) {
    const routeConfig = config[key]!;
    const { method, path: rawPath } = parseRouteKey(key);
    // A pattern's literal characters are matched against a decoded reading of
    // the request path, so an escaped one (`/%40admin/**`) has to decode here or
    // it would cover only the encoded spelling (see `decodeRoutePattern`).
    const path = decodeRoutePattern(rawPath);
    const canonicalKey = formatRouteKey(method, path);

    validateBuiltinRules(routeConfig, canonicalKey);

    // Fixed reconstruction order keeps compiler output deterministic.
    const { redirect, proxy, cors, swr, cache, ...rest } = routeConfig;
    const routeRules: Record<string, unknown> = rest;

    if (redirect) {
      const authored: { to?: string; status?: number } =
        typeof redirect === "string" ? { to: redirect } : redirect;
      const redirectOptions: RedirectRuleOptions = { to: "/", status: 307, ...authored };
      if (path.endsWith("/**")) {
        redirectOptions.base = path.slice(0, -3);
      }
      routeRules.redirect = redirectOptions;
    }

    if (proxy) {
      const proxyOptions: ProxyRuleOptions =
        typeof proxy === "string" ? { to: proxy } : { ...proxy };
      if (path.endsWith("/**")) {
        proxyOptions.base = path.slice(0, -3);
      }
      routeRules.proxy = proxyOptions;
    }

    if (cors !== undefined && cors !== false) {
      const corsOptions = cors === true ? {} : { ...cors };
      // Credentialed CORS forbids wildcard origins; falsy origins emit as wildcards too.
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

    // `swr: 0` means revalidate immediately.
    if (swr !== undefined && swr !== false) {
      const cacheOptions: CacheRuleOptions = { ...(cache || undefined) };
      cacheOptions.swr = true;
      if (typeof swr === "number") {
        cacheOptions.maxAge = swr;
      }
      routeRules.cache = cacheOptions;
    } else if (swr === false && cache === undefined) {
      routeRules.cache = false;
    } else if (cache !== undefined && cache !== false) {
      routeRules.cache = cache;
    }

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

    // Reject prototype-polluting names and values with ambiguous merge semantics.
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

    // Canonical keys may collide (`"get /x"` and `"GET /x"`).
    const existing = normalizedRules[canonicalKey];
    if (existing) {
      for (const [name, options] of Object.entries(routeRules)) {
        existing[name] = mergeRuleOptions(existing[name], options);
      }
    } else {
      normalizedRules[canonicalKey] = routeRules as NormalizedRouteRules;
    }
  }
  return normalizedRules;
}

const BUILTIN_RULE_NAMES: readonly (keyof RouteRuleConfig)[] = [
  "cache",
  "headers",
  "redirect",
  "proxy",
  "cors",
  "swr",
];

/**
 * Reject built-in rule shapes that can only misbehave at runtime.
 *
 * **Falsy non-`false` value.** `false` is the one reset marker (it deletes an
 * inherited rule at merge time). Any other falsy value is a config mistake:
 * normalization would silently drop the rule (`redirect: null`), or hand a
 * handler options it cannot act on — for a gate-shaped custom rule, one that
 * fails *open* and serves the guarded route ungated.
 */
function validateBuiltinRules(routeConfig: RouteRuleConfig, canonicalKey: string): void {
  for (const name of BUILTIN_RULE_NAMES) {
    const value = routeConfig[name];
    if (value || value === undefined || value === false) {
      continue;
    }
    if (name === "swr" && value === 0) {
      continue;
    }
    throw new Error(
      `[h3] rules: \`${name}\` rule for \`${canonicalKey}\` is \`${String(value)}\` — use \`false\` to disable a rule inherited from a less-specific pattern, or provide options`,
    );
  }
}
