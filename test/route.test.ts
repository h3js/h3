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
  it("should create a handler that works with app.on", async () => {
    const app = new H3();
    app.on("GET", "/test", defineRoute({ handler: () => "test response" }));
    const res = await app.fetch("/test");
    expect(await res.text()).toBe("test response");
  });

  it("should handle middleware options", async () => {
    const logs: string[] = [];
    const app = new H3();
    app.on(
      "POST",
      "/test",
      defineRoute({
        middleware: [
          async (event, next) => {
            logs.push("mw");
            return next();
          },
        ],
        handler: () => "ok",
      }),
    );
    const res = await app.fetch("/test", { method: "POST" });
    expect(await res.text()).toBe("ok");
    expect(logs).toEqual(["mw"]);
  });

  it("should work with validation schemas and set meta", async () => {
    const app = new H3();
    const handler = defineRoute({
      input: mockSchema,
      routerParams: mockSchema,
      queryParams: mockSchema,
      output: mockSchema,
      handler: () => "user created",
    });
    app.on("POST", "/users", handler);
    const res = await app.fetch("/users", { method: "POST" });
    expect(await res.text()).toBe("user created");
    // Check meta
    expect(handler.meta).toBeDefined();
    if (handler.meta) {
      expect(handler.meta.input).toBe(mockSchema);
      expect(handler.meta.routerParams).toBe(mockSchema);
      expect(handler.meta.queryParams).toBe(mockSchema);
      expect(handler.meta.output).toBe(mockSchema);
      expect(handler.meta.method).toBeUndefined();
      expect(handler.meta.route).toBeUndefined();
    }
  });

  it("should attach meta info for introspection", () => {
    const handler = defineRoute({
      input: mockSchema,
      routerParams: mockSchema,
      queryParams: mockSchema,
      output: mockSchema,
      handler: () => "ok",
    });
    expect(handler.meta).toBeDefined();
    if (handler.meta) {
      // Only check fields that are set
      expect(handler.meta.input).toBe(mockSchema);
      expect(handler.meta.routerParams).toBe(mockSchema);
      expect(handler.meta.queryParams).toBe(mockSchema);
      expect(handler.meta.output).toBe(mockSchema);
      expect(handler.meta.method).toBeUndefined();
      expect(handler.meta.route).toBeUndefined();
    }

    // Also test with only input set
    const handler2 = defineRoute({
      input: mockSchema,
      handler: () => "ok",
    });
    expect(handler2.meta).toBeDefined();
    if (handler2.meta) {
      expect(handler2.meta.input).toBe(mockSchema);
      expect(handler2.meta.routerParams).toBeUndefined();
      expect(handler2.meta.queryParams).toBeUndefined();
      expect(handler2.meta.output).toBeUndefined();
      expect(handler2.meta.method).toBeUndefined();
      expect(handler2.meta.route).toBeUndefined();
    }
  });
});
