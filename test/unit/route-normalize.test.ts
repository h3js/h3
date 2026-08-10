import { describe, expect, it } from "vitest";
import { H3 } from "../../src/h3.ts";
import { removeRoute } from "../../src/utils/route.ts";
import { normalizeRoute } from "../../src/utils/internal/path.ts";

// `on()` used to normalize a route pattern with `new URL(route, "http://_")`
// while `use(route, mw)` normalized it with `canonicalPathname` alone. The two
// disagreed on every pattern the URL serializer touches, so a guard registered
// with the *same source string* as the route it guards could match nothing
// while the route stayed reachable — guards failing open. Both now share
// `normalizeRoute`; this pins what that shape is.
const CASES: Array<[source: string, registered: string]> = [
  // Plain pathnames
  ["/admin", "/admin"],
  ["admin", "/admin"],
  ["", "/"],
  ["/", "/"],
  // An authority is not swallowed: `//admin` used to register at `/`, mounting
  // a handler at the root from a pattern that reads as scoped.
  ["//admin", "//admin"],
  // Dot segments resolve the way the URL parser resolves them in a request path
  ["/admin/../admin", "/admin"],
  ["/a/./b", "/a/b"],
  ["/a/.", "/a/"],
  ["/a/..", "/"],
  ["/../admin", "/admin"],
  ["/a/%2e%2e/b", "/b"],
  // Characters a request pathname always carries percent-encoded
  ["/café/**", "/caf%C3%A9/**"],
  ["/a b/**", "/a%20b/**"],
  ['/x"y', "/x%22y"],
  ["/x<y>z", "/x%3Cy%3Ez"],
  ["/x`y", "/x%60y"],
  ["/x#y", "/x%23y"],
  ["/😀", "/%F0%9F%98%80"],
  // rou3 pattern syntax survives verbatim. `\` especially: the URL parser
  // turned it into `/`, silently rewriting `/user/:id(\d+)` to `/user/:id(/d+)`.
  [String.raw`/user/:id(\d+)`, String.raw`/user/:id(\d+)`],
  [String.raw`/a\:b`, String.raw`/a\:b`],
  ["/a/{x}", "/a/{x}"],
  ["/u/:id?", "/u/:id?"],
  ["/files/**:rest", "/files/**:rest"],
  ["/x^y", "/x^y"],
  // Needless escapes are still canonicalized, matching what `event.url.pathname`
  // is canonicalized to. The escapes that are *not* needless stay opaque, which
  // is how a literal `^`/`?`/`{`/`}` is spelled in a pattern.
  ["/%40handle", "/@handle"],
  ["/x%5Ey", "/x%5Ey"],
  ["/x%3Fy", "/x%3Fy"],
];

describe("normalizeRoute", () => {
  it.each(CASES)("%j -> %j", (source, registered) => {
    expect(normalizeRoute(source)).toBe(registered);
  });

  it.each(CASES)("%j -> %j is a fixed point", (_source, registered) => {
    expect(normalizeRoute(registered)).toBe(registered);
  });

  it("rejects a pattern that is a URL, instead of swallowing its authority", () => {
    for (const url of [
      "http://evil.com/admin",
      "https://evil.com/admin",
      "HTTP://evil.com/admin",
      "file:///etc/passwd",
    ]) {
      expect(() => normalizeRoute(url), url).toThrow(/Route patterns are pathnames/);
    }
  });
});

describe("route registration", () => {
  it.each(CASES)("get(%j) registers %j", (source, registered) => {
    const app = new H3();
    app.get(source, () => "ok");
    expect(app["~routes"][0].route).toBe(registered);
  });

  it("get() rejects a pattern that is a URL", () => {
    const app = new H3();
    expect(() => app.get("http://evil.com/admin", () => "ok")).toThrow(
      /Route patterns are pathnames/,
    );
  });

  it("use() rejects a pattern that is a URL", () => {
    const app = new H3();
    expect(() => app.use("http://evil.com/admin", () => "ok")).toThrow(
      /Route patterns are pathnames/,
    );
  });

  it.each(CASES)("removeRoute(%j) removes the route registered as %j", (source, registered) => {
    const app = new H3();
    app.get(source, () => "ok");
    removeRoute(app, "GET", source);
    expect(app["~routes"]).toHaveLength(0);
    expect(normalizeRoute(source)).toBe(registered);
  });
});

// A guard registered with the same source string as the route it guards must
// always fire. These run through `app.request()` rather than `describeMatrix`
// because the node test client resolves `//admin` as a protocol-relative URL
// (host `admin`) before it ever reaches h3; matching itself is target-independent.
describe("guard parity", () => {
  const SCOPES: Array<{ route: string; guard: string; path: string }> = [
    { route: "/café/secret", guard: "/café/**", path: "/caf%C3%A9/secret" },
    { route: "/a b/secret", guard: "/a b/**", path: "/a%20b/secret" },
    { route: "//admin", guard: "//admin", path: "//admin" },
    { route: "/admin/../admin", guard: "/admin/../admin", path: "/admin" },
    { route: "/x<y>", guard: "/x<y>", path: "/x%3Cy%3E" },
    { route: "/x%5Ey", guard: "/x%5Ey", path: "/x^y" },
    { route: "/%40handle/**", guard: "/%40handle/**", path: "/@handle/x" },
    // `{}` was percent-encoded by the URL pass, registering an unreachable
    // route while the guard (kept literal) still fired.
    { route: "/a/{-:x}", guard: "/a/{-:x}", path: "/a/-x" },
    // A unicode literal inside a rou3 group encodes to the form the request
    // carries, so the group still matches.
    { route: "/user/:id(café)", guard: "/user/:id(café)", path: "/user/caf%C3%A9" },
    { route: String.raw`/user/:id(\d+)`, guard: String.raw`/user/:id(\d+)`, path: "/user/42" },
  ];

  it.each(SCOPES)("$guard guards $path", async ({ route, guard, path }) => {
    const app = new H3();
    app.use(guard, () => "DENIED");
    app.all(route, () => "ALLOWED");
    const res = await app.request(path);
    expect(await res.text()).toBe("DENIED");
  });

  it("keeps a rou3 escape intact: `:id(\\d+)` does not match a non-numeric id", async () => {
    const app = new H3();
    app.get(String.raw`/user/:id(\d+)`, (event) => event.context.params!.id);

    expect(await (await app.request("/user/42")).text()).toBe("42");
    expect((await app.request("/user/abc")).status).toBe(404);
  });

  it("does not mount a `//admin` pattern at the root", async () => {
    const app = new H3();
    app.get("//admin", () => "admin");

    expect(await (await app.request("//admin")).text()).toBe("admin");
    expect((await app.request("/")).status).toBe(404);
  });
});
