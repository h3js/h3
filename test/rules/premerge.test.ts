import { compareRoutes } from "rou3";
import { describe, expect, it, vi } from "vitest";
import { compileFindRouteRules } from "../../src/rules/compiler.ts";
import {
  createMatcherFromFind,
  createRouteRulesMatcher,
  memoizeRouteRulesMatcher,
} from "../../src/rules/match.ts";
import type { FindRouteRules } from "../../src/rules/match.ts";
import { normalizeRouteRules } from "../../src/rules/normalize.ts";
import { ruleHandlers } from "../../src/rules/handlers/index.ts";
import { FIXTURE, FIXTURE_HANDLERS, PROBES, snapshotResult } from "./_fixture.ts";

describe("preMerge parity (runtime)", () => {
  const plain = createRouteRulesMatcher(normalizeRouteRules(FIXTURE), {
    handlers: FIXTURE_HANDLERS,
  });
  const preMerged = createRouteRulesMatcher(normalizeRouteRules(FIXTURE), {
    preMerge: true,
    handlers: FIXTURE_HANDLERS,
  });

  it.each(PROBES)("preMerged === plain for %s %s", (method, pathname) => {
    expect(snapshotResult(preMerged(method, pathname))).toEqual(
      snapshotResult(plain(method, pathname)),
    );
  });
});

describe("preMerge parity (compiled)", () => {
  const plain = createRouteRulesMatcher(normalizeRouteRules(FIXTURE), {
    handlers: FIXTURE_HANDLERS,
  });
  const code = compileFindRouteRules(normalizeRouteRules(FIXTURE), { preMerge: true });
  // Bind every fixture handler as its `<ns>$<name>` local (superset of what
  // the generated code references — unused params are harmless).
  // eslint-disable-next-line no-new-func
  const find = new Function(
    ...Object.keys(FIXTURE_HANDLERS).map((name) => `__ruleHandlers__$${name}`),
    `return (${code});`,
  )(...Object.values(FIXTURE_HANDLERS)) as FindRouteRules;
  const compiled = createMatcherFromFind(find);

  it.each(PROBES)("compiled preMerged === plain for %s %s", (method, pathname) => {
    expect(snapshotResult(compiled(method, pathname))).toEqual(
      snapshotResult(plain(method, pathname)),
    );
  });
});

describe("preMerge parity (composed with memoize)", () => {
  const plain = createRouteRulesMatcher(normalizeRouteRules(FIXTURE), {
    handlers: FIXTURE_HANDLERS,
  });
  const combined = memoizeRouteRulesMatcher(
    createRouteRulesMatcher(normalizeRouteRules(FIXTURE), {
      preMerge: true,
      handlers: FIXTURE_HANDLERS,
    }),
  );

  it.each(PROBES)("preMerged+memoized === plain for %s %s", (method, pathname) => {
    // Resolve twice: the first call populates the memo, the second must serve
    // the identical result from it.
    const first = combined(method, pathname);
    expect(snapshotResult(first)).toEqual(snapshotResult(plain(method, pathname)));
    expect(combined(method, pathname)).toBe(first);
  });
});

describe("preMerge method matrix", () => {
  it("a method-scoped broad rule reaches narrower agnostic patterns", () => {
    // Without matrix materialization, take-last at `/api/deep/**` (agnostic
    // chain only) would silently drop the GET-scoped headers.
    const matcher = createRouteRulesMatcher(
      normalizeRouteRules({
        "GET /api/**": { headers: { "x-get": "1" } },
        "/api/deep/**": { swr: 60 },
      }),
      { preMerge: true, handlers: FIXTURE_HANDLERS },
    );
    const get = matcher("GET", "/api/deep/x");
    expect(get.routeRules.headers!.options).toEqual({ "x-get": "1" });
    expect(get.routeRules.cache!.options).toEqual({ swr: true, maxAge: 60 });
    const post = matcher("POST", "/api/deep/x");
    expect(post.routeRules.headers).toBeUndefined();
    expect(post.routeRules.cache!.options).toEqual({ swr: true, maxAge: 60 });
  });
});

