import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_RUNTIME_RULES,
  compileFindRouteRules,
  compileHandlersImport,
  compileRouteRules,
} from "../../src/rules/compiler.ts";
import type { CompiledRouteRules } from "../../src/rules/compiler.ts";
import * as h3Rules from "../../src/rules/index.ts";
import {
  createMatcherFromFind,
  createRouteRulesMatcher,
  memoizeRouteRulesMatcher,
} from "../../src/rules/match.ts";
import type { FindRouteRules, RouteRulesMatcher } from "../../src/rules/match.ts";
import { normalizeRouteRules } from "../../src/rules/normalize.ts";
import * as h3RulesCache from "../../src/rules/cache.ts";
import * as h3RulesProxy from "../../src/rules/proxy.ts";
import { ruleHandlers } from "../../src/rules/handlers/index.ts";
import type { RouteRuleConfig } from "../../src/rules/types.ts";
import { FIXTURE, FIXTURE_HANDLERS, PROBES, snapshotResult } from "./_fixture.ts";

// Bind every fixture handler (registry + the `h3/rules/cache` handler) as its
// `<ns>$<name>` local (superset of what any generated code references — unused
// params are harmless; the "references exactly the handlers the import emits"
// test below guards against the generated code depending on a binding the real
// import would not provide).
function evaluateFind(code: string): FindRouteRules {
  const params = Object.keys(FIXTURE_HANDLERS).map((name) => `__ruleHandlers__$${name}`);
  // eslint-disable-next-line no-new-func
  return new Function(...params, `return (${code});`)(
    ...Object.values(FIXTURE_HANDLERS),
  ) as FindRouteRules;
}

// Raw authored config in, no explicit normalize — the compiler normalizes
// internally, so the parity grid below also pins auto-normalization against the
// runtime matcher fed `normalizeRouteRules(config)`.
function evaluateCompiled(config: Record<string, RouteRuleConfig>): RouteRulesMatcher {
  return createMatcherFromFind(evaluateFind(compileFindRouteRules(config)));
}

// Evaluate a whole `compileRouteRules` module (with a `matcher` export) by
// stripping the ESM `import`/`export` keywords and binding the referenced
// `h3/rules` members — the handler locals plus the matcher-infra functions — as
// parameters, then returning the requested export. Exercises the generated
// matcher wrapper end to end, not just its source string.
function evaluateModule(mod: CompiledRouteRules, exportName = "matcher"): RouteRulesMatcher {
  const handlerParams = Object.keys(FIXTURE_HANDLERS).map((name) => `__ruleHandlers__$${name}`);
  const body = mod.body.replace(/\bexport const /g, "const ");
  // eslint-disable-next-line no-new-func
  const factory = new Function(
    ...handlerParams,
    "createMatcherFromFind",
    "memoizeRouteRulesMatcher",
    `${body}\nreturn ${exportName};`,
  );
  return factory(
    ...Object.values(FIXTURE_HANDLERS),
    createMatcherFromFind,
    memoizeRouteRulesMatcher,
  ) as RouteRulesMatcher;
}

