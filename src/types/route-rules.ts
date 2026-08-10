import type { MatchedRouteRule, RouteRuleName } from "../rules/types.ts";

/**
 * The declared type of a rule key that `h3/rules` ships a built-in for.
 *
 * A union of the `h3/rules` wrapper and an open object arm, so that a
 * third-party augmentation of {@link RouteRules} that declares the same key with
 * its own shape is *assignable* to it. See the block comment on
 * {@link BuiltinRouteRules} for why that matters.
 *
 * Both arms expose the wrapper's members (the open arm as `Partial`), so reading
 * `rule.options` / `rule.route` still works without narrowing when nothing
 * augmented the key — only `route` and `options` widen with `undefined`. The
 * `& object` is load-bearing: it keeps the arm from being a *weak type*, which
 * would otherwise reject an augmentation sharing none of the wrapper's members.
 */
export type BuiltinRouteRule<K extends RouteRuleName> =
  | MatchedRouteRule<K>
  | (Partial<MatchedRouteRule<K>> & object);

/**
 * The rule keys `h3/rules` ships a built-in handler for.
 *
 * Declared on a **base** interface rather than on {@link RouteRules} itself.
 * Declaration merging compares a redeclared property by *type identity*
 * (`TS2717`), so naming these keys directly on the shared, augmentable
 * `RouteRules` interface would make every third-party declaration of the same
 * key an error — including the ones Nitro and the standalone `h3-rules` package
 * have always shipped:
 *
 * ```ts
 * declare module "h3" {
 *   interface RouteRules {
 *     redirect?: { to: string; status?: number };
 *   }
 * }
 * ```
 *
 * Inheriting them instead turns that into an *assignability* check
 * (`TS2430` — a derived interface may narrow an inherited property), which the
 * escape-hatch arm of {@link BuiltinRouteRule} satisfies for any object-shaped
 * rule value.
 *
 * The trade-off is deliberate: inference on these keys is weaker than a bare
 * `MatchedRouteRule<K>` would give (`route`/`options` are optional, and an
 * arbitrary object type is admitted), because the interface must stay open to
 * shapes h3 does not control. Consumers that want the exact matched-rule types read
 * `MatchedRouteRules` from `h3/rules` instead. Augmenting a key *narrows* it
 * back to the augmenter's own type, which is the case the weaker union exists
 * to serve.
 *
 * The escape hatch covers object-shaped rule values (every shape shipped by the
 * known augmenters). Redeclaring a built-in key as a *primitive* union member
 * (`redirect?: string | { to: string }`) is still rejected — admitting those
 * would erase member access on the un-augmented union entirely.
 *
 * Spreading `h3/rules`' `MatchedRouteRules` here instead would contribute a
 * `string` **index signature** (its key union is `RouteRuleName`, i.e. `string`,
 * since `h3/rules`' own `RouteRules` config type stays open). On a shared
 * ecosystem interface that index signature is hostile: it makes every other
 * module's augmentation an error (`TS2411`), whatever key or type it adds.
 * A consumer adding a custom rule declares it on {@link RouteRules} via the
 * augmentation shown above — that is what this extension point is for.
 */
export interface BuiltinRouteRules {
  headers?: BuiltinRouteRule<"headers">;
  redirect?: BuiltinRouteRule<"redirect">;
  proxy?: BuiltinRouteRule<"proxy">;
  cache?: BuiltinRouteRule<"cache">;
  basicAuth?: BuiltinRouteRule<"basicAuth">;
  cors?: BuiltinRouteRule<"cors">;
}

/**
 * Rules matched for the current route.
 *
 * This interface declares only the rules built into `h3/rules` (inherited from
 * {@link BuiltinRouteRules}) and is otherwise intentionally open. It is the
 * canonical extension point for route rules in the h3 ecosystem: modules that
 * implement or consume route rules (such as Nitro) augment it via declaration
 * merging, so that a single type describes the rules of any h3 app regardless of
 * which module declared them. Redeclaring a built-in key is supported too — see
 * {@link BuiltinRouteRules}.
 *
 * Matched rules are exposed to handlers via `event.context.routeRules`, where they
 * are typed as `Readonly` — matchers are commonly memoized, so a matched object can
 * be shared between requests and must not be mutated in place.
 *
 * @example
 * ```ts
 * declare module "h3" {
 *   interface RouteRules {
 *     swr?: number | boolean;
 *     redirect?: { to: string; status?: number };
 *   }
 * }
 * ```
 */
export interface RouteRules extends BuiltinRouteRules {}
