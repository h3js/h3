import { compareRoutes } from "rou3";
import { describe, expect, it } from "vitest";
import { H3 } from "../../src/index.ts";
import { compileFindRouteRules } from "../../src/rules/compiler.ts";
import {
  canOverrideRouteShape,
  createMatcherFromFind,
  createRouteRulesMatcher,
} from "../../src/rules/match.ts";
import type { FindRouteRules, RouteRulesMatcher } from "../../src/rules/match.ts";
import type { RouteRuleLayer } from "../../src/rules/merge.ts";
import { routeRules } from "../../src/rules/middleware.ts";
import { normalizeRouteRules } from "../../src/rules/normalize.ts";
import type { RouteRuleConfig } from "../../src/rules/types.ts";

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
    const basicAuth = matcher("GET", ESCALATION).matchedRules.basicAuth!;
    expect(basicAuth.route).toBe("/app/admin/**");
    expect(basicAuth.options).toMatchObject({ username: "admin" });
  });

  it("still lets a narrower reading upgrade a broader resolved rule", () => {
    // `%2f` keeps the raw path a single opaque segment (broad rule only); the
    // canonical reading reveals the narrower admin gate, which must win.
    const encoded = "/app/admin%2fpanel";
    const upgrade: FindRouteRules = (_method, pathname) =>
      pathname.includes("/admin/") ? [BROAD, ADMIN] : [BROAD];
    const basicAuth = createMatcherFromFind(upgrade)("GET", encoded).matchedRules.basicAuth!;
    expect(basicAuth.route).toBe("/app/admin/**");
    expect(basicAuth.options).toMatchObject({ username: "admin" });
  });

  it("`() => true` opts back into unconditional override", () => {
    const matcher = createMatcherFromFind(find, () => true);
    const basicAuth = matcher("GET", ESCALATION).matchedRules.basicAuth!;
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
    expect(matcher("GET", ESCALATION).matchedRules.basicAuth!.route).toBe("/app/admin/**");
    // Exactly one consultation: the predicate's only job is the cross-reading
    // override guard. Ordering the matched layers of a single reading uses their
    // build-time `rank` instead, so it never reaches the predicate — which is
    // what keeps a compiled matcher's conservative default out of gate retention.
    expect(seen).toEqual([["/app/admin/**", "/**"]]);
  });
});

// ---------------------------------------------------------------------------
// Method-agnostic gates vs. node-aliased method-scoped siblings
// ---------------------------------------------------------------------------

// rou3 buckets registrations by *node*, not by pattern text: `*`, `:id` and
// `:userId` all collapse onto `node.param`, `**`/`**:rest` onto `node.wildcard`,
// and `/admin`/`/admin/` onto the same terminal node — and lookup resolves
// `node.methods[method] || node.methods[""]`. So a method-scoped rule spelled
// differently from a method-agnostic one on the same node used to hide it
// outright: the agnostic gate was never returned for that method.
//
// Each pair below is [agnostic gate, method-scoped sibling, probe path]. The
// gate must survive on *every* method; the scoped rule appears only on GET/HEAD.
const ALIASED_PAIRS: Array<[gate: string, scoped: string, path: string]> = [
  ["/a/*", "GET /a/:id", "/a/b"],
  ["/a/:id", "GET /a/:userId", "/a/b"],
  ["/a/**", "GET /a/**:rest", "/a/b"],
  ["/**", "GET /**:path", "/a/b"],
  ["/admin", "GET /admin/", "/admin"],
  // Reversed spelling order (scoped pattern is the "broader" spelling).
  ["/a/:id", "GET /a/*", "/a/b"],
  // Control: identical pattern text — the one spelling combination that always
  // worked (same `byPath` bucket).
  ["/a/b", "GET /a/b", "/a/b"],
];

const aliasConfig = (gate: string, scoped: string): Record<string, RouteRuleConfig> => ({
  [gate]: { basicAuth: { username: "admin", password: "s3cret" } },
  [scoped]: { headers: { "cache-control": "max-age=60" } },
});

const ruleNames = (matcher: RouteRulesMatcher, method: string, path: string): string[] =>
  Object.keys(matcher(method, path).routeRules).sort();

// Evaluate a compiled `findRouteRules` fragment with the handler bindings it
// may reference — the compiler shares `createRulesRouter`, so the fix must
// reach codegen with no compiler change.
function evaluateCompiledMatcher(config: Record<string, RouteRuleConfig>): RouteRulesMatcher {
  const code = compileFindRouteRules(config);
  // eslint-disable-next-line no-new-func
  const find = new Function(
    "__ruleHandlers__$basicAuth",
    "__ruleHandlers__$headers",
    `return (${code});`,
  )(undefined, undefined) as FindRouteRules;
  return createMatcherFromFind(find);
}

