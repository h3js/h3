import { defineJsonRpcHandler } from "../src/index.ts";
import { describeMatrix } from "./_setup.ts";

describeMatrix("json-rpc", (t, { describe, it, expect }) => {
  const eventHandler = defineJsonRpcHandler({
    echo: ({ params }, event) => {
      return `Recieved ${params} on path ${event.url.pathname}`;
    },
    sum: ({ params }) => {
      if (
        !params ||
        typeof params !== "object" ||
        !("a" in params) ||
        typeof params.a !== "number" ||
        !("b" in params) ||
        typeof params.b !== "number"
      ) {
        throw new Error("Invalid parameters for sum");
      }
      return params.a + params.b;
    },
    error: () => {
      throw new Error("Handler error");
    },
    unsafe: () => {
      return "ok";
    },
  });

  describe("success cases", () => {
    it("should handle a valid JSON-RPC request", async () => {
      t.app.post("/json-rpc", eventHandler);
      const result = await t.fetch("/json-rpc", {
        method: "POST",
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "echo",
          params: "Hello World",
          id: 1,
        }),
      });

      expect(await result.json()).toMatchObject({
        jsonrpc: "2.0",
        id: 1,
        result: "Recieved Hello World on path /json-rpc",
      });
    });

    it("should handle batch requests with mixed results", async () => {
      t.app.post("/json-rpc", eventHandler);
      const batch = [
        { jsonrpc: "2.0", method: "echo", params: "A", id: 1 },
        { jsonrpc: "2.0", method: "sum", params: { a: 2, b: 3 }, id: 2 },
        { jsonrpc: "2.0", method: "notFound", id: 3 },
        { jsonrpc: "2.0", method: "echo", params: "Notify" }, // notification
      ];
      const result = await t.fetch("/json-rpc", {
        method: "POST",
        body: JSON.stringify(batch),
      });
      const json = await result.json();
      expect(json).toEqual([
        { jsonrpc: "2.0", id: 1, result: "Recieved A on path /json-rpc" },
        { jsonrpc: "2.0", id: 2, result: 5 },
        {
          jsonrpc: "2.0",
          id: 3,
          error: { code: -32_601, message: "Method not found" },
        },
      ]);
    });

    it("should respond with a 202 for a valid JSON-RPC notification", async () => {
      t.app.post("/json-rpc", eventHandler);
      const result = await t.fetch("/json-rpc", {
        method: "POST",
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "echo",
          params: "Hello World",
          // No ID for notification
        }),
      });

      expect(await result.text()).toBe("");
      expect(result.status).toBe(202);
    });

    it("should return 202 for batch with only notifications", async () => {
      t.app.post("/json-rpc", eventHandler);
      const batch = [
        { jsonrpc: "2.0", method: "echo", params: "Notify1" },
        { jsonrpc: "2.0", method: "echo", params: "Notify2" },
      ];
      const result = await t.fetch("/json-rpc", {
        method: "POST",
        body: JSON.stringify(batch),
      });
      expect(result.status).toBe(202);
      expect(await result.text()).toBe("");
    });
  });

  describe("error handling", () => {
    it("should return an error for an invalid JSON-RPC request", async () => {
      t.app.post("/json-rpc", eventHandler);
      const result = await t.fetch("/json-rpc", {
        method: "POST",
        body: JSON.stringify({
          jsonrpc: "1.0", // Invalid version
          method: "echo",
          // Missing params
          id: 1,
        }),
      });

      expect(await result.json()).toMatchObject({
        jsonrpc: "2.0",
        id: 1,
        error: {
          code: -32_600,
          message: "Invalid Request",
        },
      });
    });

    it("should return error for invalid method type", async () => {
      t.app.post("/json-rpc", eventHandler);
      const result = await t.fetch("/json-rpc", {
        method: "POST",
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: 123,
          id: 5,
        }),
      });
      const json = await result.json();
      expect(json).toMatchInlineSnapshot(`
        {
          "error": {
            "code": -32600,
            "message": "Invalid Request",
          },
          "id": 5,
          "jsonrpc": "2.0",
        }
      `);
    });

    it("should handle handler errors and map to JSON-RPC error", async () => {
      t.app.post("/json-rpc", eventHandler);
      const result = await t.fetch("/json-rpc", {
        method: "POST",
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "error",
          id: 4,
        }),
      });
      const json = await result.json();
      expect(json).toMatchInlineSnapshot(`
        {
          "error": {
            "code": -32603,
            "data": {},
            "message": "Internal error",
          },
          "id": 4,
          "jsonrpc": "2.0",
        }
      `);
    });

    it("should return error for method not found", async () => {
      t.app.post("/json-rpc", eventHandler);
      const result = await t.fetch("/json-rpc", {
        method: "POST",
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "notFound",
          id: 2,
        }),
      });
      expect(await result.json()).toMatchObject({
        jsonrpc: "2.0",
        id: 2,
        error: {
          code: -32_601,
          message: "Method not found",
        },
      });
    });

    it("should reject non-POST requests", async () => {
      t.app.all("/json-rpc", eventHandler);
      const result = await t.fetch("/json-rpc", {
        method: "GET",
      });
      expect(result.status).toBe(405);
      expect(await result.text()).toContain("Method Not Allowed");
    });

    it("should return parse error for invalid JSON", async () => {
      t.app.post("/json-rpc", eventHandler);
      const result = await t.fetch("/json-rpc", {
        method: "POST",
        body: "{ invalid json }",
      });
      const json = await result.json();
      expect(json).toMatchInlineSnapshot(`
        {
          "error": {
            "code": -32700,
            "data": {},
            "message": "Parse error",
          },
          "id": null,
          "jsonrpc": "2.0",
        }
      `);
    });

    it("should return parse error for unsafe keys", async () => {
      t.app.all("/json-rpc", eventHandler);
      const result = await t.fetch("/json-rpc", {
        method: "POST",
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "unsafe",
          params: { __proto__: {} },
          id: 3,
        }),
      });
      const json = await result.json();
      expect(json).toMatchInlineSnapshot(`
        {
          "id": 3,
          "jsonrpc": "2.0",
          "result": "ok",
        }
      `);
    });
  });
});
