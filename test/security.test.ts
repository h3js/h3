import { beforeEach, describe, it, expect } from "vitest";
import { describeMatrix } from "./_setup.ts";
import { H3, defineHandler, mockEvent, serveStatic } from "../src/index.ts";

describeMatrix("security: path encoding bypass", (ctx, { it, expect }) => {
  beforeEach(() => {
    ctx.app.use("/api/admin/**", (_event, next) => {
      const token = _event.req.headers.get("authorization");
      if (token !== "Bearer admin-secret-token") {
        _event.res.status = 403;
        return "Forbidden";
      }
      return next();
    });

    ctx.app.get("/api/admin/:action", (event) => {
      return { admin: true, action: event.context.params?.action };
    });

    ctx.app.get("/api/public", () => {
      return { public: true };
    });
  });

  it("blocks unauthenticated access to /api/admin/users", async () => {
    const res = await ctx.fetch("/api/admin/users");
    expect(res.status).toBe(403);
  });

  it("allows authenticated access to /api/admin/users", async () => {
    const res = await ctx.fetch("/api/admin/users", {
      headers: { Authorization: "Bearer admin-secret-token" },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ admin: true, action: "users" });
  });

  it("allows access to public endpoint", async () => {
    const res = await ctx.fetch("/api/public");
    expect(res.status).toBe(200);
  });

  // A percent-encoded path is canonicalized before routing, so the guard sees
  // the same string as the route it protects and blocks it.
  for (const path of ["/api/%61dmin/users", "/api/admi%6e/users", "/%61pi/admin/users"]) {
    it(`should NOT bypass auth via ${path}`, async () => {
      const res = await ctx.fetch(path);
      expect(res.status).not.toBe(200);
      expect(res.status).toBe(403);
    });
  }
});

describeMatrix("security: path encoding bypass with wildcard routes", (ctx, { it, expect }) => {
  beforeEach(() => {
    ctx.app.use("/api/admin/**", (_event, next) => {
      const token = _event.req.headers.get("authorization");
      if (token !== "Bearer admin-secret-token") {
        _event.res.status = 403;
        return "Forbidden";
      }
      return next();
    });

    ctx.app.all("/api/**", (event) => {
      return { path: event.url.pathname };
    });
  });

  it("blocks /api/admin/users without auth", async () => {
    const res = await ctx.fetch("/api/admin/users");
    expect(res.status).toBe(403);
  });

  it("should NOT bypass auth with wildcard via /api/%61dmin/users", async () => {
    const res = await ctx.fetch("/api/%61dmin/users");
    expect(res.status).not.toBe(200);
    expect(res.status).toBe(403);
  });

  // Double-encoded %2561 stays as %2561 — %25 (encoded %) is preserved to avoid
  // unintended double-decoding. This is a distinct path from "admin" and matches
  // the wildcard but not the admin middleware, which is expected behavior.
  it("double-encoded /api/%2561dmin/users is a distinct path (not an admin bypass)", async () => {
    const res = await ctx.fetch("/api/%2561dmin/users");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ path: "/api/%2561dmin/users" });
  });
});

describeMatrix("security: malformed percent-encoded URL", (ctx, { it, expect }) => {
  beforeEach(() => {
    ctx.app.use("/api/admin/**", (event, next) => {
      if (event.req.headers.get("authorization") !== "Bearer admin-secret-token") {
        event.res.status = 403;
        return "Forbidden";
      }
      return next();
    });
    ctx.app.get("/api/admin/:action", () => ({ admin: true }));
    ctx.app.get("/**", () => "ok");
  });

  // Malformed percent-encoding must not throw out of the H3Event constructor
  // (before v2 this leaked a URIError past h3's error handling). It should be a
  // clean 400 handled response.
  for (const path of ["/foo%", "/%ZZ", "/bar%2", "/%"]) {
    it(`returns 400 for ${path} without throwing`, async () => {
      const res = await ctx.fetch(path);
      expect(res.status).toBe(400);
    });
  }

  // A malformed segment must never reach the guarded admin handler.
  it("does not bypass the auth guard via a malformed segment", async () => {
    const res = await ctx.fetch("/api/admin%ZZ/users");
    expect(res.status).not.toBe(200);
  });
});

