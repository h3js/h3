import type { Middleware } from "../types/handler.ts";
import type { ResolvedRouteRules } from "../types/route-rules.ts";
import type { CorsOptions } from "../utils/cors.ts";
import type { ProxyOptions } from "../utils/proxy.ts";

/**
 * Re-exported from h3's core types so that `h3/rules` and `h3` name the **same**
 * interface. `RouteRules` is the merged rule set (options keyed by rule name);
 * a custom rule declared on it — alongside its {@link RouteRuleConfig} entry, in
 * the same shape — is typed on the matched result and on
 * `event.context.routeRules` alike.
 *
 * For a consumer of the published package, augmenting `"h3"` or `"h3/rules"`
 * both merge into that one declaration — every public entry re-exports it and
 * the module declaring it is not reachable. In *this* tree it is, and TypeScript
 * resolves an augmentation through an alias unreliably once another one targets
 * the declaring module, so in-tree augmentations name `src/types/route-rules.ts`
 * directly (see `test/rules/_augment.ts`).
 */
export type { BuiltinRouteRules, ResolvedRouteRules, RouteRules } from "../types/route-rules.ts";

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
  /**
   * Cache name, part of the cache key. Defaults to
   * `<handlerScope>:<method>:<rulePattern>:<matchedRoute>`.
   *
   * ⚠️ Setting it replaces all four parts, including the per-handler scope that
   * keeps two apps (or two matchers) from reading each other's entries and the
   * method that keeps a body-less `HEAD` response out of the `GET` entry. Set it
   * only for a key you have scoped yourself; prefer the cache handler's `id`
   * option when all you need is a key that is stable across processes.
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
  /** Only handle conditional headers (304 responses) without caching full responses. */
  headersOnly?: boolean;
  /**
   * Request header names that vary the cache key (e.g. `["accept-language"]`).
   *
   * Each named header also reaches the cached handler — it has to, or the
   * handler could not produce the per-value response the key promises — and is
   * merged into the response's `Vary`. `Authorization` is the exception: naming
   * it here keys entries per credential but does not forward it; see
   * {@link allowAuthorization}.
   */
  varies?: string[] | readonly string[];
  /** Allowlist of query parameter names that vary the cache key. */
  allowQuery?: string[] | readonly string[];
  /**
   * Allowlist of cookie names that participate in caching (default: none) —
   * a **request**-side allowlist: only these crumbs key the entry and reach the
   * cached handler, every other cookie is filtered out of both.
   *
   * It grants nothing on the response side: a handler's `Set-Cookie` is
   * delivered to the request that produced it and never stored in the entry,
   * allowlisted name or not. Replaying one would hand the first requester's
   * session to everyone the entry is later served to.
   */
  allowCookies?: string[] | readonly string[];
  /**
   * Let `Authorization` / `Proxy-Authorization` reach the cached handler
   * (default: `false` — they are stripped, like `Cookie`).
   *
   * The auto-generated cache key is built from the path, the {@link varies}
   * headers and the {@link allowCookies} cookies — never from a credential. A
   * handler that rendered per-user content from a bearer token would therefore
   * have that response stored under an anonymous key, served to every later
   * caller, and (with the synthesized `public, s-maxage=N`) propagated to shared
   * CDN caches. Stripping the headers makes such a handler fail safe — it sees
   * an anonymous request and can only produce a shareable response — exactly as
   * a cookie-authenticated one already does.
   *
   * ⚠️ When enabled, the credential **participates in caching**: it is hashed
   * into the cache key and merged into the response's `Vary`, so each distinct
   * credential gets its own entry (concurrent requests with the *same*
   * credential are still coalesced into one handler call and share its
   * response). Enable it for handlers whose output legitimately depends on the
   * token — and keep in mind that per-credential entries multiply cache
   * cardinality; `maxAge` and storage size should be sized for it.
   *
   * Honored by the `h3/rules/cache` handler. A custom `defineCachedHandler`
   * implementation is responsible for its own credential handling.
   */
  allowAuthorization?: boolean;
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

  /**
   * CORS via h3's `handleCors`; `true` applies permissive defaults (`*`), or pass
   * {@link CorsOptions}. A preflight is answered (204) before any other rule.
   * `false` disables CORS inherited from a less-specific pattern.
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
 * One pattern's rules after normalization (output of {@link normalizeRouteRules},
 * input to the matcher) — {@link RouteRules} plus the two things a *layer* can
 * carry that a *merged* rule set cannot: the `false` reset marker (applied as a
 * deletion, so it never survives the merge), and arbitrary rule names.
 *
 * Stays **open** (`[key: string]: unknown`) unlike `RouteRules`: this is a type
 * alias, not the shared augmentable interface, so an index signature here costs
 * no one their augmentation (see {@link BuiltinRouteRules}) while keeping the
 * runtime's "any rule name is data" contract expressible.
 *
 * Normalization only expands sugar, so its output is still valid authored
 * config — `compileRouteRules(normalizeRouteRules(config))` type-checks, and the
 * pass is idempotent. That holds only if `false` is admitted exactly where the
 * closed {@link RouteRuleConfig} admits it (a `headers: false` is a config error
 * either way), hence {@link RuleReset} rather than a blanket `| false`.
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

/**
 * A rule name — a string key of the resolved rule set: h3's built-ins plus
 * whatever any module declared on {@link RouteRules}. A rule name the runtime
 * carries but nobody declared (a data-only rule) is outside this union by
 * design; declaring it is what types it, here and on the context.
 */
