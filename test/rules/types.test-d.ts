// Type-level tests for the route-rule config surface. Validated by `pnpm
// typecheck` (tsgo) — a stray `@ts-expect-error` with no underlying error, or a
// failing `expectTypeOf`, fails the build. Not run by vitest (`.test-d.ts` does
// not match the runtime test glob); it declares no runtime behavior.
import { expectTypeOf } from "vitest";
import type { CachedEventHandlerOptions } from "ocache";
import { compileRouteRules } from "../../src/rules/compiler.ts";
import { normalizeRouteRules } from "../../src/rules/normalize.ts";
import { routeRules } from "../../src/rules/middleware.ts";
import type {
  CacheRuleOptions,
  MatchedRouteRules,
  RouteRuleConfig,
  RouteRules,
  RuleHandler,
} from "../../src/rules/types.ts";

// --- `RuleHandler.order` is numeric-only (the "pre"/"post" sugar is removed;
// built-in bands: cors -3, basicAuth -2, headers -1, default 0) ---

expectTypeOf<RuleHandler["order"]>().toEqualTypeOf<number | undefined>();

// --- `routeRules()` accepts matcher options plus `memoize` ---

routeRules({}, { memoize: false });
routeRules({}, { memoize: { max: 256 } });
routeRules({}, { baseURL: "/app", preMerge: true, memoize: true });

// --- Vendored `CacheRuleOptions` stays ocache-compatible ---

// The core cache rule schema is vendored (no ocache import in runtime types).
// Every field must remain assignable to ocache's `CachedEventHandlerOptions` —
// the `h3/rules/cache` glue spreads rule options straight into ocache options.
expectTypeOf<Required<CacheRuleOptions>>().toMatchTypeOf<CachedEventHandlerOptions>();
// ...and its key set must not drift outside ocache's option names.
expectTypeOf<keyof CacheRuleOptions>().toMatchTypeOf<keyof CachedEventHandlerOptions>();

// --- `RouteRuleConfig` is a closed interface: typos are compile errors ---

// A typo for `redirect` on a direct annotation.
// @ts-expect-error - unknown key `redirct` on the closed RouteRuleConfig
const typoRedirect: RouteRuleConfig = { redirct: "/new" };
void typoRedirect;

// A typo for `headers` on a direct annotation.
// @ts-expect-error - unknown key `header` on the closed RouteRuleConfig
const typoHeaders: RouteRuleConfig = { header: { a: "1" } };
void typoHeaders;

// The same typo inside a `routeRules({...})` config argument.
routeRules({
  // @ts-expect-error - unknown key `redirct` in the routeRules config
  "/old/**": { redirct: "/new" },
});

// ...and inside a `normalizeRouteRules({...})` config argument.
normalizeRouteRules({
  // @ts-expect-error - unknown key `header` in the normalizeRouteRules config
  "/api/**": { header: { a: "1" } },
});

// Known keys still type-check.
const known: RouteRuleConfig = {
  redirect: "/new",
  headers: { "x-a": "1" },
  cors: true,
  swr: 60,
  cache: false,
  basicAuth: { username: "u", password: "p" },
};
void known;

// --- Compiler input: authored config or already-normalized rules ---

// The compiler normalizes internally, so both shapes are valid input without a
// cast — normalized output with built-in keys is structurally assignable to
// `RouteRuleConfig`. The closed-interface typo check applies at the compiler
// boundary too (pinned in test/compiler.test-d.ts).
compileRouteRules({ "/api/**": { swr: 60, cors: true } });
compileRouteRules(normalizeRouteRules({ "/api/**": { swr: 60 } }));

// --- Custom keys are re-enabled via module augmentation ---

declare module "../../src/rules/types.ts" {
  interface RouteRuleConfig {
    myPlugin?: { mode: "a" | "b" };
  }
  interface RouteRules {
    myPlugin?: { mode: "a" | "b" };
  }
}

// The augmented key type-checks in config (annotation + both entry points).
const augmented: RouteRuleConfig = { myPlugin: { mode: "a" } };
void augmented;
routeRules({ "/x": { myPlugin: { mode: "b" } } });
normalizeRouteRules({ "/x": { myPlugin: { mode: "b" } } });

// A wrong shape for the augmented key is still caught.
// @ts-expect-error - `mode` must be "a" | "b"
const augmentedBad: RouteRuleConfig = { myPlugin: { mode: "c" } };
void augmentedBad;

// ...and readable off the normalized `RouteRules` shape as the augmented type.
declare const normalized: RouteRules;
expectTypeOf(normalized.myPlugin).toEqualTypeOf<{ mode: "a" | "b" } | undefined>();

// It is also accessible off the matched-rule map. `MatchedRouteRules` stays
// intentionally open (its key domain is `string`, since `RouteRules` carries an
// index signature for arbitrary data-only rules), so a matched rule's `options`
// widen to `unknown` — augmented or not; the key is reachable without a cast.
declare const matched: MatchedRouteRules;
expectTypeOf(matched.myPlugin?.options).toEqualTypeOf<unknown>();