describe("compiler parity", () => {
  const runtime = createRouteRulesMatcher(normalizeRouteRules(FIXTURE), {
    handlers: FIXTURE_HANDLERS,
  });
  const compiled = evaluateCompiled(FIXTURE);

  it.each(PROBES)("compiled === runtime for %s %s", (method, pathname) => {
    const runtimeResult = runtime(method, pathname);
    const compiledResult = compiled(method, pathname);
    expect(snapshotResult(compiledResult)).toEqual(snapshotResult(runtimeResult));
  });

  it("compiled method-scoped overrides match runtime (agnostic fallback)", () => {
    // Regression (rou3#190): compiled matchAll used to push BOTH the
    // method-scoped and the agnostic registration of a pattern, letting the
    // duplicate agnostic layer re-override method-scoped values.
    const rules = normalizeRouteRules({
      "/api/**": { headers: { "x-b": "all" } },
      "GET /api/**": { headers: { "x-b": "get" } },
    });
    const runtime = createRouteRulesMatcher(rules);
    const compiled = evaluateCompiled({
      "/api/**": { headers: { "x-b": "all" } },
      "GET /api/**": { headers: { "x-b": "get" } },
    });
    expect(compiled("GET", "/api/x").routeRules.headers).toEqual({ "x-b": "get" });
    expect(snapshotResult(compiled("GET", "/api/x"))).toEqual(
      snapshotResult(runtime("GET", "/api/x")),
    );
    expect(snapshotResult(compiled("POST", "/api/x"))).toEqual(
      snapshotResult(runtime("POST", "/api/x")),
    );
  });

  it("compiled matcher closes the slash-merged rule bypass (matches runtime)", () => {
    // The compiler only codegens the route lookup; the raw/canonical/merged
    // readings live in the shared `createMatcherFromFind`, so the compiled
    // matcher must reject the same `..`-next-to-encoded-separator bypass
    // (report vuln-12006) that the runtime matcher does.
    const config = {
      "/api/**": { headers: { "x-app": "1" } },
      "/api/admin/**": { cors: { origin: ["https://admin.example"] } },
    };
    const runtime = createRouteRulesMatcher(normalizeRouteRules(config), {
      handlers: FIXTURE_HANDLERS,
    });
    const compiled = evaluateCompiled(config);
    for (const payload of [
      "/api/foo/%2e%2e/%2fadmin/secret",
      "/api/foo/..%2f%2fadmin/secret",
      "/api/foo/%2e%2e%2f%2fadmin/secret",
    ]) {
      expect(compiled("GET", payload).routeRules.cors, payload).toBeDefined();
      expect(snapshotResult(compiled("GET", payload)), payload).toEqual(
        snapshotResult(runtime("GET", payload)),
      );
    }
  });

  it("compiled matcher export blocks broader-pattern downgrade (matches runtime)", () => {
    // The runtime guard against a broader canonical/merged pattern DOWNGRADING a
    // narrower rule the served path resolved lives in `createRouteRulesMatcher`
    // (injected `canOverride`). The compiled `matcher` export must reach parity by
    // baking that predicate — otherwise a crafted `%2e%2e` path that canonicalizes
    // *up* to the broad `/**` rule would replace the strict admin policy with the
    // site-wide permissive one.
    const config: Record<string, RouteRuleConfig> = {
      "/**": { cors: { origin: "*" } },
      "/app/admin/**": { cors: { origin: ["https://admin.example"] } },
    };
    const runtime = createRouteRulesMatcher(normalizeRouteRules(config), {
      handlers: FIXTURE_HANDLERS,
    });
    const compiled = evaluateModule(compileRouteRules(config, { matcher: true }));
    const payload = "/app/admin/x/%2e%2e/%2e%2e/%2e%2e/y";
    const cors = compiled("GET", payload).routeRules.cors as { origin: string[] };
    // The strict admin allowlist survives — not downgraded to the wildcard.
    expect(cors.origin).toEqual(["https://admin.example"]);
    expect(snapshotResult(compiled("GET", payload))).toEqual(
      snapshotResult(runtime("GET", payload)),
    );
  });

  it("bakes an override table for overlapping patterns (broad→narrow only)", () => {
    // Sanity on the emitted predicate: `/**` (broad) may be overridden by the
    // narrower `/app/admin/**`, never the reverse, and rou3 stays out of the
    // emitted source (the containment relation is a build-time static table).
    const mod = compileRouteRules(
      {
        "/**": { cors: { origin: "*" } },
        "/app/admin/**": { cors: { origin: ["https://admin.example"] } },
      },
      { matcher: true },
    );
    expect(mod.body).toContain('new Map([["/**", new Set(["/app/admin/**"])]])');
    expect(mod.code).not.toContain("rou3");
    expect(mod.code).not.toContain("compareRoutes");
  });

  it("carries a `__proto__` route param as data, like the runtime matcher", () => {
    // Regression (rou3 0.9.2): the compiled params object used to be emitted as
    // a `{__proto__: …}` literal — the prototype-setter production, not a data
    // property — so a `:__proto__` param silently vanished from the compiled
    // matcher's params while the runtime matcher carried it.
    const rules = normalizeRouteRules({ "/u/:__proto__": { headers: { "x-a": "1" } } });
    const runtimeProto = createRouteRulesMatcher(rules);
    const compiledProto = createMatcherFromFind(evaluateFind(compileFindRouteRules(rules)));
    const params = compiledProto("GET", "/u/v").matchedRules.headers!.params!;
    expect(Object.hasOwn(params, "__proto__")).toBe(true);
    expect(snapshotResult(compiledProto("GET", "/u/v"))).toEqual(
      snapshotResult(runtimeProto("GET", "/u/v")),
    );
  });

  it("compiled matcher works with baseURL", () => {
    // Already-normalized input is equally valid compiler input (idempotent
    // normalization) — the runtime matcher requires it either way.
    const rules = normalizeRouteRules({ "/x": { headers: { "x-a": "1" } } });
    const runtimeBase = createRouteRulesMatcher(rules, { baseURL: "/base/" });
    const code = compileFindRouteRules(rules, { baseURL: "/base/" });
    const compiledBase = createMatcherFromFind(evaluateFind(code));
    for (const path of ["/base/x", "/x", "/base/other"]) {
      expect(snapshotResult(compiledBase("GET", path))).toEqual(
        snapshotResult(runtimeBase("GET", path)),
      );
    }
  });
});