describe("method-agnostic rules vs node-aliased method-scoped siblings", () => {
  it.each(ALIASED_PAIRS)("keeps the agnostic gate for %s alongside %s", (gate, scoped, path) => {
    const matcher = createRouteRulesMatcher(normalizeRouteRules(aliasConfig(gate, scoped)));
    // The gate is method-agnostic — it must be matched on every method…
    expect(ruleNames(matcher, "GET", path)).toEqual(["basicAuth", "headers"]);
    expect(ruleNames(matcher, "POST", path)).toEqual(["basicAuth"]);
    expect(ruleNames(matcher, "DELETE", path)).toEqual(["basicAuth"]);
    // …including HEAD, which serves the GET-scoped layers too (RFC 9110).
    expect(ruleNames(matcher, "HEAD", path)).toEqual(["basicAuth", "headers"]);
    // The gate's options survive intact (not clobbered by the sibling).
    expect(matcher("GET", path).routeRules.basicAuth).toEqual({
      username: "admin",
      password: "s3cret",
    });
  });

  it.each(ALIASED_PAIRS)("compiled matcher matches runtime for %s + %s", (gate, scoped, path) => {
    const config = aliasConfig(gate, scoped);
    const runtime = createRouteRulesMatcher(normalizeRouteRules(config));
    const compiled = evaluateCompiledMatcher(config);
    for (const method of ["GET", "HEAD", "POST", "DELETE"]) {
      expect(ruleNames(compiled, method, path), `${method} ${path}`).toEqual(
        ruleNames(runtime, method, path),
      );
    }
  });

  it("a method-scoped sibling still overrides the agnostic rule it shares a name with", () => {
    // Materializing the agnostic entry onto every used method must not flip
    // precedence: the method-scoped value still wins on its method, and the
    // agnostic one still applies everywhere else.
    const config: Record<string, RouteRuleConfig> = {
      "/a/*": { headers: { "x-b": "all" } },
      "GET /a/:id": { headers: { "x-b": "get" } },
    };
    const matcher = createRouteRulesMatcher(normalizeRouteRules(config));
    expect(matcher("GET", "/a/b").routeRules.headers).toEqual({ "x-b": "get" });
    expect(matcher("HEAD", "/a/b").routeRules.headers).toEqual({ "x-b": "get" });
    expect(matcher("POST", "/a/b").routeRules.headers).toEqual({ "x-b": "all" });
    const compiled = evaluateCompiledMatcher(config);
    expect(compiled("GET", "/a/b").routeRules.headers).toEqual({ "x-b": "get" });
    expect(compiled("POST", "/a/b").routeRules.headers).toEqual({ "x-b": "all" });
  });

  it("layer order between differently-specific spellings stays rou3's", () => {
    // Method scope selects *which* registrations are matched; it does not
    // re-rank patterns. rou3 sorts `/a/*` ahead of `/a/:id` on the shared param
    // node (unnamed catch-all first) regardless of config order, so the `/a/:id`
    // layer is last and wins — for two agnostic patterns and, identically, when
    // the `/a/*` one is method-scoped. What must never happen again is the
    // agnostic layer being *absent*.
    const agnosticOnly = createRouteRulesMatcher(
      normalizeRouteRules({
        "/a/*": { headers: { x: "star" } },
        "/a/:id": { headers: { x: "named" } },
      }),
    );
    expect(agnosticOnly("GET", "/a/b").routeRules.headers).toEqual({ x: "named" });

    const mixed = createRouteRulesMatcher(
      normalizeRouteRules({
        "/a/:id": { headers: { x: "named" } },
        "GET /a/*": { headers: { x: "star" } },
      }),
    );
    expect(mixed("GET", "/a/b").routeRules.headers).toEqual({ x: "named" });
    expect(mixed("POST", "/a/b").routeRules.headers).toEqual({ x: "named" });
  });

  it("an explicit HEAD rule still overrides the GET-derived one", () => {
    const matcher = createRouteRulesMatcher(
      normalizeRouteRules({
        "/a/*": { headers: { "x-b": "all" } },
        "GET /a/:id": { headers: { "x-b": "get" } },
        "HEAD /a/:id": { headers: { "x-b": "head" } },
      }),
    );
    expect(matcher("HEAD", "/a/b").routeRules.headers).toEqual({ "x-b": "head" });
    expect(matcher("GET", "/a/b").routeRules.headers).toEqual({ "x-b": "get" });
  });

  it("does not leak a method-scoped rule onto another method", () => {
    const matcher = createRouteRulesMatcher(
      normalizeRouteRules({
        "/a/*": { basicAuth: { username: "admin", password: "s3cret" } },
        "POST /a/:id": { headers: { "x-b": "post" } },
      }),
    );
    expect(ruleNames(matcher, "POST", "/a/b")).toEqual(["basicAuth", "headers"]);
    expect(ruleNames(matcher, "GET", "/a/b")).toEqual(["basicAuth"]);
    expect(ruleNames(matcher, "HEAD", "/a/b")).toEqual(["basicAuth"]);
  });

  it("does not register agnostic-only rule sets per method", () => {
    // No method-scoped key anywhere → no materialization, byte-identical output.
    const before = compileFindRouteRules({ "/a/**": { headers: { "x-a": "1" } } });
    expect(before).not.toContain('m==="GET"');
  });

  it("materializes an agnostic rule only onto methods scoped on a node it shares", () => {
    // `/a/**` and `/b/**` land on different radix nodes, so the POST-scoped key
    // cannot hide the agnostic one and must not buy it a POST copy. Only the
    // `/b/**` branch may be method-guarded.
    const code = compileFindRouteRules({
      "/a/**": { headers: { "x-a": "1" } },
      "POST /b/**": { headers: { "x-b": "1" } },
    });
    expect(code.match(/m===/g)).toHaveLength(1);
    expect(code).toContain('m==="POST"');
    // `$0` is the agnostic pattern's entry array: declared once, pushed once —
    // no second, method-scoped registration of it.
    expect(code.match(/data:\$0/g)).toHaveLength(1);
    // …while a shared node does buy that copy (`/a/*` aliasing `/a/:id`): the
    // agnostic layer is pushed from the POST branch as well as the fallback one.
    const shared = compileFindRouteRules({
      "/a/*": { headers: { "x-a": "1" } },
      "POST /a/:id": { headers: { "x-b": "1" } },
    });
    expect(shared.match(/data:\$0/g)).toHaveLength(2);
  });

  it("keeps agnostic rules on every node an optional pattern spans", () => {
    // `/a/:x?` registers on *two* nodes (`/a` and `/a/*`), and `GET /a/:id`
    // scopes GET on the second — so the agnostic layers on **both** nodes need
    // a GET copy: `/a/:x?`'s own (or `GET /a/:id` hides it on `/a/*`) and
    // `/a`'s (because `/a/:x?`'s GET copy lands on `/a` too and would hide the
    // gate there). Grouping shared nodes transitively is what covers both; a
    // per-node grouping drops one or the other, fail-open either way.
    const config: Record<string, RouteRuleConfig> = {
      "/a": { basicAuth: { username: "admin", password: "s3cret" } },
      "/a/:x?": { headers: { "x-opt": "1" } },
      "GET /a/:id": { headers: { "x-get": "1" } },
    };
    const matcher = createRouteRulesMatcher(normalizeRouteRules(config));
    const compiled = evaluateCompiledMatcher(config);
    for (const method of ["GET", "HEAD", "POST"]) {
      expect(ruleNames(matcher, method, "/a"), method).toContain("basicAuth");
      expect(matcher(method, "/a/b").routeRules.headers, method).toMatchObject({ "x-opt": "1" });
      expect(ruleNames(compiled, method, "/a"), `compiled ${method}`).toEqual(
        ruleNames(matcher, method, "/a"),
      );
      expect(compiled(method, "/a/b").routeRules.headers, `compiled ${method}`).toEqual(
        matcher(method, "/a/b").routeRules.headers,
      );
    }
    // The scoped sibling still applies on its own method (GET, and HEAD from it).
    expect(matcher("GET", "/a/b").routeRules.headers).toEqual({ "x-opt": "1", "x-get": "1" });
    expect(matcher("POST", "/a/b").routeRules.headers).toEqual({ "x-opt": "1" });
  });

  it("reports an unparseable rule pattern as an h3 rules error", () => {
    expect(() =>
      createRouteRulesMatcher(normalizeRouteRules({ "/a/:x(": { headers: {} } })),
    ).toThrow(/^\[h3\] rules: invalid route pattern `\/a\/:x\(`:/);
  });

  it("app-level: an unauthenticated request cannot bypass the gate (basicAuth)", async () => {
    const app = new H3();
    app.use(
      routeRules({
        "/users/*": { basicAuth: { username: "admin", password: "s3cret" } },
        "GET /users/:id": { headers: { "cache-control": "max-age=60" } },
      }),
    );
    let handlerRuns = 0;
    app.all("/users/**", () => {
      handlerRuns++;
      return "PII";
    });

    for (const method of ["GET", "HEAD", "POST", "DELETE"]) {
      const res = await app.fetch(new Request("http://test/users/42", { method }));
      expect(res.status, `${method} without credentials`).toBe(401);
    }
    expect(handlerRuns).toBe(0);

    const authorized = await app.fetch(
      new Request("http://test/users/42", {
        headers: { authorization: "Basic " + btoa("admin:s3cret") },
      }),
    );
    expect(authorized.status).toBe(200);
    expect(await authorized.text()).toBe("PII");
    // The sibling rule still applies on GET.
    expect(authorized.headers.get("cache-control")).toBe("max-age=60");
    expect(handlerRuns).toBe(1);
  });
});
