// Type-level tests for the route-rule config surface. Validated by `pnpm
// typecheck` (tsgo) — a stray `@ts-expect-error` with no underlying error, or a
// failing `expectTypeOf`, fails the build. Not run by vitest (`.test-d.ts` does
// not match the runtime test glob); it declares no runtime behavior.
import { expectTypeOf } from "vitest";
import type { CachedEventHandlerOptions } from "ocache";
import { compileRouteRules } from "../../src/rules/compiler.ts";
import { normalizeRouteRules } from "../../src/rules/normalize.ts";
import { routeRules } from "../../src/rules/middleware.ts";
import type { BasicAuthOptions } from "../../src/utils/auth.ts";
import type { ResolvedRouteRules as ContextRouteRules } from "../../src/types/route-rules.ts";
import type {
  BasicAuthRuleOptions,
  CacheRuleOptions,
  MatchResult,
  MatchedRouteRules,
  NormalizedRouteRules,
  RedirectRuleOptions,
  RouteRuleConfig,
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
// ...and its key set must not drift outside ocache's option names — except for
// `allowAuthorization`, an h3-rules-level credential switch ocache has no
// counterpart for (it forwards `Authorization` untouched and never keys on it).
expectTypeOf<Exclude<keyof CacheRuleOptions, "allowAuthorization">>().toMatchTypeOf<
  keyof CachedEventHandlerOptions
>();

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

// A custom rule is declared **once, in one shape**, on the two interfaces that
// describe its two ends: `RouteRuleConfig` (what is authored) and `RouteRules`
// (what the merge resolves). The merged value *is* the config value, so the two
// declarations are identical — there is no second, wrapper-shaped one. Each is
// augmented in the module that declares it.
declare module "../../src/rules/types.ts" {
  interface RouteRuleConfig {
    myPlugin?: { mode: "a" | "b" };
  }
}

declare module "../../src/types/route-rules.ts" {
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

// ...and readable off the normalized rules as the augmented type. Normalization
// only expands sugar, so a rule's normalized type is its declared one (plus the
// `false` reset marker where the authored config admits one — not here).
declare const normalized: NormalizedRouteRules;
expectTypeOf(normalized.myPlugin).toEqualTypeOf<{ mode: "a" | "b" } | undefined>();

// The **whole point** of the single declaration: the merged rule reads as the
// config it was authored from, off the matched result and off the event context
// alike — no `.options` hop, no second augmentation.
declare const result: MatchResult;
expectTypeOf(result.routeRules.myPlugin).toEqualTypeOf<{ mode: "a" | "b" } | undefined>();
declare const onContext: Readonly<ContextRouteRules>;
expectTypeOf(onContext.myPlugin).toEqualTypeOf<{ mode: "a" | "b" } | undefined>();

// Provenance is still typed, on the matched-rule wrappers the handlers get.
declare const matched: MatchedRouteRules;
expectTypeOf(matched.myPlugin?.options).toEqualTypeOf<{ mode: "a" | "b" } | undefined>();
expectTypeOf(matched.myPlugin?.route).toEqualTypeOf<string | undefined>();
expectTypeOf<MatchResult["matchedRules"]>().toEqualTypeOf<MatchedRouteRules>();

// --- The shared `RouteRules` stays augmentable for h3's own built-in keys ---

// Third-party rule modules (Nitro, the standalone `h3-rules` package) have long
// declared the built-in keys on h3's shared `RouteRules` interface with their
// own shapes:
//
//   declare module "h3" {
//     interface RouteRules { redirect?: { to: string; status?: number } }
//   }
//
// Declaration merging compares redeclared properties by **type identity**, so
// naming the built-ins on `RouteRules` directly made every such augmentation a
// `TS2717`, and inheriting them (`extends BuiltinRouteRules`) only downgraded it
// to a `TS2430` assignability check the real shapes fail — see the block comment
// in `src/types/route-rules.ts`. `RouteRules` is unconstrained instead, and the
// built-ins are composed in by `ResolvedRouteRules` for the keys nobody claimed.
//
// The augmentation below is that exact scenario, expressed against the source
// module (typecheck runs over `src/`, not the built `h3` package). It uses
// `proxy` rather than `redirect` only because module augmentation is
// program-global: the runtime suites read `routeRules.redirect` and
// `routeRules.cache` off the context, and re-typing those keys here
// would re-type them for every file in the program. It deliberately carries
// both arms the inherited design rejected: a bare `string` (the shape h3's own
// `@example` shipped, and `nitropack`'s `redirect`) and `false` (h3's reset
// marker, which `nitropack` spells on `cache` and `cors`).
declare module "../../src/types/route-rules.ts" {
  interface RouteRules {
    proxy?: string | { to: string; status?: number } | false;
  }
}

declare const contextRules: ContextRouteRules;

// The augmented key comes through verbatim — h3's built-in is replaced, not
// intersected with (an intersection would be uninhabitable).
expectTypeOf(contextRules.proxy).toEqualTypeOf<
  string | { to: string; status?: number } | false | undefined
>();

// A built-in nobody augmented is exactly its merged option type — no wrapper and
// no escape-hatch widening, so members read without narrowing.
expectTypeOf(contextRules.redirect).toEqualTypeOf<RedirectRuleOptions | undefined>();
expectTypeOf<NonNullable<ContextRouteRules["redirect"]>["to"]>().toEqualTypeOf<string>();
expectTypeOf(contextRules.redirect?.status).toEqualTypeOf<number | undefined>();
expectTypeOf(contextRules.headers).toEqualTypeOf<Record<string, string> | undefined>();

// ...and the resolved type is still closed: an undeclared key is a compile error.
// @ts-expect-error - unknown rule key on the context `RouteRules`
contextRules.notDeclaredAnywhere;

// --- `basicAuth` rule options require a credential ---

// h3's own `BasicAuthOptions` is `Partial<...> & ({ validate } | { password })`,
// i.e. a credential is mandatory. A `Pick<>` of it erased that union, so a rule
// with only a `username` type-checked and then 500'd at runtime. `validate` is
// deliberately not a rule option (a function is not expressible in compiled
// rule config), so `password` is simply required.
// @ts-expect-error - `password` is required on a `basicAuth` rule
const basicAuthNoPassword: RouteRuleConfig = { basicAuth: { username: "admin" } };
void basicAuthNoPassword;

// @ts-expect-error - `validate` is not a `basicAuth` rule option
const basicAuthValidate: RouteRuleConfig = { basicAuth: { validate: () => true } };
void basicAuthValidate;

// `password` alone is enough; `username`/`realm` stay optional.
const basicAuthOk: RouteRuleConfig = { basicAuth: { password: "p" } };
void basicAuthOk;
const basicAuthFull: RouteRuleConfig = {
  basicAuth: { username: "u", password: "p", realm: "R" },
};
void basicAuthFull;

// `false` remains the reset marker.
const basicAuthReset: RouteRuleConfig = { basicAuth: false };
void basicAuthReset;

// The same shape is required on the normalized rules.
declare const normalizedAuth: NormalizedRouteRules;
expectTypeOf(normalizedAuth.basicAuth).toEqualTypeOf<BasicAuthRuleOptions | false | undefined>();

// Rule options stay usable with h3's own `requireBasicAuth`/`basicAuth`.
expectTypeOf<BasicAuthRuleOptions>().toExtend<BasicAuthOptions>();
