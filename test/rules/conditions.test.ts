import { H3 } from "../../src/index.ts";
import type { EventHandler } from "../../src/index.ts";
import { describe, expect, it, vi } from "vitest";
import { routeRules } from "../../src/rules/middleware.ts";
import type { RouteRulesOptions } from "../../src/rules/middleware.ts";
import { createConditionResolver } from "../../src/rules/conditions.ts";
import { createMatcherFromFind, createRouteRulesMatcher } from "../../src/rules/match.ts";
import type { FindRouteRules } from "../../src/rules/match.ts";
import { normalizeRouteRules } from "../../src/rules/normalize.ts";
import { parseRouteKey } from "../../src/rules/internal/key.ts";
import { compileFindRouteRules, compileRouteRules } from "../../src/rules/compiler.ts";
import type { CompiledRouteRules } from "../../src/rules/compiler.ts";
import type { ConditionResolver } from "../../src/rules/conditions.ts";
import type { RouteRulesMatcher } from "../../src/rules/match.ts";
import { createCacheRuleHandler } from "../../src/rules/handlers/cache.ts";
import { ruleHandlers } from "../../src/rules/handlers/index.ts";
import type {
  CacheRuleOptions,
  RouteRuleConfig,
  RouteRuleCondition,
} from "../../src/rules/types.ts";

// Ad-hoc data-only rule names, typed loosely instead of augmenting `RouteRuleConfig`.
type Config = Record<string, Record<string, unknown>>;
const asRules = (config: Config) => config as Record<string, RouteRuleConfig>;

const MD: RouteRuleCondition = { headers: { accept: /\btext\/markdown\b/ } };
const MARKDOWN = { accept: "text/markdown" };

function createApp(config: Config, opts?: RouteRulesOptions): H3 {
  const app = new H3();
  app.use(routeRules(asRules(config), { conditions: { MD }, ...opts }));
  app.all("/**", (event) => ({ rules: event.context.routeRules }));
  return app;
}

function fetchRules(
  app: H3,
  path: string,
  init?: RequestInit,
): Promise<Record<string, unknown> | undefined> {
  return Promise.resolve(app.fetch(new Request(`http://test${path}`, init)))
    .then((res) => res.json())
    .then((body: { rules?: Record<string, unknown> }) => body.rules);
}