describeMatrix("security: pathname canonicalization", (ctx, { it, expect }) => {
  beforeEach(() => {
    ctx.app.all("/**", (event) => ({
      path: event.url.pathname,
      search: event.url.search,
      reqPath: new URL(event.req.url).pathname,
    }));
  });

  it("decodes an unreserved escape, leaving req.url and the query alone", async () => {
    const res = await ctx.fetch("/a/%61?x=%61&y=1");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      path: "/a/a",
      search: "?x=%61&y=1",
      reqPath: "/a/%61",
    });
  });

  // The URL parser resolves an encoded dot segment before h3 sees it, so this
  // arrives as `/%61dmin`; canonicalizing it must not put the traversal back.
  it("never reintroduces a dot segment", async () => {
    const res = await ctx.fetch("/files/%2e%2e/%61dmin");
    expect((await res.json()).path).toBe("/admin");
  });

  // The canonical form is a fixed point, so the second request is a no-op.
  it("is a fixed point: the canonical form dispatches unchanged", async () => {
    const res = await ctx.fetch("/a/a");
    expect((await res.json()).path).toBe("/a/a");
  });

  // Everything that is not a needless escape is opaque: no consumer can read it
  // as a different segment, so it reaches the handler exactly as it arrived.
  for (const path of ["/a%2Fb", "/a%5Cb", "/a%20b", "/caf%C3%A9", "/a%2541", "/a%09b", "/a%5Eb"]) {
    it(`serves ${path} unchanged`, async () => {
      const res = await ctx.fetch(path);
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ path, reqPath: path });
    });
  }

  // Not unreserved, but the URL serializer keeps the literal — so a decoding
  // consumer (`serveStatic`'s on-disk peel, a proxy, `decodeURIComponent` in a
  // handler) reads the escape and the literal as one resource. Leaving them
  // encoded would reopen the bypass for any guard whose prefix contains one.
  // The second group is what `decodeURI` alone would have left behind: RFC 3986
  // reserves them, but only `/` is structural once the path is already parsed.
  for (const [path, canonical] of [
    ["/a%21b", "/a!b"],
    ["/a%27b", "/a'b"],
    ["/a%28b%29c", "/a(b)c"],
    ["/a%2Ab", "/a*b"],
    ["/a%5Bb%5Dc", "/a[b]c"],
    ["/a%7Cb", "/a|b"],
    ["/%40handle", "/@handle"],
    ["/users/me%3Adelete", "/users/me:delete"],
    ["/a%24b", "/a$b"],
    ["/a%26b", "/a&b"],
    ["/a%2Bb", "/a+b"],
    ["/a%2Cb", "/a,b"],
    ["/a%3Bb", "/a;b"],
    ["/a%3Db", "/a=b"],
  ]) {
    it(`canonicalizes ${path} to ${canonical}`, async () => {
      const res = await ctx.fetch(path!);
      expect(await res.json()).toMatchObject({ path: canonical, reqPath: path });
    });
  }

  it("matches routes and middleware on the canonical path", async () => {
    let guarded: string | undefined;
    ctx.app
      .use("/api/admin/**", (event, next) => {
        guarded = event.url.pathname;
        return next();
      })
      .get("/api/admin/:action", (event) => event.context.params!.action);
    const res = await ctx.fetch("/api/%61dmin/users");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("users");
    expect(guarded).toBe("/api/admin/users");
  });

  it("hands a mounted fetch handler the canonical path", async () => {
    ctx.app.mount("/api", (req) => new Response(new URL(req.url).pathname));
    const res = await ctx.fetch("/%61pi/%61dmin");
    expect(await res.text()).toBe("/admin");
  });
});

// Canonicalization only ever *removes* an escape, so it cannot add a segment
// boundary — a leading slash run stays exactly as long as it arrived and can
// never become protocol-relative for a consumer that reads the pathname back.
// Not a matrix test: `ctx.fetch` resolves the path against the test server's
// URL, which swallows the leading `//` before it can reach the app.
describe("security: canonicalization and the leading slash run", () => {
  it("leaves the leading slash run untouched", async () => {
    const app = new H3().all("/**", (event) => event.url.pathname);
    for (const [path, expected] of [
      ["//evil.com/%61", "//evil.com/a"],
      ["///evil.com/%61", "///evil.com/a"],
      ["//%61", "//a"],
    ]) {
      expect(await (await app.request(path!)).text()).toBe(expected);
    }
  });
});

