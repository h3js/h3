import { describe, it, expect } from "vitest";
import { defineRoute } from "../src/utils/route.ts";
import { H3 } from "../src/h3.ts";
import { z } from "zod";

describe("defineRoute", () => {
  it("should create a plugin that automatically registers the route", async () => {
    const app = new H3();
    const testRoute = defineRoute({
      method: "GET",
      route: "/test",
      handler: () => "test response",
    });
    app.register(testRoute);
    const res = await app.request("/test");
    expect(await res.text()).toBe("test response");
  });

  it("should support middleware", async () => {
    const app = new H3();
    const routePlugin = defineRoute({
      method: "POST",
      route: "/test",
      middleware: [
        (event) => {
          event.res.headers.set("X-Middleware", "works");
        },
      ],
      handler: () => "ok",
    });
    app.register(routePlugin);
    const res = await app.request("/test", { method: "POST" });
    expect(await res.text()).toBe("ok");
    expect(res.headers.get("X-Middleware")).toBe("works");
  });

  it("should register route with meta information", async () => {
    const app = new H3();
    const routePlugin = defineRoute({
      method: "GET",
      route: "/api/test",
      meta: { custom: "value" },
      handler: () => "ok",
    });
    app.register(routePlugin);

    // Check that route was registered
    const route = app._routes.find(
      (r) => r.route === "/api/test" && r.method === "GET",
    );

    expect(route).toMatchObject({
      route: "/api/test",
      method: "GET",
      meta: { custom: "value" },
      handler: expect.any(Function),
    });
  });

  it("should work with validation schemas", async () => {
    const app = new H3();
    const routePlugin = defineRoute({
      method: "POST",
      route: "/users",
      validate: {
        query: z.object({ id: z.string().uuid() }),
      },
      handler: () => "user created",
    });
    app.register(routePlugin);
    const res = await app.request("/users", { method: "POST" });
    expect(await res.json()).toMatchObject({
      status: 400,
      statusText: "Validation failed",
      data: { issues: [{ path: ["id"] }] },
    });
  });
});
