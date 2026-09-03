import type { Middleware } from "../types/handler.ts";
import type { ResolvedRouteRules } from "../types/route-rules.ts";
import type { CorsOptions } from "../utils/cors.ts";
import type { ProxyOptions } from "../utils/proxy.ts";

/** Shared route-rule types used by `h3` and `h3/rules`. */
export type { BuiltinRouteRules, ResolvedRouteRules, RouteRules } from "../types/route-rules.ts";

/** Valid HTTP status code (100–599). Kept loose (`number`) for portability. */
export type HTTPStatus = number;

/** Declarative options for a `cache` route rule. */
export interface CacheRuleOptions {
  /**
   * Full cache name. Replaces the default app, method, rule, and route scoping;
   * prefer the cache handler's `id` option for stable cross-process keys.
   */
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
  /**
   * Seconds one shared resolution may take before every waiter is rejected and
   * the entry evicted. Defaults to `30`; `0` or `Infinity` disables the deadline.
   */
  maxResolveTime?: number;
  /**
   * Stream the response that fills the entry instead of buffering it first.
   * Trades a synthesized `etag` and mid-body error recovery for time to first
   * byte; later requests are still served from the stored entry.
   */
  stream?: boolean;
  /**
   * Largest response body, in bytes, that may be buffered for storage. Defaults
   * to what the storage backend can hold; a larger response streams through
   * uncached.
   */
  maxBodySize?: number;
  /** Only handle conditional headers (304 responses) without caching full responses. */
  headersOnly?: boolean;
  /**
   * Headers that vary the cache key and response `Vary`. Authorization headers
   * are forwarded only when {@link allowAuthorization} is enabled.
   */
  varies?: string[] | readonly string[];
  /**
   * Query parameter names that reach the handler and vary the cache key. No
   * query parameter does by default; `true` opts the full query string back in.
   */
  allowQuery?: boolean | string[] | readonly string[];
  /**
   * Cookies allowed to vary the cache key and reach the handler. Other request
   * cookies are filtered, and `Set-Cookie` is never stored.
   */
  allowCookies?: string[] | readonly string[];
  /**
   * Forward authorization headers and vary the cache per credential. Disabled
   * by default; enabling it can greatly increase cache cardinality.
   *
   * Custom cache implementations must enforce this behavior themselves.
   */
  allowAuthorization?: boolean;
  /** Whether to synthesize a `Cache-Control` response header (default `true`). */
  sendCacheControl?: boolean;
  /** Cache-status response header: `true` (`X-Cache`), a custom name, or `false`. */
  cacheStatusHeader?: boolean | string;
}

/**
 * User-authored rules for one route pattern. Custom rule names require module
 * augmentation.
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
   * key ends in `/**`, a `**` in `to` is replaced with the matched tail — appended
   * for a trailing `to: "/new/**"`, or interpolated in place anywhere else in the
   * target's path, query, or fragment (`/new?from=**`).
   * `false` disables a redirect inherited from a less-specific pattern.
   */
  redirect?: string | { to: string; status?: HTTPStatus } | false;

  /**
   * Proxy to another origin or internal path; a plain string is the destination,
   * or use an object for {@link ProxyOptions}. Wildcard `**` tail behavior matches
   * {@link redirect}. `false` disables a proxy inherited from a less-specific pattern.
   */
  proxy?: string | ({ to: string } & ProxyOptions) | false;

  /**
   * CORS via h3's `handleCors`; `true` applies permissive defaults (`*`), or pass
   * {@link CorsOptions}. A preflight is answered (204) before any other rule.
   * `false` disables CORS inherited from a less-specific pattern.
   */
  cors?: CorsOptions | boolean;

  // Shortcuts

  /** Enable stale-while-revalidate, optionally with a `maxAge` in seconds. */
  swr?: boolean | number;
}

/**
 * Rules for one normalized pattern. Includes custom names and `false` markers
 * that reset inherited rules.
 */
export type NormalizedRouteRules = {
  [K in RouteRuleName]?: ResolvedRouteRules[K] | RuleReset<K>;
} & { [key: string]: unknown };

/** The `false` reset marker for rule `K`, when its authored config admits one. */
type RuleReset<K extends RouteRuleName> = K extends keyof RouteRuleConfig
  ? Extract<RouteRuleConfig[K], false>
  : false;

/** Normalized `redirect` rule options. */
export interface RedirectRuleOptions {
  to: string;
  status: HTTPStatus;
  /** Scope base used to validate and strip the tail a `/**` rule key matched. */
  base?: string;
}

/** Normalized `proxy` rule options. */
export type ProxyRuleOptions = {
  to: string;
  /** Scope base used to validate and strip the tail a `/**` rule key matched. */
  base?: string;
} & ProxyOptions;

/** A declared built-in or augmented route-rule name. */
export type RouteRuleName = Extract<keyof ResolvedRouteRules, string>;

/** A matched rule with merged options and route provenance. */
export interface MatchedRouteRule<K extends RouteRuleName = RouteRuleName> {
  /** The merged rule options (never `false` — a reset deletes the rule instead). */
  options: NonNullable<ResolvedRouteRules[K]>;
  /** Most specific pattern that contributed to the rule. */
  route: string;
  /** rou3 params from every matched pattern that contributed to this rule. */
  params?: Record<string, string>;
  /**
   * Rule handler: the middleware constructor plus its optional `order`.
   * Data-only rules have no handler.
   */
  handler?: RuleHandler<K>;
}

/** Matched rules with provenance, keyed by rule name. */
export type MatchedRouteRules = {
  [K in RouteRuleName]?: MatchedRouteRule<K>;
};

/** Builds middleware for a matched rule. */
export interface RuleHandler<K extends RouteRuleName = RouteRuleName> {
  /**
   * Execution order, lower runs first (outermost). Defaults to `0`, which is
   * outside every built-in that can short-circuit (`redirect` 1, `proxy` 2,
   * `cache` 3) and inside `cors` (-3) and `headers` (-1); `-2` is left free for
   * a gate that must also precede `headers`.
   *
   * Two handlers must not share an order when one of them can answer without
   * calling `next()` — the tie is broken by rule name, which is deterministic
   * but arbitrary, and the loser never runs.
   */
  order?: number;
  /**
   * Mark fail-closed rules such as auth gates. Restricting rules may be re-added
   * from alternate path readings after a narrower reset; defaults to `false`.
   */
  restricting?: boolean;
  handler: (matched: MatchedRouteRule<K>) => Middleware;
}

/** Map of rule name → handler constructor. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type RuleHandlers = Record<string, RuleHandler<any> | undefined>;

/** Result of matching a request against the rule set. */
export interface MatchResult {
  /**
   * Merged rule options keyed by rule name — the map exposed as
   * `event.context.routeRules`, so `routeRules.redirect?.to` reads directly.
   */
  routeRules: ResolvedRouteRules;
  /** The same rules with their contributing pattern, params, and handler. */
  matchedRules: MatchedRouteRules;
  /** Ordered middleware to run before the route handler. */
  routeRuleMiddleware: Middleware[];
}