export type RouteRuleName = Extract<keyof ResolvedRouteRules, string>;

/**
 * A single rule resolved for a matched request, one per rule name: the merged
 * options **plus the provenance** the options alone cannot carry.
 *
 * This is the merge pipeline's internal currency and the value a
 * {@link RuleHandler} is constructed from — not the published shape.
 * `event.context.routeRules` exposes the merged options directly
 * (`ResolvedRouteRules`), because that is the shape consumers act on; the
 * wrappers stay reachable as {@link MatchResult.matchedRules}.
 *
 * The rule name is the key in {@link MatchedRouteRules}, so it is not repeated
 * here; nor is the pattern's method scope (a merged rule can combine a
 * method-agnostic layer with a method-scoped one, which makes a single `method`
 * field meaningless — the config key's method only decides *whether* a layer
 * contributes).
 */
export interface MatchedRouteRule<K extends RouteRuleName = RouteRuleName> {
  /** The merged rule options (never `false` — a reset deletes the rule instead). */
  options: NonNullable<ResolvedRouteRules[K]>;
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

/**
 * The full set of rules resolved for a matched request **with their
 * provenance**, keyed by rule name — the merge pipeline's own view.
 * `ResolvedRouteRules` is the same set projected onto its merged options.
 */
export type MatchedRouteRules = {
  [K in RouteRuleName]?: MatchedRouteRule<K>;
};

/**
 * A rule handler: `handler` builds an H3 {@link Middleware}; `order` controls
 * execution order (lower runs first, default `0`).
 *
 * Built-ins occupy the negative band, outermost first:
 * - `cors`: `-3` (preflight before anything else)
 * - `headers`: `-1`
 * - everything else: `0`
 *
 * `-2` is deliberately left free for a custom gate (auth and the like), so it
 * runs after a preflight is answered but before headers/cache/redirect/proxy.
 */
export interface RuleHandler<K extends RouteRuleName = RouteRuleName> {
  order?: number;
  /**
   * Whether this rule *restricts* what a request may do (an auth gate) rather
   * than *permitting* something (CORS, a redirect, caching).
   *
   * Only consulted when a rule was reset with `false` by one reading of the
   * path and a broader pattern re-adds it through an [alternate reading]. Since
   * a reset is applied as a deletion, the re-add is otherwise indistinguishable
   * from a rule that simply never matched — and resurrecting a *permission* at a
   * broader pattern's breadth undoes the exemption the narrower pattern granted
   * (`cors: false` on a private subtree, re-added as `origin: "*"` from `/**`,
   * on a response h3 still serves from the private handler).
   *
   * Re-adding a restriction is fail-closed, so it stays allowed: that is what
   * keeps a single-segment `<gate>: false` exemption from covering a path that
   * only decodes to multiple segments. Re-adding anything else is refused.
   * No built-in rule is `restricting`; it defaults to `false` — mark a custom
   * rule (an auth gate, a rate limit) `true` only when applying it more broadly
   * can never weaken a response.
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
  /**
   * The same rules with their provenance: which pattern contributed the merged
   * options, its rou3 params, and the rule's handler. Same keys as
   * {@link routeRules}, one {@link MatchedRouteRule} per entry.
   *
   * Kept out of `event.context.routeRules` — consumers act on the options, and
   * a wrapper there costs every reader a `.options` hop — but published here for
   * the two things that need provenance after resolution: rule handlers (which
   * receive their own wrapper) and anything rebuilding the middleware chain.
   */
  matchedRules: MatchedRouteRules;
  /** Ordered middleware to run before the route handler. */
  routeRuleMiddleware: Middleware[];
}
