import type { Middleware } from "../types/handler.ts";
import type { BasicAuthOptions } from "../utils/auth.ts";
import type { CorsOptions } from "../utils/cors.ts";
import type { ProxyOptions } from "../utils/proxy.ts";

/** Valid HTTP status code (100–599). Kept loose (`number`) for portability. */
export type HTTPStatus = number;

/**
 * `cache` rule options — declarative caching schema owned by `h3/rules`, not
 * ocache: core has no ocache dependency (structurally compatible with ocache's
 * `CachedEventHandlerOptions`, pinned by a type-level test), and implementation
 * hooks (`getKey`, `shouldCache`, …) are excluded — supply those via the cache
 * handler factory's `defaults`, or augment this interface (see "Extending Rule Types" in the route rules guide).
 */
export interface CacheRuleOptions {
  /** Cache name, part of the cache key. Defaults to `<rulePattern>:<matchedRoute>`. */
  name?: string;
  /** Cache key group prefix. Defaults to `"h3/route-rules"`. */
  group?: string;
  /** Custom integrity value participating in cache invalidation. */
  integrity?: unknown;
  /** Number of seconds to cache the response. */
  maxAge?: number;
  /** Enable stale-while-revalidate: serve stale cache while refreshing in the background. */
  swr?: boolean;
  /** Maximum number of seconds a stale entry may be served while revalidating. */
  staleMaxAge?: number;
  /** Storage key base prefix(es). */
  base?: string | string[];
  /** Only handle conditional headers (304 responses) without caching full responses. */
  headersOnly?: boolean;
  /** Request header names that vary the cache key (e.g. `["accept-language"]`). */
  varies?: string[] | readonly string[];
  /** Allowlist of query parameter names that vary the cache key. */
  allowQuery?: string[] | readonly string[];
  /** Allowlist of cookie names that participate in caching (default: none). */
  allowCookies?: string[] | readonly string[];
  /** Whether to synthesize a `Cache-Control` response header (default `true`). */
  sendCacheControl?: boolean;
  /** Cache-status response header: `true` (`X-Cache`), a custom name, or `false`. */
  cacheStatusHeader?: boolean | string;
}

/**
 * Route rule options as authored by the user (input to {@link normalizeRouteRules}).
 *
 * Closed interface — unknown keys are compile errors (catches typos like `redirct`).
 * Custom/data-only keys need module augmentation (see "Extending Rule Types" in the route rules guide);
 * they still flow through normalization untouched at runtime.
 *
 * @example
 * ```ts
 * routeRules({
 *   "/blog/**": { swr: 60 },
 *   "/old/**": { redirect: { to: "/new/**", status: 301 } },
 *   "/api/**": { cors: true },
 * })
 * ```
 */
export interface RouteRuleConfig {
  /**
   * Enable runtime caching; `false` disables caching inherited from a less-specific
   * pattern. Requires a registered `cache` handler (`h3/rules/cache`'s ocache-backed
   * one, or your own via `createCacheRuleHandler`).
   */
  cache?: CacheRuleOptions | false;

  headers?: Record<string, string>;

  /**
   * Server-side redirect; a plain string defaults to status `307`. When the rule
   * key and `to` both end in `/**`, the matched tail is appended to the destination.
   * `false` disables a redirect inherited from a less-specific pattern.
   */
  redirect?: string | { to: string; status?: HTTPStatus } | false;

  /**
   * Proxy to another origin or internal path; a plain string is the destination,
   * or use an object for {@link ProxyOptions}. Wildcard `/**` tail behavior matches
   * {@link redirect}. `false` disables a proxy inherited from a less-specific pattern.
   */
  proxy?: string | ({ to: string } & ProxyOptions) | false;

  /** HTTP Basic Auth; `false` disables auth inherited from a less-specific pattern. */
  basicAuth?: BasicAuthRuleOptions | false;

  /**
   * CORS via h3's `handleCors`; `true` applies permissive defaults (`*`), or pass
   * {@link CorsOptions}. A preflight is answered (204) before any other rule,
   * including `basicAuth`. `false` disables CORS inherited from a less-specific pattern.
   */
  cors?: CorsOptions | boolean;

  // Shortcuts

  /**
   * Shortcut for `cache: { swr: true, maxAge?: number }`.
   * - `true` — enable SWR with no explicit `maxAge`.
   * - `number` — enable SWR with the given `maxAge` in seconds (`0` is valid).
   * - `false` — do not enable SWR.
   */
  swr?: boolean | number;
}