describe("generated code shape", () => {
  it("references runtime handlers by name and skips data-only rules", () => {
    const code = compileFindRouteRules({ "/a/**": { redirect: "/b", prerender: true } });
    expect(code).toContain("handler:__ruleHandlers__$redirect");
    expect(code).toContain('name:"prerender"');
    expect(code).not.toContain("handler:__ruleHandlers__$prerender");
  });

  it("emits the layer rank, and only where a pattern is actually subsumed", () => {
    // Layer ordering is decided by `rank` (containment depth, computed at router
    // build time), so it has to reach the compiled output — a compiled matcher
    // that merged layers in `findAllRoutes` order would lose gates the runtime
    // matcher keeps. `0` is the default and stays implicit.
    const code = compileFindRouteRules({
      "/mod/reset/*/**": { cors: { origin: ["https://admin.example"] } },
      "/mod/reset/*/:path*": { cors: false },
    });
    expect(code).toContain("rank:1"); // `/mod/reset/*/**`, subsumed by the `:path*` one
    expect([...code.matchAll(/rank:/g)]).toHaveLength(1);
    expect(compileFindRouteRules({ "/a/**": { headers: { a: "1" } } })).not.toContain("rank:");
  });

  it("a compiled matcher with no override predicate still keeps a subsumed rule", () => {
    // The divergence this pins: `createMatcherFromFind`'s dependency-free default
    // predicate (`canOverrideRouteShape`) is not exact for modifier params — it
    // cannot prove either direction between `/mod/reset/*/**` and the
    // `/mod/reset/*/:path*` that actually subsumes it. Ordering matched layers
    // must therefore never consult a predicate, or the compiled default falls
    // back on arrival order and fails open: the broader pattern's `cors: false`
    // lands last and deletes the narrower rule. `evaluateCompiled` builds
    // exactly that predicate-less matcher.
    const config: Record<string, RouteRuleConfig> = {
      "/mod/reset/*/**": { cors: { origin: ["https://admin.example"] } },
      "/mod/reset/*/:path*": { cors: false },
    };
    const compiled = evaluateCompiled(config);
    const runtime = createRouteRulesMatcher(normalizeRouteRules(config));
    for (const pathname of ["/mod/reset/v1/x", "/mod/reset/v1"]) {
      expect(snapshotResult(compiled("GET", pathname))).toEqual(
        snapshotResult(runtime("GET", pathname)),
      );
      expect(compiled("GET", pathname).routeRules.cors, pathname).toMatchObject({
        origin: ["https://admin.example"],
      });
    }
  });

  it("encodes method scope in the lookup, not per entry", () => {
    // Method scope decides *which* `(method, path)` node an entry is registered
    // on — rou3's codegen emits it as a guard. Entries carry no `method` field
    // (nothing reads one, and a merged rule can mix agnostic + scoped layers).
    const code = compileFindRouteRules({ "GET /a/**": { headers: { a: "1" } } });
    expect(code).toContain('m==="GET"');
    expect(code).not.toContain("method:");
  });

  it("references exactly the handler bindings the import emits", () => {
    // The eval harness above binds every registry handler, so it cannot catch
    // generated code referencing a `__ruleHandlers__$x` binding that
    // `compileHandlersImport` never imports (a ReferenceError in every real
    // consumer module). Pin set-equality between references and imports.
    for (const opts of [undefined, { preMerge: true }] as const) {
      const code = compileFindRouteRules(FIXTURE, opts);
      const bindings = (source: string) =>
        [...new Set([...source.matchAll(/__ruleHandlers__\$(\w+)/g)].map((m) => m[1]!))].sort();
      expect(bindings(code)).toEqual(bindings(compileHandlersImport(FIXTURE, opts)));
    }
  });

  it("imports exactly the handlers the rule set uses", () => {
    const rules: Record<string, RouteRuleConfig> = {
      "/a/**": { redirect: "/b", prerender: true },
      "/b/**": { headers: { a: "1" } },
      // `false` resets are serialized with their handler — they count as used.
      "/b/off": { cors: false },
    };
    expect(compileHandlersImport(rules)).toBe(
      'import { cors as __ruleHandlers__$cors, headers as __ruleHandlers__$headers, redirect as __ruleHandlers__$redirect } from "h3/rules";',
    );
  });

  it("emits no handlers import for data-only rule sets", () => {
    const rules: Record<string, RouteRuleConfig> = { "/a": { prerender: true } };
    expect(compileHandlersImport(rules)).toBe("");
    const mod = compileRouteRules(rules);
    expect(mod.imports).toBe("");
    expect(mod.code).not.toContain("import");
    expect(mod.body.startsWith("export const findRouteRules = ")).toBe(true);
    const matcher = createMatcherFromFind(evaluateFind(compileFindRouteRules(rules)));
    expect(matcher("GET", "/a").routeRules.prerender).toBe(true);
  });

  it("is parameterized on the handler binding prefix and per-rule source", () => {
    const rules: Record<string, RouteRuleConfig> = { "/a": { redirect: "/b" } };
    expect(compileHandlersImport(rules)).toBe(
      'import { redirect as __ruleHandlers__$redirect } from "h3/rules";',
    );
    expect(
      compileHandlersImport(rules, {
        runtimeRules: { redirect: "#my/rules" },
        handlersImportName: "__rr__",
      }),
    ).toBe('import { redirect as __rr__$redirect } from "#my/rules";');
    const code = compileFindRouteRules(rules, { handlersImportName: "__rr__" });
    expect(code).toContain("handler:__rr__$redirect");
  });

  it("DEFAULT_RUNTIME_RULES presets every built-in to its h3/rules source", () => {
    // `cache`/`proxy` live in their own subpaths so their deps (ocache, h3's
    // `proxyRequest`) only enter a compiled bundle when the rule is used.
    const subpath: Record<string, string> = { cache: "h3/rules/cache", proxy: "h3/rules/proxy" };
    for (const name of Object.keys(DEFAULT_RUNTIME_RULES)) {
      expect(DEFAULT_RUNTIME_RULES[name]).toBe(subpath[name] ?? "h3/rules");
    }
  });

  it("supports custom runtime rule names via a bare-string source", () => {
    const rules: Record<string, RouteRuleConfig> = { "/a": { shout: "x" } };
    const opts = { runtimeRules: { shout: "h3/rules" } };
    expect(compileFindRouteRules(rules, opts)).toContain("handler:__ruleHandlers__$shout");
    expect(compileHandlersImport(rules, opts)).toBe(
      'import { shout as __ruleHandlers__$shout } from "h3/rules";',
    );
  });

  it("sources a rule handler from a per-rule { source, export } override", () => {
    // A custom rule handler living in its own module under a different export
    // name; `runtimeRules` only lists the addition, so the built-in `redirect`
    // stays registered on the h3/rules source via the merge.
    const rules: Record<string, RouteRuleConfig> = { "/a/**": { redirect: "/b", isr: 60 } };
    const opts = {
      runtimeRules: {
        isr: { source: "#nitro/rules", export: "handleISR" },
      },
    };
    expect(compileFindRouteRules(rules, opts)).toContain("handler:__ruleHandlers__$isr");
    // One import per source, sources sorted; export aliased to the `<ns>$<name>`
    // binding the generated code references.
    expect(compileHandlersImport(rules, opts)).toBe(
      'import { handleISR as __ruleHandlers__$isr } from "#nitro/rules";\n' +
        'import { redirect as __ruleHandlers__$redirect } from "h3/rules";',
    );
  });

  it("overrides a built-in's source module (export defaults to the rule name)", () => {
    const rules: Record<string, RouteRuleConfig> = {
      "/a/**": { cache: { maxAge: 60 }, headers: { a: "1" } },
    };
    // Only `cache` is overridden; `headers` stays on h3/rules via the merge.
    const opts = { runtimeRules: { cache: "#nitro/cache" } };
    expect(compileHandlersImport(rules, opts)).toBe(
      'import { cache as __ruleHandlers__$cache } from "#nitro/cache";\n' +
        'import { headers as __ruleHandlers__$headers } from "h3/rules";',
    );
  });

  it("groups multiple handlers sharing a source into one import statement", () => {
    const rules: Record<string, RouteRuleConfig> = {
      "/a/**": { redirect: "/b", isr: true, prerender: true },
    };
    const opts = {
      runtimeRules: {
        redirect: "#nitro/rules",
        isr: { source: "#nitro/rules", export: "handleISR" },
        prerender: "#nitro/rules",
      },
    };
    // All three share `#nitro/rules` → a single import, specifiers in binding order.
    expect(compileHandlersImport(rules, opts)).toBe(
      'import { handleISR as __ruleHandlers__$isr, prerender as __ruleHandlers__$prerender, redirect as __ruleHandlers__$redirect } from "#nitro/rules";',
    );
  });

  it("throws when a per-rule export is not a valid JS identifier", () => {
    const rules: Record<string, RouteRuleConfig> = { "/a": { redirect: "/b" } };
    const opts = { runtimeRules: { redirect: { source: "h3/rules", export: "not valid" } } };
    expect(() => compileHandlersImport(rules, opts)).toThrow(/valid JS identifier/);
  });

  it("emits a complete module split into imports + body", () => {
    const mod = compileRouteRules({ "/a": { redirect: "/b" } });
    expect(mod.imports).toBe('import { redirect as __ruleHandlers__$redirect } from "h3/rules";');
    expect(mod.body).toContain("export const findRouteRules = ");
    // code (and `String(mod)`) is imports + body — the whole module.
    expect(mod.code).toBe(`${mod.imports}\n${mod.body}`);
    expect(`${mod}`).toBe(mod.code);
  });

  it("omits the matcher export by default", () => {
    const mod = compileRouteRules({ "/a": { redirect: "/b" } });
    expect(mod.imports).toBe('import { redirect as __ruleHandlers__$redirect } from "h3/rules";');
    expect(mod.code).not.toContain("createMatcherFromFind");
    expect(mod.code).not.toContain("export const matcher");
  });

  it("appends a createMatcherFromFind matcher export when requested", () => {
    const mod = compileRouteRules({ "/a": { redirect: "/b" } }, { matcher: true });
    // Infra import joins the handler imports; matcher export follows findRouteRules.
    expect(mod.imports).toBe(
      'import { redirect as __ruleHandlers__$redirect } from "h3/rules";\n' +
        'import { createMatcherFromFind } from "h3/rules";',
    );
    expect(mod.body).toContain("export const findRouteRules = ");
    expect(mod.body.trimEnd()).toMatch(
      /export const matcher = createMatcherFromFind\(findRouteRules, \(a, b\) => a === b\);$/,
    );
    expect(mod.code).toBe(`${mod.imports}\n${mod.body}`);
  });

  it("names the matcher export from a string / { name }", () => {
    const fromString = compileRouteRules({ "/a": { redirect: "/b" } }, { matcher: "routeMatcher" });
    expect(fromString.body).toContain(
      "export const routeMatcher = createMatcherFromFind(findRouteRules, (a, b) => a === b);",
    );
    const fromObject = compileRouteRules(
      { "/a": { redirect: "/b" } },
      { matcher: { name: "routeMatcher" } },
    );
    expect(fromObject.body).toContain(
      "export const routeMatcher = createMatcherFromFind(findRouteRules, (a, b) => a === b);",
    );
  });

  it("wraps in memoizeRouteRulesMatcher when memoize is set (and imports it only then)", () => {
    const plain = compileRouteRules({ "/a": { redirect: "/b" } }, { matcher: true });
    expect(plain.imports).not.toContain("memoizeRouteRulesMatcher");

    const memo = compileRouteRules({ "/a": { redirect: "/b" } }, { matcher: { memoize: true } });
    expect(memo.imports).toContain(
      'import { createMatcherFromFind, memoizeRouteRulesMatcher } from "h3/rules";',
    );
    expect(memo.body).toContain(
      "export const matcher = memoizeRouteRulesMatcher(createMatcherFromFind(findRouteRules, (a, b) => a === b));",
    );
  });

  it("serializes a memoize { max } cap as the second argument", () => {
    const mod = compileRouteRules(
      { "/a": { redirect: "/b" } },
      { matcher: { memoize: { max: 256 } } },
    );
    expect(mod.body).toContain(
      "export const matcher = memoizeRouteRulesMatcher(createMatcherFromFind(findRouteRules, (a, b) => a === b), { max: 256 });",
    );
  });

  it("emits the matcher export with no handler import for a data-only rule set", () => {
    const mod = compileRouteRules({ "/a": { prerender: true } }, { matcher: true });
    expect(mod.imports).toBe('import { createMatcherFromFind } from "h3/rules";');
    expect(mod.body).toContain(
      "export const matcher = createMatcherFromFind(findRouteRules, (a, b) => a === b);",
    );
  });

  it("throws when the matcher export name is not a valid JS identifier", () => {
    expect(() => compileRouteRules({ "/a": { redirect: "/b" } }, { matcher: "not valid" })).toThrow(
      /valid JS identifier/,
    );
    expect(() =>
      compileRouteRules({ "/a": { redirect: "/b" } }, { matcher: { name: "1bad" } }),
    ).toThrow(/valid JS identifier/);
  });

  it("the generated matcher export resolves identically to the runtime matcher", () => {
    const runtime = createRouteRulesMatcher(normalizeRouteRules(FIXTURE), {
      handlers: FIXTURE_HANDLERS,
    });
    for (const matcher of [true, { memoize: true }, { memoize: { max: 8 } }] as const) {
      const compiled = evaluateModule(compileRouteRules(FIXTURE, { matcher }));
      for (const [method, pathname] of PROBES) {
        expect(snapshotResult(compiled(method, pathname))).toEqual(
          snapshotResult(runtime(method, pathname)),
        );
      }
    }
  });

  it("DEFAULT_RUNTIME_RULES matches the ruleHandlers registry plus the subpath handlers", () => {
    // `cache` and `proxy` have a runtime handler but no registry entry — they are
    // the `h3/rules/cache` / `h3/rules/proxy` subpath exports instead.
    expect(Object.keys(DEFAULT_RUNTIME_RULES).sort()).toEqual(
      [...Object.keys(ruleHandlers), "cache", "proxy"].sort(),
    );
  });

  it("every runtime rule handler is a named export of its default source", () => {
    // Generated named imports must resolve to the exact handler each source
    // module exports: the registry handlers from "h3/rules", `cache` from
    // "h3/rules/cache", `proxy` from "h3/rules/proxy".
    for (const name of Object.keys(DEFAULT_RUNTIME_RULES)) {
      if (name === "cache") {
        expect(h3RulesCache.cache, name).toBe(FIXTURE_HANDLERS.cache);
      } else if (name === "proxy") {
        expect(h3RulesProxy.proxy, name).toBe(FIXTURE_HANDLERS.proxy);
      } else {
        expect((h3Rules as Record<string, unknown>)[name], name).toBe(ruleHandlers[name]);
      }
    }
  });

  it("preMerge does not import handlers only referenced by resolved `false` resets", () => {
    // preMerge applies `false` resets at compile time, so they never appear in
    // (or reference a handler from) the generated entries.
    const rules: Record<string, RouteRuleConfig> = {
      "/a/**": { cors: false, headers: { a: "1" } },
    };
    expect(compileHandlersImport(rules)).toBe(
      'import { cors as __ruleHandlers__$cors, headers as __ruleHandlers__$headers } from "h3/rules";',
    );
    expect(compileHandlersImport(rules, { preMerge: true })).toBe(
      'import { headers as __ruleHandlers__$headers } from "h3/rules";',
    );
    expect(compileFindRouteRules(rules, { preMerge: true })).not.toContain("$cors");
  });
});

