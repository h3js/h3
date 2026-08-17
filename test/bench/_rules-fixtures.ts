/**
 * Rule sets and probe grid for `rules-bundle-inspect.ts`.
 *
 * Deliberately built from `headers` and data-only rules: the target is the
 * *core* of route rules (codegen, router build, layer merge, override guard,
 * bundle cost), not any individual handler's implementation. A handler with
 * real logic (cache/proxy) would dominate both the generated code and
 * the bundle and hide the thing under audit.
 */

// Type-only import: `prerender` / `custom` are data-only keys, and
// `RouteRuleConfig` is a closed interface — this pulls in the same module
// augmentation the rules tests use (no runtime import; erased by tsc).
import type {} from "../rules/_augment.ts";
import type { RouteRuleConfig } from "../../src/rules/types.ts";

export interface RulesFixture {
  description: string;
  config: Record<string, RouteRuleConfig>;
  /**
   * Whether the pattern set is chain-clean (every overlapping pair strictly
   * ordered by containment) — i.e. whether `preMerge` applies instead of
   * warning and falling back to plain compilation.
   */
  chainClean: boolean;
}

export const FIXTURES: Record<string, RulesFixture> = {
  // Default. Overlapping wildcards, a named param, method-scoped keys and a
  // catch-all — every core code path, one trivial handler.
  headers: {
    description: "headers rules + data-only rules, chain-clean",
    chainClean: true,
    config: {
      "/**": { headers: { "x-catch": "all" } },
      "/api/**": { headers: { "x-api": "1" } },
      "GET /api/**": { headers: { "x-api-get": "1" } },
      "POST /api/**": { headers: { "x-api-post": "1" } },
      "/api/admin/**": { headers: { "cache-control": "no-store" } },
      "/api/admin/keys": { headers: { "x-admin-keys": "1" } },
      "/blog/**": { headers: { "cache-control": "s-maxage=60" }, prerender: true },
      "/blog/:slug": { headers: { "x-slug": "1" } },
      "/static/**": { headers: { "cache-control": "max-age=31536000, immutable" } },
    },
  },

  // No runtime handler at all: the generated module must carry zero imports, so
  // this is the floor of what compiled rules cost.
  data: {
    description: "data-only rules (no handler import at all), chain-clean",
    chainClean: true,
    config: {
      "/**": { prerender: false },
      "/api/**": { custom: { layer: "api" } },
      "GET /api/**": { custom: { layer: "api-get" } },
      "/api/admin/**": { custom: { layer: "admin" } },
      "/api/admin/keys": { custom: { layer: "keys" } },
      "/blog/**": { prerender: true, custom: { layer: "blog" } },
      "/blog/:slug": { custom: { layer: "post" } },
      "/static/**": { prerender: true },
    },
  },

  // `/a/*/c` and `/a/b/**` overlap partially, so "most specific layer" is
  // ambiguous: `preMerge` must warn once and fall back to plain compilation
  // rather than emitting a silently different matcher.
  overlap: {
    description: "partially overlapping patterns (preMerge must fall back)",
    chainClean: false,
    config: {
      "/**": { headers: { "x-catch": "all" } },
      "/a/*/c": { headers: { "x-star": "1" } },
      "/a/b/**": { headers: { "x-b": "1" } },
      "/a/b/c": { headers: { "x-exact": "1" } },
    },
  },
};

/**
 * Probe grid — method × path. Beyond the plain matches it covers the readings
 * the matcher resolves besides the served path: encoded separators, dot
 * segments and trailing slashes (where a broader alternate reading must not
 * downgrade a narrower rule), plus a lowercase method (the matcher itself does
 * not uppercase — only the `routeRules()` middleware does).
 */
export const PROBES: readonly (readonly [string, string])[] = [
  ["GET", "/"],
  ["GET", "/api"],
  ["GET", "/api/x"],
  ["POST", "/api/x"],
  ["PUT", "/api/x"],
  ["HEAD", "/api/x"],
  ["get", "/api/x"],
  ["GET", "/api/admin/keys"],
  ["GET", "/api/admin/keys/"],
  ["GET", "/api/admin/other"],
  ["GET", "/blog/hello"],
  ["GET", "/blog/hello/world"],
  ["GET", "/static/app.js"],
  ["GET", "/a/b/c"],
  ["GET", "/a/x/c"],
  ["GET", "/a/b/c/d"],
  ["GET", "/unmatched/x"],
  ["GET", "/api/admin%2fkeys"],
  ["GET", "/api/foo/%2e%2e/%2fadmin/keys"],
  ["GET", "/api/foo/..%2f%2fadmin/keys"],
  ["GET", "/api/foo/%2e%2e%2f%2fadmin/keys"],
  ["GET", "/static/%2e%2e/api/admin/keys"],
  ["GET", "/blog/a%2fb"],
];

/** Shape of a match result as read back from a bundle (handlers opaque). */
export interface MatchResultLike {
  /** Merged options per rule name — what `event.context.routeRules` publishes. */
  routeRules: Record<string, unknown>;
  /** The matched rules with their provenance (pattern, params, handler). */
  matchedRules: Record<
    string,
    {
      route?: string;
      options?: unknown;
      params?: Record<string, string>;
      handler?: { order?: number };
    }
  >;
  routeRuleMiddleware: unknown[];
}

export interface MatchSnapshot {
  rules: Record<
    string,
    {
      route: string | undefined;
      options: unknown;
      params: Record<string, string> | undefined;
      hasHandler: boolean;
      order: number | undefined;
    }
  >;
  /** Merged options per rule name, as published on the event context. */
  options: Record<string, unknown>;
  middlewareCount: number;
}

/**
 * Structural view of a match result, comparable across variants: handler
 * functions are compared by presence + `order` only (a compiled bundle
 * references the imported handler, a runtime matcher its own registry entry, so
 * identity intentionally differs).
 *
 * Snapshots the *matched* rules, not the published `routeRules` map: the latter
 * carries only the merged options, so a parity check built on it cannot see the
 * provenance (pattern, params) or the handler binding the execution modes have
 * to agree on — it would compare all-`undefined` fields and pass vacuously.
 * `routeRules` is snapshotted alongside, as the resolved options themselves.
 */
export function snapshotMatch(result: MatchResultLike): MatchSnapshot {
  return {
    rules: Object.fromEntries(
      Object.entries(result.matchedRules).map(([name, rule]) => [
        name,
        {
          route: rule.route,
          options: rule.options,
          params: rule.params ?? undefined,
          hasHandler: !!rule.handler,
          order: rule.handler?.order,
        },
      ]),
    ),
    options: { ...result.routeRules },
    middlewareCount: result.routeRuleMiddleware.length,
  };
}
