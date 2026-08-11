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
import type { RouteRules as ContextRouteRules } from "../../src/types/route-rules.ts";
import type {
  BasicAuthRuleOptions,
  CacheRuleOptions,
  MatchedRouteRules,
  RedirectRuleOptions,
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

// --- h3's context `RouteRules` stays augmentable for its own built-in keys ---

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
// `TS2717`. They are declared on a base interface instead, which turns the
// check into assignability (`TS2430`) against a union carrying an escape-hatch
// arm — see the block comment in `src/types/route-rules.ts`.
//
// The augmentation below is that exact scenario, expressed against the source
// module (typecheck runs over `src/`, not the built `h3` package). It uses
// `proxy` rather than `redirect` only because module augmentation is
// program-global: the runtime suites read `routeRules.redirect?.options` and
// `routeRules.cache?.options` off the context, and re-typing those keys here
// would re-type them for every file in the program.
declare module "../../src/types/route-rules.ts" {
  interface RouteRules {
    proxy?: { to: string; status?: number };
  }
}

declare const contextRules: ContextRouteRules;

// The augmented key carries the augmenter's type, not h3's built-in wrapper.
expectTypeOf(contextRules.proxy).toEqualTypeOf<{ to: string; status?: number } | undefined>();

// A built-in nobody augmented still resolves to the `h3/rules` wrapper shape,
// so `options` keeps its rule-specific type.
expectTypeOf(contextRules.redirect?.options).toEqualTypeOf<RedirectRuleOptions | undefined>();

// The escape-hatch arm admits the legacy shapes without an augmentation having
// to match h3's wrapper exactly (this assignability is what makes the
// declaration merge above legal).
expectTypeOf<{ to: string; status?: number }>().toExtend<
  NonNullable<ContextRouteRules["redirect"]>
>();
expectTypeOf<{ to: string; _redirectStripBase?: string }>().toExtend<
  NonNullable<ContextRouteRules["redirect"]>
>();

// A named interface is admitted as well as an inline object literal — the
// escape-hatch arm must not require an (implicit) index signature.
interface LegacyRedirectRule {
  to: string;
  status?: number;
}
expectTypeOf<LegacyRedirectRule>().toExtend<NonNullable<ContextRouteRules["redirect"]>>();

// Documented limit: a *primitive* member is not admitted, since allowing one
// would remove member access from the un-augmented union entirely.
expectTypeOf<string>().not.toExtend<NonNullable<ContextRouteRules["redirect"]>>();

// ...and the interface is still closed: an undeclared key is a compile error.
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
declare const normalizedAuth: RouteRules;
expectTypeOf(normalizedAuth.basicAuth).toEqualTypeOf<BasicAuthRuleOptions | false | undefined>();

// Rule options stay usable with h3's own `requireBasicAuth`/`basicAuth`.
expectTypeOf<BasicAuthRuleOptions>().toExtend<BasicAuthOptions>();
