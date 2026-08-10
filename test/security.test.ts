import { beforeEach, describe, it, expect } from "vitest";
import { describeMatrix } from "./_setup.ts";
import { H3, defineHandler, mockEvent } from "../src/index.ts";

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

  // Everything that is not an unreserved escape is opaque: no consumer can read
  // it as a different segment, so it reaches the handler exactly as it arrived.
  for (const path of ["/a%2Fb", "/a%5Cb", "/a%20b", "/caf%C3%A9", "/a%2541", "/a%09b", "/a%3Ab"]) {
    it(`serves ${path} unchanged`, async () => {
      const res = await ctx.fetch(path);
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ path, reqPath: path });
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

describe("security: allowNonCanonicalURL opt-in", () => {
  const appWith = (allowNonCanonicalURL?: boolean) =>
    new H3({ allowNonCanonicalURL }).get("/**", (event) => ({
      pathname: event.url.pathname,
      reqPathname: new URL(event.req.url).pathname,
    }));

  it("canonicalizes by default", async () => {
    const res = await appWith().request("/api/%61dmin");
    expect(await res.json()).toEqual({
      pathname: "/api/admin",
      reqPathname: "/api/%61dmin",
    });
  });

  it("dispatches the raw pathname when enabled", async () => {
    const res = await appWith(true).request("/api/%61dmin");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      pathname: "/api/%61dmin",
      reqPathname: "/api/%61dmin",
    });
  });

  // The whole point of the opt-out: the app owns the encoded spellings now.
  it("lets an encoded path past a pathname guard when enabled", async () => {
    const app = new H3({ allowNonCanonicalURL: true })
      .use("/api/admin/**", (event) => {
        event.res.status = 403;
        return "Forbidden";
      })
      .all("/**", () => "ok");
    expect((await app.request("/api/admin/x")).status).toBe(403);
    expect((await app.request("/api/%61dmin/x")).status).toBe(200);
  });
});

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
