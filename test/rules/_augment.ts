// The runtime tests (and the bench fixture) exercise data-only / custom rules
// with ad-hoc keys. Now that `RouteRuleConfig` is a **closed** interface, those
// keys must be declared via module augmentation — the same mechanism real
// consumers (e.g. Nitro's `isr`/`prerender`/`static`) use. This file mirrors
// that adaptation for the test + bench fixtures so their configs keep
// type-checking; it declares no runtime values and is never imported/run.
//
// Runtime behavior is unchanged: unknown keys still flow through
// normalize/match/merge as data-only rules — augmentation only re-opens typing.
import type { MatchedRouteRule } from "../../src/rules/types.ts";

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

// A custom rule also has to be declared on h3's `RouteRules` to be readable off
// `event.context.routeRules`, since `src/types/route-rules.ts` names the
// built-ins explicitly rather than contributing an index signature (which would
// break every other module's augmentation of that shared interface). Only the
// fixture keys actually read off the context need this.
declare module "../../src/types/route-rules.ts" {
  interface RouteRules {
    custom?: MatchedRouteRule<"custom">;
  }
}
