// Type-level tests for the compiler input surface. Validated by `pnpm
// typecheck` (tsgo) — a stray `@ts-expect-error` with no underlying error fails
// the build. Not run by vitest (`.test-d.ts` does not match the runtime test
// glob); it declares no runtime behavior.
import {
  compileFindRouteRules,
  compileHandlersImport,
  compileRouteRules,
} from "../../src/rules/compiler.ts";
import { normalizeRouteRules } from "../../src/rules/normalize.ts";

// --- Compiler input is the closed `RouteRuleConfig`: typos are compile errors ---

// The entrypoints take `Record<string, RouteRuleConfig>` (same as the runtime
// `routeRules()` entry), so a typo'd rule key is rejected at the build-time
// surface where it would otherwise be baked into generated code as a silent
// data-only rule.
compileRouteRules({
  // @ts-expect-error - unknown key `redirct` on the closed RouteRuleConfig
  "/old/**": { redirct: "/new" },
});
compileFindRouteRules({
  // @ts-expect-error - unknown key `header` on the closed RouteRuleConfig
  "/api/**": { header: { a: "1" } },
});
compileHandlersImport({
  // @ts-expect-error - unknown key `redirct` on the closed RouteRuleConfig
  "/old/**": { redirct: "/new" },
});

// Authored config (shortcuts included) type-checks as-is.
compileRouteRules({ "/api/**": { swr: 60, cors: true } });

// Already-normalized rule sets stay valid input without a cast (the compiler
// normalizes internally and `normalizeRouteRules` is idempotent — a pinned
// contract, see test/normalize.test.ts).
compileRouteRules(normalizeRouteRules({ "/api/**": { swr: 60 } }));
compileFindRouteRules(normalizeRouteRules({ "/old/**": { redirect: "/new/**" } }));
compileHandlersImport(normalizeRouteRules({ "/api/**": { cors: true } }));