describe("route rule conditions", () => {
  describe("key parsing", () => {
    it("parses `METHOD:CONDITION /path` keys", () => {
      expect(parseRouteKey("GET:MD /blog/**")).toEqual({
        method: "GET",
        condition: "MD",
        path: "/blog/**",
      });
      expect(parseRouteKey("GET /blog/**")).toEqual({ method: "GET", path: "/blog/**" });
    });

    it("canonicalizes the method and keeps the condition as authored", () => {
      const rules = normalizeRouteRules({ "get:md /blog/**": { headers: { a: "1" } } });
      expect(Object.keys(rules)).toEqual(["GET:md /blog/**"]);
    });

    it("rejects a typo'd method carrying a condition", () => {
      expect(() => normalizeRouteRules({ "GTE:MD /admin/**": {} })).toThrow(
        /not a recognized HTTP method/,
      );
    });

    it("rejects a malformed condition instead of reading a literal path", () => {
      for (const key of ["GET: /x", "GET:M.D /x", "GET:MD:X /x", "GET:MD/x", "get:MD/blog/**"]) {
        expect(() => normalizeRouteRules({ [key]: {} }), key).toThrow(/invalid condition/);
      }
      // A literal path whose first segment merely contains a colon stays valid.
      expect(Object.keys(normalizeRouteRules({ "api:v1/x": {} }))).toEqual(["/api:v1/x"]);
    });
  });

  describe("routeRules() middleware", () => {
    it("applies condition-scoped rules only to requests satisfying the condition", async () => {
      const app = createApp({ "GET:MD /blog/**": { headers: { "x-md": "1" } } });
      const md = await app.fetch(new Request("http://test/blog/post", { headers: MARKDOWN }));
      expect(md.headers.get("x-md")).toBe("1");
      const html = await app.fetch(new Request("http://test/blog/post"));
      expect(html.headers.get("x-md")).toBeNull();
    });

    it("keeps plain method and agnostic rules for variant requests", async () => {
      const app = createApp({
        "/**": { site: true },
        "GET /blog/**": { gate: "get" },
        "GET /blog/private/**": { gate: "private" },
        "GET:MD /docs/**": { md: true },
      });
      // `/blog/**` has no GET:MD rule of its own, but a variant lookup must
      // still see its GET rules (never fall back to the agnostic ones alone).
      expect(await fetchRules(app, "/blog/x", { headers: MARKDOWN })).toEqual({
        site: true,
        gate: "get",
      });
      expect(await fetchRules(app, "/blog/private/x", { headers: MARKDOWN })).toEqual({
        site: true,
        gate: "private",
      });
      expect(await fetchRules(app, "/docs/x", { headers: MARKDOWN })).toEqual({
        site: true,
        md: true,
      });
    });

    it("merges variant rules over the base method on the same pattern", async () => {
      const app = createApp({
        "/blog/**": { headers: { "x-a": "all" } },
        "GET /blog/**": { headers: { "x-b": "get" }, mode: "html" },
        "GET:MD /blog/**": { headers: { "x-b": "md" }, mode: "md" },
      });
      expect(await fetchRules(app, "/blog/x", { headers: MARKDOWN })).toEqual({
        headers: { "x-a": "all", "x-b": "md" },
        mode: "md",
      });
      expect(await fetchRules(app, "/blog/x")).toEqual({
        headers: { "x-a": "all", "x-b": "get" },
        mode: "html",
      });
    });

    it("lets a more specific plain pattern override a broader variant", async () => {
      const app = createApp({
        "GET:MD /blog/**": { mode: "md" },
        "GET /blog/raw/**": { mode: "raw" },
        "/blog/off/**": { mode: false },
      });
      expect(await fetchRules(app, "/blog/raw/x", { headers: MARKDOWN })).toEqual({ mode: "raw" });
      expect(await fetchRules(app, "/blog/off/x", { headers: MARKDOWN })).toEqual({});
    });

    it("applies GET variants to HEAD, with explicit HEAD variants overriding", async () => {
      const app = createApp({
        "GET:MD /a/**": { headers: { "x-md": "get" } },
        "HEAD:MD /b/**": { headers: { "x-md": "head" } },
        "GET:MD /b/**": { headers: { "x-md": "get" } },
      });
      const head = (path: string) =>
        app.fetch(new Request(`http://test${path}`, { method: "HEAD", headers: MARKDOWN }));
      expect((await head("/a/x")).headers.get("x-md")).toBe("get");
      expect((await head("/b/x")).headers.get("x-md")).toBe("head");
    });

    it("ignores conditions for methods no variant rule is scoped to", async () => {
      const app = createApp({
        "POST /blog/**": { gate: "post" },
        "GET:MD /blog/**": { md: true },
      });
      expect(await fetchRules(app, "/blog/x", { method: "POST", headers: MARKDOWN })).toEqual({
        gate: "post",
      });
    });

    it("keeps agnostic rules on a node shared with a variant-only pattern", async () => {
      const app = createApp({
        "/users/*": { gate: "all" },
        "GET:MD /users/:id": { md: true },
      });
      expect(await fetchRules(app, "/users/1", { headers: MARKDOWN })).toEqual({
        gate: "all",
        md: true,
      });
    });

    it("redirects Markdown requests to the `.md` path (docs example)", async () => {
      const app = createApp({
        "GET:MD /blog/**": { redirect: "/blog/**.md" },
        "GET:MD /blog/*.md": { redirect: false },
      });
      const get = (path: string, headers?: Record<string, string>) =>
        app.fetch(new Request(`http://test${path}`, { headers }));
      const md = await get("/blog/hello", MARKDOWN);
      expect(md.status).toBe(307);
      expect(md.headers.get("location")).toBe("/blog/hello.md");
      expect((await get("/blog/hello.md", MARKDOWN)).status).toBe(200);
      expect((await get("/blog/hello")).status).toBe(200);
    });

    it("applies every satisfied condition, merging same-pattern rules in name order", async () => {
      const config = {
        "GET:MD /x": { md: true, variant: "md" },
        "GET:JSON /x": { json: true, variant: "json" },
      };
      const JSON_COND: RouteRuleCondition = { headers: { "x-json": true } };
      const both = { accept: "text/markdown", "x-json": "1" };
      for (const conditions of [
        { MD, JSON: JSON_COND },
        { JSON: JSON_COND, MD },
      ]) {
        const app = createApp(config, { conditions });
        // `JSON` < `MD`: MD merges last regardless of declaration order.
        expect(await fetchRules(app, "/x", { headers: both })).toEqual({
          md: true,
          json: true,
          variant: "md",
        });
        expect(await fetchRules(app, "/x", { headers: MARKDOWN })).toEqual({
          md: true,
          variant: "md",
        });
        expect(await fetchRules(app, "/x", { headers: { "x-json": "1" } })).toEqual({
          json: true,
          variant: "json",
        });
      }
    });

    it("never lets one satisfied condition hide another condition's gate", async () => {
      const config = {
        "GET:MD /blog/**": { md: true },
        "GET:ANON /api/**": { loginGate: true },
      };
      const conditions = { MD, ANON: { headers: { authorization: false } } };
      for (const preMerge of [false, true]) {
        const app = createApp(config, { conditions, preMerge });
        expect(await fetchRules(app, "/api/x")).toEqual({ loginGate: true });
        expect(await fetchRules(app, "/api/x", { headers: MARKDOWN })).toEqual({
          loginGate: true,
        });
        expect(
          await fetchRules(app, "/api/x", { headers: { ...MARKDOWN, authorization: "x" } }),
        ).toEqual({});
      }
    });

    it("keeps agnostic gates on a shared node with preMerge", async () => {
      // `/a/*` also matches `/a` through the node it shares with `/a/:id`; the
      // `GET:MD` registration there must not hide its agnostic chain.
      const config = { "/a/*": { gate: true }, "GET:MD /a/:id": { md: true } };
      for (const preMerge of [false, true]) {
        const app = createApp(config, { preMerge });
        for (const path of ["/a", "/a/"]) {
          expect(await fetchRules(app, path, { headers: MARKDOWN }), `${preMerge} ${path}`).toEqual(
            await fetchRules(app, path),
          );
        }
      }
    });

    it("memoizes plain and variant matches separately", async () => {
      const app = createApp({ "GET:MD /blog/**": { md: true } });
      for (let i = 0; i < 2; i++) {
        expect(await fetchRules(app, "/blog/x", { headers: MARKDOWN })).toEqual({ md: true });
        expect(await fetchRules(app, "/blog/x")).toEqual({});
      }
    });

    it("resolves identically with preMerge", async () => {
      const config: Config = {
        "/blog/**": { a: 1 },
        "GET /blog/**": { b: 1 },
        "GET:MD /blog/**": { c: 1 },
        "GET /blog/x/**": { b: 2 },
      };
      const plain = createApp(config);
      const merged = createApp(config, { preMerge: true });
      for (const path of ["/blog/y", "/blog/x/y"]) {
        for (const init of [{}, { headers: MARKDOWN }]) {
          expect(await fetchRules(merged, path, init)).toEqual(await fetchRules(plain, path, init));
        }
      }
    });

    it("throws for a rule using an undefined condition", () => {
      expect(() => routeRules(asRules({ "GET:MDX /x": { a: 1 } }), { conditions: { MD } })).toThrow(
        /`MDX` condition, which is not defined/,
      );
      expect(() => routeRules(asRules({ "GET:MD /x": { a: 1 } }))).toThrow(/not defined/);
    });

    it("rejects a condition without header checks", () => {
      expect(() =>
        routeRules(asRules({ "GET:ANY /x": { a: 1 } }), { conditions: { ANY: { headers: {} } } }),
      ).toThrow(/no header checks/);
    });

    it("validates condition header names and values at startup", () => {
      const rules = asRules({ "GET:X /x": { a: 1 } });
      const make = (headers: Record<string, unknown>) => () =>
        routeRules(rules, { conditions: { X: { headers } as RouteRuleCondition } });
      expect(make({ "bad name": true })).toThrow(/invalid header name/);
      expect(make({ accept: 1 })).toThrow(/must be a string, RegExp, or boolean/);
    });

    it("caps the conditions scoped to one method", () => {
      const names = ["A", "B", "C", "D", "E", "F", "G"];
      const config = Object.fromEntries(names.map((name) => [`GET:${name} /x`, { a: 1 }]));
      const conditions = Object.fromEntries(
        names.map((name) => [name, { headers: { [name]: true } }]),
      );
      expect(() => routeRules(asRules(config), { conditions })).toThrow(/at most 6/);
      expect(() => routeRules(asRules(config), { conditions, preMerge: true })).toThrow(
        /at most 6/,
      );
    });
  });

  describe("header predicates", () => {
    const resolve = (condition: RouteRuleCondition, headers: Record<string, string>) => {
      const resolver = createConditionResolver({ "GET:M /x": {} }, { M: condition })!;
      const event = { req: new Request("http://test/x", { headers }) } as never;
      return resolver(event, "GET");
    };

    it("supports presence, absence, exact and RegExp conditions", () => {
      expect(resolve({ headers: { "x-a": true } }, { "x-a": "" })).toBe("GET:M");
      expect(resolve({ headers: { "x-a": true } }, {})).toBe("GET");
      expect(resolve({ headers: { "x-a": false } }, {})).toBe("GET:M");
      expect(resolve({ headers: { "x-a": false } }, { "x-a": "1" })).toBe("GET");
      expect(resolve({ headers: { "X-A": "1" } }, { "x-a": "1" })).toBe("GET:M");
      expect(resolve({ headers: { "x-a": "1" } }, { "x-a": "12" })).toBe("GET");
      expect(resolve({ headers: { "x-a": /^1/ } }, { "x-a": "12" })).toBe("GET:M");
      expect(resolve({ headers: { "x-a": /^1/ } }, {})).toBe("GET");
    });

    it("requires every header condition", () => {
      const condition = { headers: { "x-a": "1", "x-b": true } };
      expect(resolve(condition, { "x-a": "1" })).toBe("GET");
      expect(resolve(condition, { "x-a": "1", "x-b": "" })).toBe("GET:M");
    });

    it("is stable across calls with a global RegExp", () => {
      const condition = { headers: { accept: /markdown/g } };
      for (let i = 0; i < 3; i++) {
        expect(resolve(condition, MARKDOWN)).toBe("GET:M");
      }
    });

    it("returns no resolver when no rule uses a condition", () => {
      expect(createConditionResolver({ "GET /x": {}, "/y": {} }, { MD })).toBeUndefined();
    });
  });

  describe("matchers", () => {
    it("tags matched rules with the variant they were resolved under", () => {
      const match = createRouteRulesMatcher(
        normalizeRouteRules(asRules({ "GET /blog/**": { a: 1 }, "GET:MD /blog/**": { b: 1 } })),
      );
      const md = match("GET:MD", "/blog/x").matchedRules as Record<string, { condition?: string }>;
      expect(md.a!.condition).toBe("MD");
      expect(md.b!.condition).toBe("MD");
      const plain = match("GET", "/blog/x").matchedRules as Record<string, { condition?: string }>;
      expect(plain.a!.condition).toBeUndefined();
    });

    it("compiles to the same resolution as the runtime matcher", () => {
      const config: Config = {
        "/**": { a: 1 },
        "GET /blog/**": { b: 1 },
        "GET:MD /blog/**": { c: 1 },
        "GET:MD /docs/:slug": { d: 1 },
      };
      const runtime = createRouteRulesMatcher(normalizeRouteRules(asRules(config)));
      for (const preMerge of [false, true]) {
        const find = new Function(
          `return (${compileFindRouteRules(asRules(config), { preMerge })});`,
        )() as FindRouteRules;
        const compiled = createMatcherFromFind(find);
        for (const method of ["GET", "GET:MD", "HEAD:MD", "POST"]) {
          for (const path of ["/blog/x", "/docs/y", "/z"]) {
            expect(compiled(method, path).routeRules).toEqual(runtime(method, path).routeRules);
          }
        }
      }
    });
  });

  describe("compiler", () => {
    // Evaluate a data-only compiled module, binding its `h3/rules` imports.
    function evaluate(mod: CompiledRouteRules): {
      matcher: RouteRulesMatcher;
      resolve: ConditionResolver | undefined;
    } {
      const body = mod.body.replace(/\bexport const /g, "const ");
      // eslint-disable-next-line no-new-func
      return new Function(
        "createMatcherFromFind",
        "createConditionResolver",
        `${body}\nreturn { matcher, resolve: resolveRouteRulesMethod };`,
      )(createMatcherFromFind, createConditionResolver);
    }

    const config: Config = {
      "/**": { site: true },
      "GET /blog/**": { gate: "get" },
      "GET:MD /blog/**": { md: true },
      "get:MD /docs/**": { md: "docs" },
      "GET:ANON /api/**": { loginGate: true },
      "POST:ANON /api/**": { loginGate: "post" },
    };
    const conditions = { MD, ANON: { headers: { authorization: false } } };

    it("exports a resolver that matches the runtime middleware", async () => {
      const runtime = createApp(config, { conditions });
      for (const preMerge of [false, true]) {
        const { matcher, resolve } = evaluate(
          compileRouteRules(asRules(config), { matcher: true, conditions, preMerge }),
        );
        for (const method of ["GET", "HEAD", "POST"]) {
          for (const headers of [{}, MARKDOWN, { ...MARKDOWN, authorization: "x" }]) {
            for (const path of ["/blog/x", "/docs/x", "/api/x", "/z"]) {
              const event = { req: new Request(`http://test${path}`, { method, headers }) };
              const compiled = matcher(resolve!(event as never, method), path).routeRules;
              if (method !== "HEAD") {
                expect(compiled, `${preMerge} ${method} ${path}`).toEqual(
                  await fetchRules(runtime, path, { method, headers }),
                );
              }
              expect(compiled).toEqual(
                createRouteRulesMatcher(normalizeRouteRules(asRules(config)))(
                  createConditionResolver(asRules(config), conditions)!(event as never, method),
                  path,
                ).routeRules,
              );
            }
          }
        }
      }
    });

    it("emits one key per method and condition and only the used conditions", () => {
      const mod = compileRouteRules(asRules(config), {
        conditions: { ...conditions, UNUSED: { headers: { "x-unused": true } } },
      });
      expect(mod.imports).toContain('import { createConditionResolver } from "h3/rules";');
      expect(mod.body).toContain(
        'export const resolveRouteRulesMethod = /* @__PURE__ */ createConditionResolver(["GET:MD /blog/**","GET:ANON /api/**","POST:ANON /api/**"], {["ANON"]:{headers:{["authorization"]:false}},["MD"]:{headers:{["accept"]:/\\btext\\/markdown\\b/}}});',
      );
      expect(mod.body).not.toContain("UNUSED");
    });

    it("leaves output unchanged for rule sets without conditions", () => {
      const plain = { "/a": { headers: { a: "1" } } };
      expect(compileRouteRules(plain).code).not.toContain("resolveRouteRulesMethod");
      expect(compileRouteRules(plain, { conditions: { MD } }).body).toContain(
        "export const resolveRouteRulesMethod = undefined;",
      );
      expect(compileRouteRules(plain, { conditions: { MD } }).imports).toBe(
        compileRouteRules(plain).imports,
      );
    });

    it("throws when rules use conditions that are not passed or defined", () => {
      expect(() => compileRouteRules(asRules(config))).toThrow(/no `conditions` option/);
      expect(() => compileRouteRules(asRules(config), { conditions: { MD } })).toThrow(
        /`ANON` condition, which is not defined/,
      );
      expect(() =>
        compileRouteRules(asRules({ "GET:X /x": {} }), {
          conditions: { X: { headers: { accept: 1 as never } } },
        }),
      ).toThrow(/must be a string, RegExp, or boolean/);
    });

    it("round-trips RegExp flags, slashes, and `__proto__` names", () => {
      // Computed keys: a literal `__proto__:` would set the prototype instead.
      const tricky: Record<string, RouteRuleCondition> = {
        ["__proto__"]: { headers: { ["__proto__"]: "a", "x-path": /^\/a\/b$/giu } },
      };
      expect(Object.keys(tricky)).toEqual(["__proto__"]);
      const { resolve } = evaluate(
        compileRouteRules(asRules({ "GET:__proto__ /x": {} }), {
          matcher: true,
          conditions: tricky,
        }),
      );
      const event = (headers: [string, string][]) =>
        ({ req: new Request("http://test/x", { headers }) }) as never;
      expect(
        resolve!(
          event([
            ["__proto__", "a"],
            ["x-path", "/A/B"],
          ]),
          "GET",
        ),
      ).toBe("GET:__proto__");
      expect(resolve!(event([["x-path", "/A/B"]]), "GET")).toBe("GET");
      expect(
        resolve!(
          event([
            ["__proto__", "a"],
            ["x-path", "/a/c"],
          ]),
          "GET",
        ),
      ).toBe("GET");
    });
  });

  it("keeps cache entries of a variant apart from the plain request", async () => {
    const defineCachedHandler = vi.fn(
      (handler: EventHandler, _opts: CacheRuleOptions): EventHandler => handler,
    );
    const app = new H3();
    app.use(
      routeRules(
        asRules({ "GET /blog/**": { cache: { maxAge: 60 } }, "GET:MD /blog/**": { md: true } }),
        {
          conditions: { MD },
          handlers: { ...ruleHandlers, cache: createCacheRuleHandler({ defineCachedHandler }) },
        },
      ),
    );
    app.get("/blog/:slug", () => "ok");
    await app.fetch(new Request("http://test/blog/x"));
    await app.fetch(new Request("http://test/blog/x", { headers: MARKDOWN }));
    const names = defineCachedHandler.mock.calls.map((call) => call[1].name);
    expect(names).toHaveLength(2);
    expect(names[0]).not.toBe(names[1]);
    expect(names[1]).toMatch(/GET:MD:/);
  });
});
