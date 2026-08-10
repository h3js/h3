import { describe, expect, it } from "vitest";
import { addRoute, createRouter, findRoute } from "rou3";
import { createRouteMatcher } from "../../src/utils/internal/route.ts";

// `use(route, mw)` and the router must agree on every path, or a request can
// reach a handler while skipping the guard registered for it (a middleware
// scope that under-matches is an auth bypass). The matcher's literal fast paths
// are hand-written reimplementations of rou3, so pin them to rou3 itself: for
// every pattern below, every path must produce the same verdict and the same
// params as a single-route rou3 router.
const PATTERNS = [
  "/",
  "//",
  "/api",
  "/api/",
  "/api//",
  "api",
  "/a/b/c",
  "/admin",
  "/**",
  "/**/",
  "/api/**",
  "/api/**/",
  "/a/b/**",
  "/api//**",
  "/admin/:id",
  "/:tenant/admin/**",
  "/files/**:rest",
  "/a/*",
  "/mix/*/:id",
  "/u/:id?",
  "/u/:id+",
  "/u/:id*",
  "/user/:id(\\d+)",
  "/a/{x}",
  "/a/{-:x}?",
  String.raw`/a\:b`,
  "/p/pre-*-post",
  "/x.json",
  "/%40admin/**",
  "/a/**/b",
];

const PATHS = [
  "/",
  "//",
  "///",
  "/api",
  "/api/",
  "/api//",
  "/api///",
  "/apix",
  "/api/x",
  "/api/x/",
  "/api/x//",
  "/api/x/y",
  "/api/x/y/",
  "/api/x/y//",
  "/api//x",
  "/a",
  "/a/b",
  "/a/b/",
  "/a/b/c",
  "/a/b/c/",
  "/a/b/c//",
  "/a/b/c///",
  "/admin",
  "/admin/",
  "/admin/7",
  "/admin/7/",
  "/admin/7//",
  "/admin/7///",
  "/adminx",
  "/administrator",
  "//admin/users",
  "//admin",
  "/files/a/b",
  "//files/a/b",
  "/mix/q/7",
  "/u",
  "/u/1",
  "/u/1/2",
  "/user/42",
  "/user/abc",
  "/a/x",
  "/a/x/",
  String.raw`/a\:b`,
  "/a:b",
  "/p/pre-mid-post",
  "/x.json",
  "/@admin/x",
  "/%40admin/x",
  "/a/1/b",
  "/a/1/2/b",
];

describe("createRouteMatcher", () => {
  for (const pattern of PATTERNS) {
    it(`matches exactly like rou3 for ${JSON.stringify(pattern)}`, () => {
      const router = createRouter<true>();
      addRoute(router, "", pattern, true);
      const match = createRouteMatcher(pattern);

      for (const path of PATHS) {
        const expected = findRoute(router, "", path);
        const actual = match(path);
        expect(
          actual === false ? "MISS" : { ...actual },
          `${JSON.stringify(pattern)} vs ${JSON.stringify(path)}`,
        ).toEqual(expected === undefined ? "MISS" : { ...expected.params });
      }
    });
  }

  it("binds `**` params", () => {
    const match = createRouteMatcher("/api/**");
    expect(match("/api")).toEqual({ _: "" });
    expect(match("/api/")).toEqual({ _: "" });
    expect(match("/api/x/y")).toEqual({ _: "x/y" });
    expect(match("/apix")).toBe(false);
  });

  it("reports a param-less match as `undefined`, not a miss", () => {
    const match = createRouteMatcher("/api");
    expect(match("/api")).toBeUndefined();
    expect(match("/apix")).toBe(false);
  });
});
