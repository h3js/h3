import { describe, it, expect } from "vitest";
import { defineRoute, defineWebSocketRoute } from "../src/utils/route.ts";
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
    const route = app["~routes"].find((r) => r.route === "/api/test" && r.method === "GET");

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

describe("defineWebSocketRoute", () => {
  it("should create a plugin that registers WebSocket route", async () => {
    const app = new H3();
    const wsRoute = defineWebSocketRoute({
      route: "/ws",
      websocket: {
        open: () => {},
        message: () => {},
      },
    });
    app.register(wsRoute);

    const route = app["~routes"].find((r) => r.route === "/ws");
    expect(route).toBeDefined();
    expect(route?.method).toBe("GET");
  });

  it("should use GET method for WebSocket routes", async () => {
    const app = new H3();
    const wsRoute = defineWebSocketRoute({
      route: "/ws",
      websocket: {},
    });
    app.register(wsRoute);

    const route = app["~routes"].find((r) => r.route === "/ws");
    expect(route?.method).toBe("GET");
  });

  it("should test WebSocket upgrade response", async () => {
    const app = new H3();
    const wsRoute = defineWebSocketRoute({
      route: "/ws",
      websocket: {
        open: (peer) => {
          peer.send("Welcome!");
        },
      },
    });
    app.register(wsRoute);

    const res = await app.request("/ws");
    expect(res.status).toBe(426);
    expect(await res.text()).toContain("WebSocket upgrade is required");
    expect((res as any).crossws).toBeDefined();
  });

  it("should work with different route patterns", async () => {
    const app = new H3();
    const patterns = ["/api/ws", "/ws/:id", "/chat/:room/:user"];

    for (const pattern of patterns) {
      const wsRoute = defineWebSocketRoute({
        route: pattern,
        websocket: {},
      });
      app.register(wsRoute);

      const route = app["~routes"].find((r) => r.route === pattern);
      expect(route).toBeDefined();
      expect(route?.route).toBe(pattern);
    }
  });

  it("should be compatible with existing WebSocket handler methods", async () => {
    const app = new H3();
    const hooks = {
      open: () => {},
      message: () => {},
      close: () => {},
    };

    // Test compatibility with defineWebSocketRoute
    const wsRoute = defineWebSocketRoute({
      route: "/new-ws",
      websocket: hooks,
    });
    app.register(wsRoute);

    // Test compatibility with traditional approach
    const { defineWebSocketHandler } = await import("../src/index.ts");
    app.on("GET", "/old-ws", defineWebSocketHandler(hooks));

    // Both routes should be registered
    const newRoute = app["~routes"].find((r) => r.route === "/new-ws");
    const oldRoute = app["~routes"].find((r) => r.route === "/old-ws");

    expect(newRoute).toBeDefined();
    expect(oldRoute).toBeDefined();

    // Both should return similar responses
    const newRes = await app.request("/new-ws");
    const oldRes = await app.request("/old-ws");

    expect(newRes.status).toBe(oldRes.status);
    expect((newRes as any).crossws).toBeDefined();
    expect((oldRes as any).crossws).toBeDefined();
  });
});