// Canonicalization lives in the H3Event constructor, so it also covers events
// that never reach app dispatch.
describe("security: canonicalization covers directly built events", () => {
  it("applies to a standalone handler.fetch()", async () => {
    const handler = defineHandler((event) => event.url.pathname);
    expect(await (await handler.fetch("http://h/%61dmin")).text()).toBe("/admin");
  });

  it("applies to mockEvent()", () => {
    expect(mockEvent("/%61dmin").url.pathname).toBe("/admin");
    expect(mockEvent("/a%2Fb").url.pathname).toBe("/a%2Fb");
  });
});

// `serveStatic` peels the path with `decodeURI` for the on-disk lookup, so it is
// itself a decoding consumer: any escape it collapses but canonicalization does
// not is a guard bypass, since the guard matched the encoded form and the disk
// lookup resolves the decoded one.
describeMatrix(
  "security: a guard cannot be bypassed by an escape serveStatic decodes",
  (ctx, { it, expect }) => {
    for (const [guarded, encoded] of [
      ["/a!b", "/a%21b"],
      ["/a'b", "/a%27b"],
      ["/a*b", "/a%2Ab"],
      ["/a[0]", "/a%5B0%5D"],
      ["/a|b", "/a%7Cb"],
      ["/%61dmin", "/%61dmin"],
    ]) {
      it(`blocks ${encoded} behind a ${guarded}/** guard`, async () => {
        ctx.app.use(`${decodeURI(guarded!)}/**`, () => new Response("blocked", { status: 403 }));
        ctx.app.all("/**", (event) =>
          serveStatic(event, {
            getMeta: (id) =>
              id === `${decodeURI(guarded!)}/secret.txt` ? { size: 6, mtime: 0 } : undefined,
            getContents: () => "secret",
          }),
        );
        const res = await ctx.fetch(`${encoded}/secret.txt`);
        expect(res.status).toBe(403);
      });
    }
  },
);

// The reserved characters `decodeURI` preserves (`; : @ & = + $ ,`) are not
// structural once the path is parsed — only `/` is — but any consumer decoding
// with `decodeURIComponent` collapses them. Canonicalizing them is what keeps a
// guard whose prefix contains one from being walked past by its escaped
// spelling; `/@handle` and `/resource:action` routes are ordinary.
describeMatrix(
  "security: a guard cannot be bypassed by an escaped reserved character",
  (ctx, { it, expect }) => {
    for (const [guarded, encoded] of [
      ["/@admin", "/%40admin"],
      ["/users/me:delete", "/users/me%3Adelete"],
      ["/a$b", "/a%24b"],
      ["/a&b", "/a%26b"],
      ["/a+b", "/a%2Bb"],
      ["/a,b", "/a%2Cb"],
      ["/a;b", "/a%3Bb"],
      ["/a=b", "/a%3Db"],
    ]) {
      it(`blocks ${encoded} behind a ${guarded}/** guard`, async () => {
        ctx.app.use(`${guarded}/**`, () => new Response("blocked", { status: 403 }));
        ctx.app.all("/**", () => "leaked");
        expect((await ctx.fetch(`${encoded}/x`)).status).toBe(403);
        // ...and the literal spelling is blocked by the same guard, as before.
        expect((await ctx.fetch(`${guarded}/x`)).status).toBe(403);
      });
    }
  },
);

describe("security: allowMalformedURL opt-in", () => {
  it("rejects malformed URLs with 400 by default", async () => {
    const app = new H3();
    app.get("/**", () => "ok");
    const res = await app.request("/foo%");
    expect(res.status).toBe(400);
  });

  it("passes malformed URLs through with the raw pathname when enabled", async () => {
    const app = new H3({ allowMalformedURL: true });
    app.get("/**", (event) => event.url.pathname);
    const res = await app.request("/foo%");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("/foo%");
  });
});
