import { describe, expect, it } from "vitest";
import { createMatcherFromFind } from "../../src/rules/match.ts";
import { alternatePathReadings } from "../../src/rules/readings.ts";

const PATHS = [
  "/",
  "/a/b",
  "/@admin/x",
  "/admin%2fpanel",
  "/a%20b/x",
  "/caf%C3%A9/x",
  "/a//../b",
  "/a%2520b",
  "/x%2F..%2Fy",
];

describe("alternatePathReadings", () => {
  it.each(["/", "/a/b", "/a/b/", "/@admin/x"])("returns `undefined` for `%s`", (pathname) => {
    expect(alternatePathReadings(pathname)).toBeUndefined();
  });

  it.each([
    ["/admin%2fpanel", ["/admin%2Fpanel", "/admin/panel"]],
    ["/a%20b/x", ["/a b/x"]],
    ["/caf%C3%A9/x", ["/caf%c3%a9/x", "/café/x"]],
    ["/a//../b", ["/a/b", "/b"]],
    ["/a%2520b", ["/a%20b", "/a b"]],
    ["/x%2F..%2Fy", ["/x%2f..%2fy", "/y"]],
  ])("reads `%s` as %j", (pathname, readings) => {
    expect(alternatePathReadings(pathname)).toEqual(readings);
  });

  it.each(PATHS)("never repeats `%s` or a reading", (pathname) => {
    const readings = alternatePathReadings(pathname) ?? [];
    expect(readings).not.toContain(pathname);
    expect(new Set(readings).size).toBe(readings.length);
  });

  it.each(PATHS)("matches what `createMatcherFromFind` looks up for `%s`", (pathname) => {
    const lookups: string[] = [];
    createMatcherFromFind((_method, path) => {
      lookups.push(path);
      return [];
    })("GET", pathname);
    expect(lookups).toEqual([pathname, ...(alternatePathReadings(pathname) ?? [])]);
  });
});
