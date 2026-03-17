import { beforeEach } from "vitest";
import { describeMatrix } from "./_setup.ts";

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

  // Double-encoded %2561 decodes to %61 (one layer), which is a distinct path from "admin".
  // The wildcard /api/** correctly matches this as a valid sub-path, and the middleware
  // for /api/admin/** correctly does NOT match because %61dmin !== admin.
  // This is expected behavior — recursive decoding would create security mismatches
  // with upstream proxies/WAFs that treat these paths as distinct.
  it("double-encoded /api/%2561dmin/users is a distinct path (not an admin bypass)", async () => {
    const res = await ctx.fetch("/api/%2561dmin/users");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ path: "/api/%61dmin/users" });
  });
});
