import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import type { Plugin } from "esbuild";
import { describe, expect, it } from "vitest";
import { compileRouteRules } from "../../src/rules/compiler.ts";

// Pins that the `h3/rules` export surface stays tree-shakeable — both via named
// imports and via namespace member access (`import * as rules from "h3/rules";
// rules.xyz`) — so consumers only pay for what they use: no module-level side
// effects in runtime code, module-scope instantiations `/* @__PURE__ */`, and
// compiled codegen importing exactly the used handlers. Verified by bundling
// real entries with esbuild and asserting which inputs contribute bytes.
//
// Ported from the standalone `h3-rules` package, where `h3` itself was an
// external, side-effect-free peer so every assertion could be phrased against
// this package's own modules. Now that rules ship *inside* h3, that boundary is
// gone: `src/rules/**` imports h3 core relatively, so core modules are real
// inputs of these bundles. Two consequences, both handled below rather than
// weakened:
//   - The `ufo` absence assertions became absence assertions on
//     `src/rules/handlers/_utils.ts` — the (only) module that imported ufo, and
//     the one that pulls in the target-resolution/scope machinery. Same intent:
//     an unused handler contributes neither itself nor its dependencies.
//   - Absence of h3's own `proxyRequest` is now checkable directly
//     (`src/utils/proxy.ts`), which the external peer previously hid.
//   - `rou3` can no longer be asserted *absent*: h3 core re-exports rou3's
//     `NullProtoObj` as `EmptyObject` (~100 B), so any bundle touching
//     `src/middleware.ts` carries that sliver. The assertions became a byte
//     budget instead, which pins the same thing they always pinned — the
//     ~8 KB rou3 *router* (`createRouter`/`addRoute`/`findAllRoutes`) staying
//     out of matcher-free and compiled bundles.
// The byte thresholds carried over unchanged and still have plenty of margin
// (183 B / 543 B against 1 KB / 2 KB): what they pin is a handful of handler
// declarations, and pulling in any h3 core module of substance blows past them.

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const SRC = join(ROOT, "src");
const RULES = join(SRC, "rules");

