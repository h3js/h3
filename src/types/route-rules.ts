import type { CacheRuleOptions, ProxyRuleOptions, RedirectRuleOptions } from "../rules/types.ts";
import type { CorsOptions } from "../utils/cors.ts";

/**
 * The rule keys `h3/rules` ships a built-in handler for, typed as the **merged
 * rule options** the runtime resolves for them — the same shape the rule was
 * authored in (`RouteRuleConfig`), minus the input sugar normalization already
 * expanded (`redirect: "/new"` → `{ to, status }`) and minus the `false` reset
 * marker, which is applied as a deletion and can therefore never survive into a
 * merged rule set.
 *
 * Declared on their own interface rather than on {@link RouteRules}, the shared
 * augmentable one. Declaration merging compares a redeclared property by *type
 * identity* (`TS2717`), so naming these keys on `RouteRules` itself would make
 * every third-party declaration of the same key an error — including the ones
 * Nitro and the standalone `h3-rules` package have always shipped:
 *
 * ```ts
 * declare module "h3" {
 *   interface RouteRules {
 *     redirect?: { to: string; status?: number };
 *   }
 * }
 * ```
 *
 * *Inheriting* them (`interface RouteRules extends BuiltinRouteRules`) does not
 * work either. It only downgrades the check to assignability (`TS2430` — a
 * derived interface may narrow an inherited property), and the shapes actually
 * shipped are not narrowings of anything useful: `nitropack`'s
 * `redirect?: string | { to; status? }` carries a **primitive** arm (h3's own
 * `@example` shipped that shape too), and its `cache?: … | false` /
 * `cors?: boolean` carry a **`false`** arm — `false` being h3's own reset
 * marker. Widening the built-in's declared type until those assign makes it an
 * escape hatch that erases member access for everyone who does *not* augment.
 *
 * The built-ins are therefore *composed in at the point of use* — see
 * {@link ResolvedRouteRules} — where nothing is inherited and no assignability
 * check applies at all.
 *
 * Adding a `[key: string]: unknown` index signature here (so that a data-only
 * rule reads off the context without being declared) is equally out: on a shared
 * ecosystem interface an index signature makes every other module's augmentation
 * an error (`TS2411`), whatever key or type it adds. A custom rule is declared
 * once, on {@link RouteRules}.
 */
export interface BuiltinRouteRules {
  headers?: Record<string, string>;
  redirect?: RedirectRuleOptions;
  proxy?: ProxyRuleOptions;
  cache?: CacheRuleOptions;
  cors?: CorsOptions;
}

/**
 * The rules matched for the current route, **keyed by rule name and holding the
 * merged rule options directly** (`rules.redirect.to`, `rules.headers["x-a"]`) —
 * the canonical extension point for route rules in the h3 ecosystem.
 *
 * Intentionally **empty and unconstrained**: modules that implement or consume
 * route rules (such as Nitro) augment it via declaration merging, so that a
 * single type describes the rules of any h3 app regardless of which module
 * declared them. Every shape is accepted, including on a key h3 ships a built-in
 * for — see {@link BuiltinRouteRules} for why nothing is declared here.
 *
 * Handlers read the *resolved* set, {@link ResolvedRouteRules}, off
 * `event.context.routeRules`, where it is typed `Readonly` — matchers are
 * commonly memoized, so a matched object can be shared between requests and must
 * not be mutated in place.
 *
 * This is the **one** `RouteRules` interface: `h3/rules` re-exports it, so a
 * custom rule is declared once, in one shape, and is then typed on both the
 * matched result and the context. (Its authored counterpart, `RouteRuleConfig`,
 * stays a separate closed interface — that is what makes a typo a compile
 * error.) Per-rule provenance — which pattern contributed the options, its
 * params, the handler — is deliberately *not* here; it is passed to rule
 * handlers as a `MatchedRouteRule` and available as `MatchResult.matchedRules`.
 *
 * @example
 * ```ts
 * declare module "h3/rules" {
 *   interface RouteRuleConfig {
 *     audience?: "public" | "internal";
 *   }
 *   interface RouteRules {
 *     audience?: "public" | "internal";
 *   }
 * }
 *
 * // event.context.routeRules.audience -> "public" | "internal" | undefined
 * ```
 */
export interface RouteRules {}

/**
 * The rules as seen on `event.context.routeRules`: everything declared on
 * {@link RouteRules}, plus a built-in for every key nobody claimed.
 *
 * `Omit` — not `&` — so that an augmenter's redeclaration *replaces* h3's
 * built-in rather than intersecting with it; intersecting `RedirectRuleOptions`
 * with `string | { to: string }` would yield a type no value inhabits. Keys left
 * to h3 keep their exact option type, so `rules.redirect?.to` reads without
 * narrowing.
 */
export type ResolvedRouteRules = RouteRules & Omit<BuiltinRouteRules, keyof RouteRules>;
