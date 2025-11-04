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
    const route = app["~routes"].find(
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

  it("should validate route params", async () => {
    const app = new H3();
    const routePlugin = defineRoute({
      method: "GET",
      route: "/users/:id",
      validate: {
        params: z.object({ id: z.string().uuid() }),
      },
      handler: (event) => {
        // Type test: params should be { id: string } not Record<string, string>
        // After validation, params is guaranteed to exist
        const id: string = event.context.params!.id;
        return { userId: id };
      },
    });
    app.register(routePlugin);

    // Valid UUID
    const validRes = await app.request(
      "/users/123e4567-e89b-12d3-a456-426614174000",
    );
    expect(await validRes.json()).toEqual({
      userId: "123e4567-e89b-12d3-a456-426614174000",
    });

    // Invalid UUID
    const invalidRes = await app.request("/users/invalid-uuid");
    expect(await invalidRes.json()).toMatchObject({
      status: 400,
      statusText: "Validation failed",
    });
  });

  it("should validate response", async () => {
    const app = new H3();
    const routePlugin = defineRoute({
      method: "GET",
      route: "/api/data",
      validate: {
        response: z.object({ id: z.string(), name: z.string() }),
      },
      handler: () => {
        return { id: "123", name: "test" };
      },
    });
    app.register(routePlugin);

    const res = await app.request("/api/data");
    expect(await res.json()).toEqual({ id: "123", name: "test" });
  });

  it("should fail on invalid response", async () => {
    const app = new H3();
    const routePlugin = defineRoute({
      method: "GET",
      route: "/api/bad",
      validate: {
        response: z.object({ id: z.string(), name: z.string() }),
      },
      handler: () => {
        return { id: 123, invalid: "data" } as any;
      },
    });
    app.register(routePlugin);

    const res = await app.request("/api/bad");
    expect(await res.json()).toMatchObject({
      status: 500,
      statusText: "Response validation failed",
    });
  });

  it("should validate request body", async () => {
    const app = new H3();
    const routePlugin = defineRoute({
      method: "POST",
      route: "/api/users",
      validate: {
        body: z.object({
          name: z.string().min(3),
          email: z.string().email(),
          age: z.number().int().positive(),
        }),
      },
      handler: async (event) => {
        // Type test: body should be { name: string, email: string, age: number }
        const body = await event.req.json();
        const name: string = body.name;
        const email: string = body.email;
        const age: number = body.age;
        return { name, email, age };
      },
    });
    app.register(routePlugin);

    // Valid body
    const validRes = await app.request("/api/users", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "John Doe",
        email: "john@example.com",
        age: 30,
      }),
    });
    expect(await validRes.json()).toEqual({
      name: "John Doe",
      email: "john@example.com",
      age: 30,
    });

    // Invalid body - missing field
    const invalidRes = await app.request("/api/users", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Jo", // too short
        email: "invalid-email",
        age: -5, // negative
      }),
    });
    const error = await invalidRes.json();
    expect(error.status).toBe(400);
    expect(error.statusText).toBe("Validation failed");
    expect(error.data.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: ["name"] }),
        expect.objectContaining({ path: ["email"] }),
        expect.objectContaining({ path: ["age"] }),
      ]),
    );
  });

  it("should validate request headers", async () => {
    const app = new H3();
    const routePlugin = defineRoute({
      method: "GET",
      route: "/api/protected",
      validate: {
        headers: z.object({
          "x-api-key": z.string().min(10),
          "x-client-version": z.string().regex(/^\d+\.\d+\.\d+$/),
        }),
      },
      handler: (event) => {
        const apiKey = event.req.headers.get("x-api-key");
        const version = event.req.headers.get("x-client-version");
        return { apiKey, version };
      },
    });
    app.register(routePlugin);

    // Valid headers
    const validRes = await app.request("/api/protected", {
      headers: {
        "x-api-key": "valid-api-key-123",
        "x-client-version": "1.2.3",
      },
    });
    expect(await validRes.json()).toEqual({
      apiKey: "valid-api-key-123",
      version: "1.2.3",
    });

    // Invalid headers
    const invalidRes = await app.request("/api/protected", {
      headers: {
        "x-api-key": "short", // too short
        "x-client-version": "invalid", // wrong format
      },
    });
    const error = await invalidRes.json();
    expect(error.status).toBe(400);
    expect(error.statusText).toBe("Validation failed");
    expect(error.data.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: ["x-api-key"] }),
        expect.objectContaining({ path: ["x-client-version"] }),
      ]),
    );
  });

  it("should validate all fields together", async () => {
    const app = new H3();
    const routePlugin = defineRoute({
      method: "POST",
      route: "/api/complete/:userId",
      validate: {
        params: z.object({ userId: z.string().uuid() }),
        query: z.object({ include: z.string().optional() }),
        headers: z.object({ "x-token": z.string() }),
        body: z.object({ action: z.string() }),
        response: z.object({
          userId: z.string(),
          action: z.string(),
          included: z.boolean(),
        }),
      },
      handler: async (event) => {
        // All types should be inferred
        const userId: string = event.context.params!.userId;
        const body = await event.req.json();
        const action: string = body.action;
        const query = new URL(event.req.url).searchParams;
        const include = query.get("include");

        return {
          userId,
          action,
          included: !!include,
        };
      },
    });
    app.register(routePlugin);

    const res = await app.request(
      "/api/complete/123e4567-e89b-12d3-a456-426614174000?include=details",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-token": "test-token",
        },
        body: JSON.stringify({ action: "update" }),
      },
    );

    expect(await res.json()).toEqual({
      userId: "123e4567-e89b-12d3-a456-426614174000",
      action: "update",
      included: true,
    });
  });
});