// Marks every in-repo source module as `sideEffects: true`, neutralizing the
// package-level `"sideEffects": false` shortcut (which lets bundlers drop whole
// unused modules regardless of their contents). Under this plugin, shaking must
// rest on genuinely side-effect-free module scopes and `/* @__PURE__ */`
// annotations alone — so a stray module-level side effect or a dropped PURE
// annotation fails the suite instead of being masked by the package hint.
const forceSideEffects: Plugin = {
  name: "force-side-effects",
  setup(build) {
    build.onResolve({ filter: /^h3\/rules$/ }, () => ({
      path: join(RULES, "index.ts"),
      sideEffects: true,
    }));
    build.onResolve({ filter: /^h3\/rules\/cache$/ }, () => ({
      path: join(RULES, "cache.ts"),
      sideEffects: true,
    }));
    build.onResolve({ filter: /^h3\/rules\/proxy$/ }, () => ({
      path: join(RULES, "proxy.ts"),
      sideEffects: true,
    }));
    // In-repo imports are always relative and carry explicit `.ts` extensions.
    build.onResolve({ filter: /^\.\.?\// }, (args) =>
      args.importer.startsWith(SRC)
        ? { path: join(dirname(args.importer), args.path), sideEffects: true }
        : null,
    );
  },
};

async function bundle(
  contents: string,
  opts?: { forceSideEffects?: boolean },
): Promise<{
  bytes: number;
  code: string;
  inputs: string[];
  has: (m: string) => boolean;
  bytesOf: (m: string) => number;
}> {
  const result = await build({
    stdin: { contents, resolveDir: ROOT, loader: "js" },
    bundle: true,
    format: "esm",
    platform: "neutral",
    minify: true,
    write: false,
    metafile: true,
    alias: {
      "h3/rules": join(RULES, "index.ts"),
      "h3/rules/cache": join(RULES, "cache.ts"),
      "h3/rules/proxy": join(RULES, "proxy.ts"),
    },
    plugins: opts?.forceSideEffects ? [forceSideEffects] : [],
    logLevel: "silent",
  });
  const output = Object.values(result.metafile.outputs)[0]!;
  const entries = Object.entries(output.inputs).filter(([, input]) => input.bytesInOutput > 0);
  const contributing = entries.map(([file]) => file).sort();
  return {
    bytes: result.outputFiles[0]!.contents.byteLength,
    code: result.outputFiles[0]!.text,
    inputs: contributing,
    has: (marker) => contributing.some((file) => file.includes(marker)),
    bytesOf: (marker) =>
      entries
        .filter(([file]) => file.includes(marker))
        .reduce((sum, [, input]) => sum + input.bytesInOutput, 0),
  };
}

// Module markers. `src/rules/handlers/_utils.ts` stands in for the former `ufo`
// marker: it is the redirect/proxy target resolver (scope checks, URL joins),
// pulled in only by a handler that actually resolves targets.
const MATCHER = "src/rules/match.ts";
const TARGET_UTILS = "src/rules/handlers/_utils.ts";
const CACHE_RULE = "src/rules/handlers/cache.ts";
const OCACHE_ENTRY = "src/rules/cache.ts";
const PROXY_ENTRY = "src/rules/proxy.ts";
const H3_PROXY = "src/utils/proxy.ts";

// Byte budget standing in for "the rou3 router is not in this bundle": h3 core
// re-exports rou3's `NullProtoObj` as `EmptyObject`, worth ~100 B, while the
// router itself is ~8 KB (pinned by the control test below).
const ROU3_ROUTER_BUDGET = 512;

describe("tree-shaking (esbuild)", () => {
  it("namespace member access shakes everything unused", async () => {
    const out = await bundle(`import * as rules from "h3/rules";\nexport const h = rules.headers;`);
    expect(out.bytesOf("rou3")).toBeLessThan(ROU3_ROUTER_BUDGET);
    expect(out.has("ocache")).toBe(false);
    expect(out.has(TARGET_UTILS)).toBe(false);
    expect(out.has(MATCHER)).toBe(false);
    expect(out.has(CACHE_RULE)).toBe(false);
    expect(out.bytes).toBeLessThan(1024);
  });

  it("shaking holds without the package `sideEffects: false` hint", async () => {
    const out = await bundle(
      `import * as rules from "h3/rules";\nexport const h = rules.headers;`,
      { forceSideEffects: true },
    );
    expect(out.has(CACHE_RULE)).toBe(false);
    expect(out.has(MATCHER)).toBe(false);
    expect(out.has(TARGET_UTILS)).toBe(false);
    expect(out.has("ocache")).toBe(false);
    expect(out.bytesOf("rou3")).toBeLessThan(ROU3_ROUTER_BUDGET);
  });

  it("named import matches the namespace-access result", async () => {
    const ns = await bundle(`import * as rules from "h3/rules";\nexport const h = rules.headers;`);
    const named = await bundle(`import { headers } from "h3/rules";\nexport const h = headers;`);
    expect(named.inputs).toEqual(ns.inputs);
  });

  it("full runtime matcher pulls rou3 (control for the absence assertions)", async () => {
    // Positive marker control: if metafile paths ever stop matching the
    // `has()` markers, this fails instead of the absence assertions above
    // passing vacuously.
    const out = await bundle(
      `import { createRouteRulesMatcher } from "h3/rules";\nexport const m = createRouteRulesMatcher({});`,
    );
    expect(out.bytesOf("rou3")).toBeGreaterThan(4096);
    expect(out.has(MATCHER)).toBe(true);
  });

  it("compiled-matcher wrap keeps rou3 and handler deps out", async () => {
    const out = await bundle(
      `import * as rules from "h3/rules";\nexport const m = rules.createMatcherFromFind(() => []);`,
    );
    expect(out.bytesOf("rou3")).toBeLessThan(ROU3_ROUTER_BUDGET);
    expect(out.has("ocache")).toBe(false);
    expect(out.has(TARGET_UTILS)).toBe(false);
    expect(out.has(H3_PROXY)).toBe(false);
  });

  it("un-memoized createMatcherFromFind shakes out the memoize wrapper", async () => {
    // Memoization is wired in createRouteRulesMatcher, not createMatcherFromFind,
    // so an un-memoized compiled matcher must not bundle memoizeRouteRulesMatcher
    // (~240 B). `.keys().next()` is its FIFO eviction — a marker no other matcher
    // code emits — so its absence pins the wrapper out of the compiled path.
    const out = await bundle(
      `import * as rules from "h3/rules";\nexport const m = rules.createMatcherFromFind(() => []);`,
    );
    expect(out.code).not.toContain(".next(");
  });

  it("the whole h3/rules surface carries no ocache reference", async () => {
    // Retain every export — the core entry must not reference ocache at all;
    // the ocache-backed cache handler lives solely in `h3/rules/cache`.
    const out = await bundle(
      `import * as rules from "h3/rules";\nexport const all = { ...rules };`,
    );
    expect(out.has("ocache")).toBe(false);
    expect(out.has(MATCHER)).toBe(true); // control: the surface is really retained
  });

  it("h3/rules/cache pulls ocache but not the matcher or the target resolver", async () => {
    const out = await bundle(`import { cache } from "h3/rules/cache";\nexport const c = cache;`);
    expect(out.has("ocache")).toBe(true);
    expect(out.bytesOf("rou3")).toBeLessThan(ROU3_ROUTER_BUDGET);
    expect(out.has(TARGET_UTILS)).toBe(false);
    expect(out.has(H3_PROXY)).toBe(false);
    expect(out.has(MATCHER)).toBe(false);
  });

  it("the whole h3/rules surface carries no proxy handler reference", async () => {
    // Retain every export — the core entry must not reference the `proxy`
    // handler (nor h3's `proxyRequest` it imports); it lives solely in
    // `h3/rules/proxy` so a non-proxying bundle never pulls that machinery in.
    const out = await bundle(
      `import * as rules from "h3/rules";\nexport const all = { ...rules };`,
    );
    expect(out.has(PROXY_ENTRY)).toBe(false);
    expect(out.has(H3_PROXY)).toBe(false);
    expect(out.has(MATCHER)).toBe(true); // control: the surface is really retained
  });

  it("h3/rules/proxy resolves the proxy handler without the matcher or rou3", async () => {
    const out = await bundle(`import { proxy } from "h3/rules/proxy";\nexport const p = proxy;`);
    expect(out.has(PROXY_ENTRY)).toBe(true);
    expect(out.has(H3_PROXY)).toBe(true); // it is the one module that may pull it
    expect(out.bytesOf("rou3")).toBeLessThan(ROU3_ROUTER_BUDGET);
    expect(out.has("ocache")).toBe(false);
    expect(out.has(MATCHER)).toBe(false);
  });

  it("compiled codegen with a proxy rule imports the handler via h3/rules/proxy only", async () => {
    // Positive control for the subpath sourcing: the generated
    // `import { proxy … } from "h3/rules/proxy"` must resolve, while the rou3
    // router still stays out of the compiled bundle.
    const mod = compileRouteRules({ "/api/**": { proxy: "https://up.example/**" } });
    expect(mod.imports).toContain('from "h3/rules/proxy"');
    const out = await bundle(`${mod}\nexport const find = findRouteRules;`);
    expect(out.has(PROXY_ENTRY)).toBe(true);
    expect(out.bytesOf("rou3")).toBeLessThan(ROU3_ROUTER_BUDGET);
  });

  it("compiled codegen module shakes unused handler deps", async () => {
    const mod = compileRouteRules({ "/api/**": { headers: { "cache-control": "s-maxage=60" } } });
    const out = await bundle(`${mod}\nexport const find = findRouteRules;`);
    expect(out.bytesOf("rou3")).toBeLessThan(ROU3_ROUTER_BUDGET);
    expect(out.has("ocache")).toBe(false);
    expect(out.has(TARGET_UTILS)).toBe(false);
    expect(out.has(H3_PROXY)).toBe(false);
    expect(out.bytes).toBeLessThan(2048);
  });

  it("compiled codegen with a cache rule imports ocache via h3/rules/cache only", async () => {
    // Positive control for the subpath sourcing: the generated
    // `import { cache … } from "h3/rules/cache"` must resolve and carry ocache,
    // while the rou3 router still stays out of the compiled bundle.
    const mod = compileRouteRules({ "/api/**": { swr: 60 } });
    expect(mod.imports).toContain('from "h3/rules/cache"');
    const out = await bundle(`${mod}\nexport const find = findRouteRules;`);
    expect(out.has("ocache")).toBe(true);
    expect(out.has(OCACHE_ENTRY)).toBe(true);
    expect(out.bytesOf("rou3")).toBeLessThan(ROU3_ROUTER_BUDGET);
  });
});