describe("fail-safe preMerge", () => {
  // A non-chain-clean rule set (partial overlap) with a `false` reset on a
  // runtime rule: preMerge would resolve the reset away (no `$cors`), plain mode
  // serializes it with its handler. If the fallback desynced find codegen from
  // the handlers import, generated code would reference an un-imported binding —
  // so this fixture also guards the import/reference contract.
  const NON_CHAIN_CLEAN = {
    "/a/*/c": { headers: { a: "1" }, cors: false },
    "/a/b/*": { headers: { b: "2" } },
  } as const;

  it("compileHandlersImport falls back to plain handler set (imports the reset's handler)", () => {
    const rules = normalizeRouteRules(NON_CHAIN_CLEAN);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      // preMerge requested but not applicable → plain mode → `cors: false` is
      // serialized with its handler, so its import must be present.
      expect(compileHandlersImport(rules, { preMerge: true })).toBe(
        'import { cors as __ruleHandlers__$cors, headers as __ruleHandlers__$headers } from "h3/rules";',
      );
      expect(warn).toHaveBeenCalledWith(expect.stringMatching(/preMerge.*falling back/s));
    } finally {
      warn.mockRestore();
    }
  });

  it("keeps find references and handler imports in sync when falling back", () => {
    const rules = normalizeRouteRules(NON_CHAIN_CLEAN);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const code = compileFindRouteRules(rules, { preMerge: true });
      const bindings = (source: string) =>
        [...new Set([...source.matchAll(/__ruleHandlers__\$(\w+)/g)].map((m) => m[1]!))].sort();
      expect(bindings(code)).toEqual(bindings(compileHandlersImport(rules, { preMerge: true })));
      // The fallback emits the plain `$cors` handler for the reset.
      expect(bindings(code)).toContain("cors");
    } finally {
      warn.mockRestore();
    }
  });

  it("compileRouteRules warns once and emits a working plain module", () => {
    const rules = normalizeRouteRules(NON_CHAIN_CLEAN);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const mod = compileRouteRules(rules, { preMerge: true });
      // Resolved once up front, not once per sub-call.
      expect(warn).toHaveBeenCalledTimes(1);
      // Import and codegen agree: the module evaluates without a ReferenceError.
      expect(mod.code).toContain("__ruleHandlers__$cors");
      const findSrc = mod.body
        .slice(mod.body.indexOf("=") + 1)
        .trim()
        .replace(/;\s*$/, "");
      const compiled = createMatcherFromFind(evaluateFind(findSrc));
      const plain = createRouteRulesMatcher(rules);
      for (const path of ["/a/b/c", "/a/x/c", "/a/b/x"]) {
        expect(snapshotResult(compiled("GET", path))).toEqual(snapshotResult(plain("GET", path)));
      }
    } finally {
      warn.mockRestore();
    }
  });
});

