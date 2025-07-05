import { describe, it, expect } from "vitest";
import { defineRoute } from "../src/utils/route.ts";
import { H3 } from "../src/h3.ts";
import type { StandardSchemaV1 } from "../src/utils/internal/standard-schema.ts";

// Mock schema for testing
const mockSchema: StandardSchemaV1 = {
  "~standard": {
    version: 1,
    vendor: "test",
    validate: (value) => ({ value, issues: undefined }),
  },
};

describe("defineRoute", () => {
  it("should create a plugin that automatically registers the route", async () => {
    const app = new H3();
    const routePlugin = defineRoute({
      method: "GET",
      route: "/test",
      handler: () => "test response",
    });
    app.register(routePlugin);
    const res = await app.fetch("/test");
    expect(await res.text()).toBe("test response");
  });

  it("should handle middleware options", async () => {
    const logs: string[] = [];
    const app = new H3();
    const routePlugin = defineRoute({
      method: "POST",
      route: "/test",
      middleware: [
        async (event, next) => {
          logs.push("mw");
          return next();
        },
      ],
      handler: () => "ok",
    });
    app.register(routePlugin);
    const res = await app.fetch("/test", { method: "POST" });
    expect(await res.text()).toBe("ok");
    expect(logs).toEqual(["mw"]);
  });

  it("should work with validation schemas", async () => {
    const app = new H3();
    const routePlugin = defineRoute({
      method: "POST",
      route: "/users",
      validation: {
        body: mockSchema,
        params: mockSchema,
        query: mockSchema,
        response: mockSchema,
      },
      handler: () => "user created",
    });
    app.register(routePlugin);
    const res = await app.fetch("/users", { method: "POST" });
    expect(await res.text()).toBe("user created");
  });

  it("should register route with meta information", async () => {
    const app = new H3();
    const routePlugin = defineRoute({
      method: "GET",
      route: "/api/test",
      validation: {
        body: mockSchema,
        params: mockSchema,
        query: mockSchema,
        response: mockSchema,
      },
      meta: { custom: "value" },
      handler: () => "ok",
    });
    app.register(routePlugin);

    // Check that route was registered
    const route = app._routes.find(
      (r) => r.route === "/api/test" && r.method === "GET",
    );
    expect(route).toBeDefined();
    expect(route?.meta).toBeDefined();

    if (route?.meta) {
      expect((route.meta as any).validation?.body).toBe(mockSchema);
      expect((route.meta as any).validation?.params).toBe(mockSchema);
      expect((route.meta as any).validation?.query).toBe(mockSchema);
      expect((route.meta as any).validation?.response).toBe(mockSchema);
      expect((route.meta as any).method).toBe("GET");
      expect((route.meta as any).route).toBe("/api/test");
      expect((route.meta as any).custom).toBe("value");
    }
  });

  it("should handle routes without validation schemas", async () => {
    const app = new H3();
    const routePlugin = defineRoute({
      method: "GET",
      route: "/simple",
      handler: () => "simple response",
    });
    app.register(routePlugin);

    const res = await app.fetch("/simple");
    expect(await res.text()).toBe("simple response");

    // Check that route was registered with correct meta
    const route = app._routes.find(
      (r) => r.route === "/simple" && r.method === "GET",
    );
    expect(route).toBeDefined();
    expect(route?.meta).toBeDefined();

    if (route?.meta) {
      expect(route.meta.method).toBe("GET");
      expect(route.meta.route).toBe("/simple");
      expect(route.meta.input).toBeUndefined();
      expect(route.meta.routerParams).toBeUndefined();
      expect(route.meta.queryParams).toBeUndefined();
      expect(route.meta.output).toBeUndefined();
    }
  });
});