describe("preMerge soundness checks", () => {
  it("throws on partially overlapping patterns", () => {
    expect(() =>
      createRouteRulesMatcher(
        normalizeRouteRules({
          "/a/*/c": { headers: { a: "1" } },
          "/a/b/*": { headers: { b: "2" } },
        }),
        { preMerge: true },
      ),
    ).toThrow(/partially overlap/);
  });

  it("throws on equivalent patterns", () => {
    expect(() =>
      createRouteRulesMatcher(
        normalizeRouteRules({
          "/a/:x": { headers: { a: "1" } },
          "/a/:y": { headers: { b: "2" } },
        }),
        { preMerge: true },
      ),
    ).toThrow(/match the same paths/);
  });

  it("supports regex params where containment is provable", () => {
    const matcher = createRouteRulesMatcher(
      normalizeRouteRules({
        "/a/**": { headers: { a: "broad" } },
        "/a/:id(\\d+)": { headers: { a: "narrow" } },
      }),
      { preMerge: true },
    );
    expect(matcher("GET", "/a/42").routeRules.headers!.options).toEqual({ a: "narrow" });
    expect(matcher("GET", "/a/x").routeRules.headers!.options).toEqual({ a: "broad" });
  });

  it("compileFindRouteRules is fail-safe on unordered overlaps (warns + falls back)", () => {
    // The compiler shares createRulesRouter → preMergeRuleLayers with the
    // runtime constructor, but — unlike the runtime, which throws — it is
    // fail-safe: a non-chain-clean rule set warns and compiles plain instead of
    // failing the build.
    const rules = normalizeRouteRules({
      "/a/*/c": { headers: { a: "1" } },
      "/a/b/*": { headers: { b: "2" } },
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const code = compileFindRouteRules(rules, { preMerge: true });
      expect(warn).toHaveBeenCalledWith(expect.stringMatching(/preMerge.*falling back/s));
      // The generated find is the plain (un-pre-merged) matcher, matching the
      // plain runtime matcher over the overlapping region.
      // eslint-disable-next-line no-new-func
      const find = new Function(
        ...Object.keys(ruleHandlers).map((name) => `__ruleHandlers__$${name}`),
        `return (${code});`,
      )(...Object.values(ruleHandlers)) as FindRouteRules;
      const compiled = createMatcherFromFind(find);
      const plain = createRouteRulesMatcher(rules);
      for (const path of ["/a/b/c", "/a/x/c", "/a/b/x"]) {
        expect(snapshotResult(compiled("GET", path))).toEqual(snapshotResult(plain("GET", path)));
      }
    } finally {
      warn.mockRestore();
    }
  });

  it("throws on regex pairs whose containment is undecidable", () => {
    // rou3 compareRoutes over-approximates two dynamic regex-constrained
    // segments to "partial" — preMerge must refuse rather than guess.
    expect(() =>
      createRouteRulesMatcher(
        normalizeRouteRules({
          "/a/:id(\\d+)": { headers: { a: "1" } },
          "/a/:id([0-9]+)": { headers: { b: "2" } },
        }),
        { preMerge: true },
      ),
    ).toThrow(/partially overlap/);
  });

  it("non-overlapping patterns are fine", () => {
    const matcher = createRouteRulesMatcher(
      normalizeRouteRules({
        "/a/**": { headers: { a: "1" } },
        "/b/**": { headers: { b: "2" } },
      }),
      { preMerge: true },
    );
    expect(matcher("GET", "/a/x").routeRules.headers!.options).toEqual({ a: "1" });
    expect(matcher("GET", "/b/x").routeRules.headers!.options).toEqual({ b: "2" });
    expect(matcher("GET", "/c/x").routeRules).toEqual({});
  });
});

// Containment semantics are owned by rou3 (`compareRoutes`); these pin the
// verdicts preMerge relies on against the pinned rou3 version.
describe("compareRoutes verdicts preMerge relies on", () => {
  const sub = (b: string, n: string) => compareRoutes(b, n) === "superset";

  it("wildcards subsume deeper patterns", () => {
    expect(sub("/**", "/a/b/c")).toBe(true);
    expect(sub("/a/**", "/a/b/**")).toBe(true);
    expect(sub("/a/**", "/a/:x")).toBe(true);
    expect(sub("/a/**", "/a/*")).toBe(true);
    expect(sub("/a/**", "/a")).toBe(true);
    expect(sub("/a/b/**", "/a/**")).toBe(false);
  });

  it("params subsume statics, not vice versa", () => {
    expect(sub("/a/:x", "/a/b")).toBe(true);
    expect(sub("/a/b", "/a/:x")).toBe(false);
    expect(sub("/a/:x", "/b/:x")).toBe(false);
  });

  it("optional star spans two depths", () => {
    expect(sub("/a/*", "/a/:x")).toBe(true);
    expect(sub("/a/:x", "/a/*")).toBe(false); // `*` also matches `/a`
    expect(sub("/a/*", "/a")).toBe(true);
  });

  it("named wildcard requires a tail segment", () => {
    expect(sub("/a/**:rest", "/a")).toBe(false);
    expect(sub("/a/**:rest", "/a/b/c")).toBe(true);
    expect(sub("/a/**", "/a/**:rest")).toBe(true);
    expect(sub("/a/**:rest", "/a/**")).toBe(false); // plain `**` also matches `/a`
  });

  it("partial overlaps are not subsumption", () => {
    expect(compareRoutes("/a/*/c", "/a/b/*")).toBe("partial");
  });

  it("regex containment over a literal is proven", () => {
    expect(compareRoutes("/a/:id(\\d+)", "/a/42")).toBe("superset");
    expect(compareRoutes("/a/**", "/a/:id(\\d+)")).toBe("superset");
  });
});