describe("compile-time validation", () => {
  it("throws on function-valued options (silently dropped by JSON)", () => {
    expect(() =>
      compileFindRouteRules({
        "/api/**": { proxy: { to: "/upstream/**", onResponse: () => {} } },
      }),
    ).toThrow(/non-JSON-serializable.*onResponse/);
  });

  it("throws on class instances that JSON mangles (Date, RegExp)", () => {
    expect(() => compileFindRouteRules({ "/a": { custom: { at: new Date(0) } } })).toThrow(
      /non-JSON-serializable.*Date/,
    );
    expect(() => compileFindRouteRules({ "/a": { custom: { pattern: /x/ } } })).toThrow(
      /non-JSON-serializable.*RegExp/,
    );
  });

  it("throws on nested undefined (silently dropped by JSON)", () => {
    expect(() => compileFindRouteRules({ "/a": { custom: { a: undefined } } })).toThrow(
      /non-JSON-serializable/,
    );
  });

  it("throws on an own `__proto__` option key (object-literal proto-setter divergence)", () => {
    // `JSON.stringify` emits an own enumerable `__proto__` as a `"__proto__"`
    // member, but the compiler embeds that JSON as a JS object literal where
    // `"__proto__"` is the prototype-setter production — so the compiled options
    // object would drop the key and adopt a new prototype, diverging from the
    // runtime matcher (which carries it as plain data). Refuse it rather than
    // silently diverge. This is the sole key where JSON and JS-literal semantics
    // disagree.
    const withProto = (value: unknown): RouteRuleConfig => {
      const opts: Record<string, unknown> = { a: "1" };
      Object.defineProperty(opts, "__proto__", {
        value,
        enumerable: true,
        writable: true,
        configurable: true,
      });
      return { custom: opts } as RouteRuleConfig;
    };
    expect(() => compileFindRouteRules({ "/p": withProto("polluted") })).toThrow(/__proto__/);
    expect(() => compileFindRouteRules({ "/p": withProto({ injected: true }) })).toThrow(
      /__proto__/,
    );
    // Nested inside a plain object, too.
    const nested: Record<string, unknown> = {};
    Object.defineProperty(nested, "__proto__", { value: 1, enumerable: true, configurable: true });
    expect(() =>
      compileFindRouteRules({ "/p": { custom: { deep: nested } } as RouteRuleConfig }),
    ).toThrow(/__proto__/);
  });

  it("accepts JSON-safe options including `false` resets and null", () => {
    expect(() =>
      compileFindRouteRules({
        "/a/**": { cache: false, custom: { n: null, deep: [{ ok: true }] } },
      }),
    ).not.toThrow();
  });

  it("throws when a handler binding is not a valid JS identifier", () => {
    // Handler references bind as `<ns>$<name>` identifiers in generated code —
    // fail at compile time, not with a parse error in the consumer's module.
    const rules: Record<string, RouteRuleConfig> = { "/a": { "my-rule": "x" } };
    const opts = { runtimeRules: { "my-rule": "h3/rules" } };
    expect(() => compileHandlersImport(rules, opts)).toThrow(/valid JS identifier/);
    expect(() => compileFindRouteRules(rules, opts)).toThrow(/valid JS identifier/);
    expect(() =>
      compileFindRouteRules({ "/a": { redirect: "/b" } }, { handlersImportName: "not valid" }),
    ).toThrow(/valid JS identifier/);
  });

  it("surfaces config-time validation (top-level arrays) at compile time", () => {
    // Auto-normalization runs `normalizeRouteRules` inside the compiler, so its
    // config validation lands in the build instead of at server boot.
    expect(() => compileFindRouteRules({ "/a/**": { custom: [1, 2, 3] } })).toThrow(
      /cannot be top-level arrays/,
    );
  });
});

