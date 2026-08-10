import { compareRoutes } from "rou3";
import { describe, expect, it } from "vitest";
import { canOverrideRouteShape, createMatcherFromFind } from "../../src/rules/match.ts";
import type { FindRouteRules } from "../../src/rules/match.ts";
import type { RouteRuleLayer } from "../../src/rules/merge.ts";

// Layers as rou3 would hand them over (least → most specific), for a hand-built
// `findRouteRules` — the compiled-fragment integration point.
const layer = (route: string, options: unknown): RouteRuleLayer => ({
  data: [{ name: "basicAuth", route, options }],
});

const BROAD = layer("/**", { username: "guest", password: "guest" });
const ADMIN = layer("/app/admin/**", { username: "admin", password: "s3cret" });

// The served (raw) path resolves the narrow admin gate; every other reading —
// here the `%2e%2e` canonicalization, which walks *up* out of /app/admin —
// resolves only the broad one.
const find: FindRouteRules = (_method, pathname) =>
  pathname.startsWith("/app/admin") ? [BROAD, ADMIN] : [BROAD];

// Canonicalizes to "/y", so the canonical pass matches `/**` alone.
const ESCALATION = "/app/admin/x/%2e%2e/%2e%2e/%2e%2e/y";

describe("createMatcherFromFind override guard", () => {
  it("guards specificity by default (no broader-pattern downgrade)", () => {
    const matcher = createMatcherFromFind(find);
    const basicAuth = matcher("GET", ESCALATION).routeRules.basicAuth!;
    expect(basicAuth.route).toBe("/app/admin/**");
    expect(basicAuth.options).toMatchObject({ username: "admin" });
  });

  it("still lets a narrower reading upgrade a broader resolved rule", () => {
    // `%2f` keeps the raw path a single opaque segment (broad rule only); the
    // canonical reading reveals the narrower admin gate, which must win.
    const encoded = "/app/admin%2fpanel";
    const upgrade: FindRouteRules = (_method, pathname) =>
      pathname.includes("/admin/") ? [BROAD, ADMIN] : [BROAD];
    const basicAuth = createMatcherFromFind(upgrade)("GET", encoded).routeRules.basicAuth!;
    expect(basicAuth.route).toBe("/app/admin/**");
    expect(basicAuth.options).toMatchObject({ username: "admin" });
  });

  it("`() => true` opts back into unconditional override", () => {
    const matcher = createMatcherFromFind(find, () => true);
    const basicAuth = matcher("GET", ESCALATION).routeRules.basicAuth!;
    expect(basicAuth.route).toBe("/**");
    expect(basicAuth.options).toMatchObject({ username: "guest" });
  });

  it("the default guard never allows what rou3 `compareRoutes` forbids", () => {
    // The default is dependency-free (rou3 must stay out of compiled bundles),
    // so it decides containment by pattern shape. It may be *more* conservative
    // than the exact predicate the runtime matcher injects, but never more
    // permissive — otherwise a compiled matcher would accept a downgrade the
    // runtime rejects. rou3 itself is the oracle here.
    const routes = [
      "/**",
      "/a",
      "/a/",
      "/a/**",
      "/a/*",
      "/a/b",
      "/a/b/**",
      "/a/b/c",
      "/a/:id",
      "/a/:id/**",
      "/a/:id/b",
      "/a/*/c",
      "/a/b/*",
      "/a//b",
      "/:x/**",
      "/:x/b",
      "/*/b",
      "/*/**",
      "/*/*/**",
      "/admin/**",
      "/admin/panel",
      "/app/admin/**",
      "/params/:section/**",
      "/params/:section/:id",
      String.raw`/a/:id(\d+)`,
      String.raw`/a/:id(\d+)/**`,
      "/file-*",
      "/a/b-*/c",
      "/**:rest",
      "/a/**:rest",
      "/a/*/**",
      "/",
    ];
    const unsound: string[] = [];
    for (const current of routes) {
      for (const incoming of routes) {
        if (current === incoming) {
          continue;
        }
        const rel = compareRoutes(current, incoming);
        const exact = rel === "superset" || rel === "equal";
        if (canOverrideRouteShape(current, incoming) && !exact) {
          unsound.push(`${current} -> ${incoming} (${rel})`);
        }
      }
    }
    expect(unsound).toEqual([]);
    // …and it is not vacuously strict: the containment cases that matter resolve.
    expect(canOverrideRouteShape("/**", "/admin/**")).toBe(true);
    expect(canOverrideRouteShape("/admin/**", "/admin/panel/**")).toBe(true);
    expect(canOverrideRouteShape("/params/:section/**", "/params/:section/:id")).toBe(true);
    expect(canOverrideRouteShape("/admin/**", "/**")).toBe(false);
    expect(canOverrideRouteShape("/admin/**", "/public/**")).toBe(false);
  });

  it("an explicit predicate still overrides the default", () => {
    const seen: Array<[string, string]> = [];
    const matcher = createMatcherFromFind(find, (current, incoming) => {
      seen.push([current, incoming]);
      return false;
    });
    expect(matcher("GET", ESCALATION).routeRules.basicAuth!.route).toBe("/app/admin/**");
    expect(seen).toEqual([["/app/admin/**", "/**"]]);
  });
});
