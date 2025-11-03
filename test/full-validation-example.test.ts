import { describe, it, expect } from "vitest";
import { H3 } from "../src/h3.ts";
import { defineRoute } from "../src/utils/route.ts";
import { defineValidatedHandler } from "../src/handler.ts";
import { z } from "zod";

describe("Full validation type inference", () => {
  it("should infer ALL validation types in defineRoute", async () => {
    const app = new H3();

    // Complete validation example with ALL schemas
    const fullRoute = defineRoute({
      method: "POST",
      route: "/users/:id",
      validate: {
        // 1. Route params validation
        params: z.object({
          id: z.string().uuid(),
        }),
        // 2. Query validation
        query: z.object({
          include: z.string().optional(),
          limit: z.string().default("10"),
        }),
        // 3. Request body validation
        body: z.object({
          name: z.string().min(3),
          email: z.string().email(),
          age: z.number().int().positive(),
        }),
        // 4. Response validation
        response: z.object({
          id: z.string(),
          name: z.string(),
          email: z.string(),
          age: z.number(),
          limit: z.string(),
        }),
      },
      handler: async (event) => {
        // Type inference test: ALL types should be properly inferred

        // ✅ 1. params is inferred as { id: string }
        const userId: string = event.context.params!.id;

        // ✅ 2. query is inferred as { include?: string, limit: string }
        const query = new URL(event.req.url).searchParams;
        const limit: string = query.get("limit") || "10";

        // ✅ 3. body is inferred as { name: string, email: string, age: number }
        const body = await event.req.json();
        const userName: string = body.name;
        const userEmail: string = body.email;
        const userAge: number = body.age;

        // ✅ 4. Return type is enforced as { id: string, name: string, email: string, age: number, limit: string }
        return {
          id: userId,
          name: userName,
          email: userEmail,
          age: userAge,
          limit,
        };

        // ❌ This would be a TypeScript error:
        // return { wrong: "type" };
      },
    });

    app.register(fullRoute);

    // Test with valid data
    const res = await app.request(
      "/users/123e4567-e89b-12d3-a456-426614174000?limit=20",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "John Doe",
          email: "john@example.com",
          age: 30,
        }),
      },
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      id: "123e4567-e89b-12d3-a456-426614174000",
      name: "John Doe",
      email: "john@example.com",
      age: 30,
      limit: "20",
    });
  });

  it("should infer ALL validation types in defineValidatedHandler", async () => {
    const app = new H3();

    // Complete validation example with ALL schemas using defineValidatedHandler
    const handler = defineValidatedHandler({
      validate: {
        // 1. Route params validation
        params: z.object({
          userId: z.string().uuid(),
        }),
        // 2. Query validation
        query: z.object({
          format: z.enum(["json", "xml"]),
        }),
        // 3. Request body validation
        body: z.object({
          title: z.string(),
          content: z.string(),
        }),
        // 4. Response validation
        response: z.object({
          postId: z.string(),
          userId: z.string(),
          title: z.string(),
          format: z.string(),
        }),
      },
      handler: async (event) => {
        // Type inference test: ALL types should be properly inferred

        // ✅ 1. params is inferred as { userId: string }
        const userId: string = event.context.params!.userId;

        // ✅ 2. query types are available via URL
        const query = new URL(event.req.url).searchParams;
        const format: string = query.get("format") || "json";

        // ✅ 3. body is inferred as { title: string, content: string }
        const body = await event.req.json();
        const title: string = body.title;

        // ✅ 4. Return type is enforced
        return {
          postId: "post-123",
          userId,
          title,
          format,
        };
      },
    });

    app.post("/posts/:userId", handler);

    const res = await app.request(
      "/posts/123e4567-e89b-12d3-a456-426614174000?format=json",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: "Test Post",
          content: "This is a test",
        }),
      },
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      postId: "post-123",
      userId: "123e4567-e89b-12d3-a456-426614174000",
      title: "Test Post",
      format: "json",
    });
  });

  it("should fail validation for each schema type", async () => {
    const app = new H3();

    const strictRoute = defineRoute({
      method: "POST",
      route: "/api/:id",
      validate: {
        params: z.object({ id: z.string().uuid() }),
        query: z.object({ key: z.string().min(5) }),
        body: z.object({ value: z.number() }),
        response: z.object({ result: z.string() }),
      },
      handler: async (event) => {
        const body = await event.req.json();
        return { result: String(body.value) };
      },
    });

    app.register(strictRoute);

    // Test 1: Invalid params
    const invalidParams = await app.request("/api/not-a-uuid?key=validkey", {
      method: "POST",
      body: JSON.stringify({ value: 123 }),
    });
    const paramsError = await invalidParams.json();
    expect(paramsError.status).toBe(400);
    expect(paramsError.statusText).toBe("Validation failed");

    // Test 2: Invalid query
    const invalidQuery = await app.request(
      "/api/123e4567-e89b-12d3-a456-426614174000?key=bad",
      {
        method: "POST",
        body: JSON.stringify({ value: 123 }),
      },
    );
    const queryError = await invalidQuery.json();
    expect(queryError.status).toBe(400);
    expect(queryError.data.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: ["key"],
        }),
      ]),
    );

    // Test 3: Invalid body
    const invalidBody = await app.request(
      "/api/123e4567-e89b-12d3-a456-426614174000?key=validkey",
      {
        method: "POST",
        body: JSON.stringify({ value: "not-a-number" }),
      },
    );
    const bodyError = await invalidBody.json();
    expect(bodyError.status).toBe(400);
    expect(bodyError.data.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: ["value"],
        }),
      ]),
    );
  });
});