describe("input normalization", () => {
  // The compiler entrypoints normalize their input themselves (build-time, so
  // the pass is free) — authored config with shortcuts must compile exactly
  // like its normalized form, and already-normalized input must pass through
  // unchanged (normalizeRouteRules is idempotent, pinned in normalize.test.ts).
  const config: Record<string, RouteRuleConfig> = {
    "/api/**": { swr: 60, cors: true },
    "/old/**": { redirect: "/new/**" },
  };

  it("expands authored shortcuts (swr/string redirect) and normalizes cors before compiling", () => {
    // Pre-auto-normalization, raw config here silently mis-compiled: `swr`
    // is not a runtime rule name, so no cache handler was imported and the
    // rule became data-only. `cors` is now a first-class rule (its handler is
    // imported), not a shortcut expanded into static `headers`.
    expect(compileHandlersImport(config)).toBe(
      'import { cors as __ruleHandlers__$cors, redirect as __ruleHandlers__$redirect } from "h3/rules";\n' +
        'import { cache as __ruleHandlers__$cache } from "h3/rules/cache";',
    );
    const code = compileFindRouteRules(config);
    expect(code).toContain('name:"cache"');
    expect(code).toContain('name:"cors"');
    expect(code).not.toContain('name:"swr"');
    const matcher = createMatcherFromFind(evaluateFind(code));
    expect(matcher("GET", "/old/x").routeRules.redirect).toEqual({
      to: "/new/**",
      status: 307,
      base: "/old",
    });
  });

  it("compiles authored and pre-normalized input to identical output", () => {
    expect(compileRouteRules(normalizeRouteRules(config)).code).toBe(
      compileRouteRules(config).code,
    );
  });
});
