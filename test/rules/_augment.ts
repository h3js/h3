// The runtime tests (and the bench fixture) exercise data-only / custom rules
// with ad-hoc keys. Now that `RouteRuleConfig` is a **closed** interface, those
// keys must be declared via module augmentation — the same mechanism real
// consumers (e.g. Nitro's `isr`/`prerender`/`static`) use. This file mirrors
// that adaptation for the test + bench fixtures so their configs keep
// type-checking; it declares no runtime values and is never imported/run.
//
// Runtime behavior is unchanged: unknown keys still flow through
// normalize/match/merge as data-only rules — augmentation only re-opens typing.
//
// The two interfaces carry the **same shape**: `RouteRuleConfig` (`h3/rules`)
// types what is authored, `RouteRules` (h3 core, the single shared one) what the
// merge resolves — and the merged value *is* the config value. Declaring
// `RouteRules` is therefore all it takes to type a custom rule on
// `event.context.routeRules`; there is no second, wrapper-shaped declaration.
//
// Each interface is augmented in the module that **declares** it. Augmenting
// through a re-export does merge, but only reliably so when nothing else in the
// program augments the declaring module — which is exactly what the sibling
// type tests do.
export {};

declare module "../../src/rules/types.ts" {
  interface RouteRuleConfig {
    /** Nitro-style build-time rules (data-only here). */
    isr?: number | boolean;
    prerender?: boolean;
    /** Generic custom / data-only keys used across the fixtures. */
    custom?: unknown;
    tags?: unknown;
    shout?: unknown;
    "my-rule"?: unknown;
  }
}

declare module "../../src/types/route-rules.ts" {
  interface RouteRules {
    isr?: number | boolean;
    prerender?: boolean;
    custom?: unknown;
    tags?: unknown;
    shout?: unknown;
    "my-rule"?: unknown;
  }
}
