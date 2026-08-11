import type { MatchedRouteRule } from "../rules/types.ts";

/**
 * The rule keys `h3/rules` ships a built-in handler for.
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
 * Spreading `h3/rules`' `MatchedRouteRules` here instead of listing the keys
 * would contribute a `string` **index signature** (its key union is
 * `RouteRuleName`, i.e. `string`, since `h3/rules`' own `RouteRules` config type
 * stays open). On a shared ecosystem interface that index signature is hostile:
 * it makes every other module's augmentation an error (`TS2411`), whatever key
 * or type it adds.
 */
export interface BuiltinRouteRules {
  headers?: MatchedRouteRule<"headers">;
  redirect?: MatchedRouteRule<"redirect">;
  proxy?: MatchedRouteRule<"proxy">;
  cache?: MatchedRouteRule<"cache">;
  basicAuth?: MatchedRouteRule<"basicAuth">;
  cors?: MatchedRouteRule<"cors">;
}

/**
 * Rules matched for the current route — the canonical extension point for route
 * rules in the h3 ecosystem.
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
 * Declare the shape *whoever populates the context actually writes*. Under
 * `h3/rules`' own `routeRules()` middleware that is the matched wrapper, so a
 * custom key mirrors its built-in neighbours. A framework that populates
 * `event.context.routeRules` itself declares whatever it writes instead —
 * raw values included, which is why nothing here constrains the shape.
 *
 * Note this is a *different* interface from `h3/rules`' `RouteRules`, which
 * types the normalized rule **options**. A custom rule needs both: the option
 * shape there, the matched shape here.
 *
 * @example
 * ```ts
 * import type { MatchedRouteRule } from "h3/rules";
 *
 * declare module "h3" {
 *   interface RouteRules {
 *     audience?: MatchedRouteRule<"audience">;
 *   }
 * }
 *
 * // event.context.routeRules.audience?.options -> the merged value
 * ```
 */
export interface RouteRules {}

/**
 * The rules as seen on `event.context.routeRules`: everything declared on
 * {@link RouteRules}, plus a built-in for every key nobody claimed.
 *
 * `Omit` — not `&` — so that an augmenter's redeclaration *replaces* h3's
 * built-in rather than intersecting with it; intersecting
 * `MatchedRouteRule<"redirect">` with `string | { to: string }` would yield a
 * type no value inhabits. Keys left to h3 keep their exact
 * `MatchedRouteRule<K>`, so `rules.redirect?.options` and `.route` read without
 * narrowing.
 */
export type ResolvedRouteRules = RouteRules & Omit<BuiltinRouteRules, keyof RouteRules>;