/**
 * Normalized route rules used at runtime after shortcut resolution.
 *
 * Unlike {@link RouteRuleConfig}, stays **open** (`[key: string]: unknown`) — the
 * runtime handles arbitrary rule names; augment alongside `RouteRuleConfig` for
 * custom rules (see "Extending Rule Types" in the route rules guide).
 */
export interface RouteRules {
  headers?: Record<string, string>;
  redirect?: RedirectRuleOptions | false;
  proxy?: ProxyRuleOptions | false;
  cache?: CacheRuleOptions | false;
  basicAuth?: BasicAuthRuleOptions | false;
  cors?: CorsOptions | false;
  [key: string]: unknown;
}

/**
 * `basicAuth` rule options — h3's {@link BasicAuthOptions} restricted to what a
 * declarative (and compilable) rule can express.
 *
 * `validate` is deliberately **not** a rule option: a function has no place in
 * serialized/compiled rule config. h3's own `BasicAuthOptions` is
 * `Partial<...> & ({ validate } | { password })`, i.e. a credential is
 * mandatory; dropping `validate` therefore makes `password` **required**.
 * A plain `Pick<>` of `BasicAuthOptions` silently erased that union, so a rule
 * with only a `username` type-checked and then failed with a 500 at runtime.
 */
export type BasicAuthRuleOptions = Required<Pick<BasicAuthOptions, "password">> &
  Pick<BasicAuthOptions, "username" | "realm">;

/** Normalized `redirect` rule options. */
export interface RedirectRuleOptions {
  to: string;
  status: HTTPStatus;
  /**
   * Scope base for a `/**` rule key (key minus the `/**` suffix; matcher `baseURL`
   * is prefixed at registration). Runtime validates in-scope before stripping.
   * Replaces Nitro's internal `_redirectStripBase`.
   */
  base?: string;
}

/** Normalized `proxy` rule options. */
export type ProxyRuleOptions = {
  to: string;
  /**
   * Scope base for a `/**` rule key. See {@link RedirectRuleOptions.base}; replaces
   * Nitro's internal `_proxyStripBase`.
   */
  base?: string;
} & ProxyOptions;

/** A rule name (string keys of {@link RouteRules}). */
export type RouteRuleName = Extract<keyof RouteRules, string>;

/**
 * A single rule resolved for a matched request, one per rule name.
 *
 * The rule name is the key in {@link MatchedRouteRules}, so it is not repeated
 * here; nor is the pattern's method scope (a merged rule can combine a
 * method-agnostic layer with a method-scoped one, which makes a single `method`
 * field meaningless — the config key's method only decides *whether* a layer
 * contributes).
 */
export interface MatchedRouteRule<K extends RouteRuleName = RouteRuleName> {
  /** The rule options (never `false` after merge resolution). */
  options: Exclude<RouteRules[K], false>;
  /**
   * The most specific pattern that contributed to this rule (e.g. `/api/**`).
   * Broader patterns may also have contributed options; this is the one whose
   * `params` and specificity the merged rule inherits.
   */
  route: string;
  /** rou3 params from every matched pattern that contributed to this rule. */
  params?: Record<string, string>;
  /**
   * Rule handler: the middleware constructor plus its optional `order`.
   * Data-only rules have no handler.
   */
  handler?: RuleHandler<K>;
}

/** The full set of rules resolved for a matched request, keyed by rule name. */
export type MatchedRouteRules = {
  [K in RouteRuleName]?: MatchedRouteRule<K>;
};

/**
 * A rule handler: `handler` builds an H3 {@link Middleware}; `order` controls
 * execution order (lower runs first, default `0`).
 *
 * Built-ins occupy the negative band, outermost first:
 * - `cors`: `-3` (preflight before the auth gate)
 * - `basicAuth`: `-2` (gates before headers/cache/redirect/proxy)
 * - `headers`: `-1`
 * - everything else: `0`
 */
export interface RuleHandler<K extends RouteRuleName = RouteRuleName> {
  order?: number;
  handler: (matched: MatchedRouteRule<K>) => Middleware;
}

/** Map of rule name → handler constructor. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type RuleHandlers = Record<string, RuleHandler<any> | undefined>;

/** Result of matching a request against the rule set. */
export interface MatchResult {
  /** Merged rule map, exposed as `event.context.routeRules`. */
  routeRules: MatchedRouteRules;
  /** Ordered middleware to run before the route handler. */
  routeRuleMiddleware: Middleware[];
}
