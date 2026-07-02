import { beforeEach, describe, it, expect } from "vitest";
import { describeMatrix } from "./_setup.ts";
import { H3 } from "../src/index.ts";

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

  it("should NOT bypass auth via percent-encoded path /api/%61dmin/users", async () => {
    const res = await ctx.fetch("/api/%61dmin/users");
    expect(res.status).not.toBe(200);
  });

  it("should NOT bypass auth via /api/admi%6e/users", async () => {
    const res = await ctx.fetch("/api/admi%6e/users");
    expect(res.status).not.toBe(200);
  });

  it("should NOT bypass auth via /%61pi/admin/users", async () => {
    const res = await ctx.fetch("/%61pi/admin/users");
    expect(res.status).not.toBe(200);
  });
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
