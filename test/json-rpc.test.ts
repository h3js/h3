import { defineJsonRpcHandler, HTTPError, type JsonRpcMethod } from "../src/index.ts";
import { describeMatrix } from "./_setup.ts";

describeMatrix("json-rpc", (t, { describe, it, expect }) => {
  const echo: JsonRpcMethod = ({ params }, event) => {
    const message = Array.isArray(params) ? params[0] : params?.message;
    return `Received ${message} on path ${event.url.pathname}`;
  };

  const sum: JsonRpcMethod = ({ params }) => {
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
  };

  const eventHandler = defineJsonRpcHandler({
    echo,
    sum,
    error: () => {
      throw new Error("Handler error");
    },
    errorPrimitive: () => {
      throw "Primitive error";
    },
    // "constructor" is a valid method name — the null-prototype map
    // ensures it doesn't resolve to Object.prototype.constructor.
    constructor: () => {
      return "ok";
    },
    // HTTP error handlers for testing error code mapping
    unauthorized: () => {
      throw new HTTPError({ status: 401, message: "Authentication required" });
    },
    forbidden: () => {
      throw new HTTPError({ status: 403, message: "Access denied" });
    },
    notFound: () => {
      throw new HTTPError({ status: 404, message: "Resource not found" });
    },
    badRequest: () => {
      throw new HTTPError({ status: 400, message: "Bad request data" });
    },
    conflict: () => {
      throw new HTTPError({ status: 409, message: "Resource conflict" });
    },
    rateLimited: () => {
      throw new HTTPError({ status: 429, message: "Too many requests" });
    },
    serverError: () => {
      throw new HTTPError({ status: 500, message: "Server exploded" });
    },
    redirect: () => {
      throw new HTTPError({ status: 301, message: "Resource moved permanently" });
    },
    errorWithZeroData: () => {
      throw new HTTPError({ status: 400, message: "Validation failed", data: 0 });
    },
    errorWithEmptyStringData: () => {
      throw new HTTPError({ status: 400, message: "Validation failed", data: "" });
    },
    errorWithFalseData: () => {
      throw new HTTPError({ status: 400, message: "Validation failed", data: false });
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
          params: ["Hello World"],
          id: 1,
        }),
      });

      expect(await result.json()).toMatchObject({
        jsonrpc: "2.0",
        id: 1,
        result: "Received Hello World on path /json-rpc",
      });
    });

    it("should handle batch requests with mixed results", async () => {
      t.app.post("/json-rpc", eventHandler);
      const batch = [
        { jsonrpc: "2.0", method: "echo", params: ["A"], id: 1 },
        { jsonrpc: "2.0", method: "sum", params: { a: 2, b: 3 }, id: 2 },
        { jsonrpc: "2.0", method: "unknownMethod", id: 3 },
        { jsonrpc: "2.0", method: "echo", params: ["Notify"] }, // notification
      ];
      const result = await t.fetch("/json-rpc", {
        method: "POST",
        body: JSON.stringify(batch),
      });
      const json = await result.json();
      expect(json).toEqual([
        { jsonrpc: "2.0", id: 1, result: "Received A on path /json-rpc" },
        { jsonrpc: "2.0", id: 2, result: 5 },
        {
          jsonrpc: "2.0",
          id: 3,
          error: { code: -32_601, message: "Method not found" },
        },
      ]);
    });

    it("should respond with a 202 for a single valid JSON-RPC notification", async () => {
      t.app.post("/json-rpc", eventHandler);
      const result = await t.fetch("/json-rpc", {
        method: "POST",
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "echo",
          params: ["Hello World"],
          // No ID for notification
        }),
      });

      expect(await result.text()).toBe("");
      expect(result.status).toBe(202);
    });

    it("should return 202 for batch containing only notifications", async () => {
      t.app.post("/json-rpc", eventHandler);
      const batch = [
        { jsonrpc: "2.0", method: "echo", params: ["Notify1"] },
        { jsonrpc: "2.0", method: "echo", params: ["Notify2"] },
      ];
      const result = await t.fetch("/json-rpc", {
        method: "POST",
        body: JSON.stringify(batch),
      });
      expect(result.status).toBe(202);
      expect(await result.text()).toBe("");
    });

    it("should handle a method named 'constructor' safely", async () => {
      t.app.post("/json-rpc", eventHandler);
      const result = await t.fetch("/json-rpc", {
        method: "POST",
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "constructor",
          id: 1,
        }),
      });
      const json = await result.json();
      expect(json).toEqual({
        jsonrpc: "2.0",
        id: 1,
        result: "ok",
      });
    });

    it("should treat id:null as a request (not a notification) as per spec", async () => {
      t.app.post("/json-rpc", eventHandler);
      const result = await t.fetch("/json-rpc", {
        method: "POST",
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "echo",
          params: ["test"],
          id: null,
        }),
      });
      const json = await result.json();
      expect(json).toEqual({
        jsonrpc: "2.0",
        id: null,
        result: "Received test on path /json-rpc",
      });
    });

    it("should return array for batch requests even if batch contains only one item", async () => {
      t.app.post("/json-rpc", eventHandler);
      const batch = [{ jsonrpc: "2.0", method: "echo", params: ["Hello Batch"], id: 1 }];
      const result = await t.fetch("/json-rpc", {
        method: "POST",
        body: JSON.stringify(batch),
      });
      const json = await result.json();
      expect(json).toEqual([
        { jsonrpc: "2.0", id: 1, result: "Received Hello Batch on path /json-rpc" },
      ]);
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
      expect(json).toEqual({
        error: {
          code: -32_600,
          message: "Invalid Request",
        },
        id: 5,
        jsonrpc: "2.0",
      });
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
      expect(json).toEqual({
        error: {
          code: -32_603,
          data: "Handler error",
          message: "Internal error",
        },
        id: 4,
        jsonrpc: "2.0",
      });
    });

    it("should handle primitive thrown errors and map to JSON-RPC error", async () => {
      t.app.post("/json-rpc", eventHandler);
      const result = await t.fetch("/json-rpc", {
        method: "POST",
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "errorPrimitive",
          id: 6,
        }),
      });
      const json = await result.json();
      expect(json).toEqual({
        error: {
          code: -32_603,
          message: "Internal error",
        },
        id: 6,
        jsonrpc: "2.0",
      });
    });

    it("should return error for method not found", async () => {
      t.app.post("/json-rpc", eventHandler);
      const result = await t.fetch("/json-rpc", {
        method: "POST",
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "unknownMethod",
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
      expect(json).toEqual({
        error: {
          code: -32_700,
          message: "Parse error",
        },
        id: null,
        jsonrpc: "2.0",
      });
    });

    it("should safely handle a constructor method with constructor params", async () => {
      t.app.post("/json-rpc", eventHandler);
      const result = await t.fetch("/json-rpc", {
        method: "POST",
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "constructor",
          params: { constructor: {} },
          id: 3,
        }),
      });
      const json = await result.json();
      // With null-prototype map, "constructor" is a valid registered method.
      expect(json).toEqual({
        jsonrpc: "2.0",
        id: 3,
        result: "ok",
      });
    });

    it("should return Invalid Request for empty batch array", async () => {
      t.app.post("/json-rpc", eventHandler);
      const result = await t.fetch("/json-rpc", {
        method: "POST",
        body: JSON.stringify([]),
      });
      const json = await result.json();
      expect(json).toEqual({
        jsonrpc: "2.0",
        id: null,
        error: {
          code: -32_600,
          message: "Invalid Request",
        },
      });
    });

    it("should return Invalid Request for non-object batch items", async () => {
      t.app.post("/json-rpc", eventHandler);
      const result = await t.fetch("/json-rpc", {
        method: "POST",
        body: JSON.stringify([1, 2, 3]),
      });
      const json = await result.json();
      expect(json).toEqual([
        { jsonrpc: "2.0", id: null, error: { code: -32_600, message: "Invalid Request" } },
        { jsonrpc: "2.0", id: null, error: { code: -32_600, message: "Invalid Request" } },
        { jsonrpc: "2.0", id: null, error: { code: -32_600, message: "Invalid Request" } },
      ]);
    });

    it("should reject rpc. prefixed method names", async () => {
      t.app.post("/json-rpc", eventHandler);
      const result = await t.fetch("/json-rpc", {
        method: "POST",
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "rpc.discover",
          id: 1,
        }),
      });
      const json = await result.json();
      expect(json).toEqual({
        jsonrpc: "2.0",
        id: 1,
        error: {
          code: -32_601,
          message: "Method not found",
        },
      });
    });

    it("should return Invalid Request for invalid id type", async () => {
      t.app.post("/json-rpc", eventHandler);
      const result = await t.fetch("/json-rpc", {
        method: "POST",
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "echo",
          params: ["test"],
          id: { invalid: true },
        }),
      });
      const json = await result.json();
      expect(json).toEqual({
        jsonrpc: "2.0",
        id: null,
        error: {
          code: -32_600,
          message: "Invalid Request",
        },
      });
    });

    it("should return Invalid Request for fractional id", async () => {
      t.app.post("/json-rpc", eventHandler);
      const result = await t.fetch("/json-rpc", {
        method: "POST",
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "echo",
          params: ["test"],
          id: 1.5,
        }),
      });
      const json = await result.json();
      expect(json).toEqual({
        jsonrpc: "2.0",
        id: null,
        error: {
          code: -32_600,
          message: "Invalid Request",
        },
      });
    });

    it("should return Invalid params for non-structured params", async () => {
      t.app.post("/json-rpc", eventHandler);
      const result = await t.fetch("/json-rpc", {
        method: "POST",
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "echo",
          params: 42,
          id: 1,
        }),
      });
      const json = await result.json();
      expect(json).toEqual({
        jsonrpc: "2.0",
        id: 1,
        error: {
          code: -32_602,
          message: "Invalid params",
        },
      });
    });

    it("should return method not found for unregistered methods (not prototype)", async () => {
      t.app.post("/json-rpc", eventHandler);
      const result = await t.fetch("/json-rpc", {
        method: "POST",
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "__proto__",
          id: 1,
        }),
      });
      const json = await result.json();
      expect(json).toEqual({
        jsonrpc: "2.0",
        id: 1,
        error: {
          code: -32_601,
          message: "Method not found",
        },
      });
    });

    it("should return method not found for toString (prototype method)", async () => {
      t.app.post("/json-rpc", eventHandler);
      const result = await t.fetch("/json-rpc", {
        method: "POST",
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "toString",
          id: 1,
        }),
      });
      const json = await result.json();
      expect(json).toEqual({
        jsonrpc: "2.0",
        id: 1,
        error: {
          code: -32_601,
          message: "Method not found",
        },
      });
    });
  });

  describe("HTTP error code mapping", () => {
    it("should map 401 Unauthorized to SERVER_ERROR_UNAUTHORIZED (-32001)", async () => {
      t.app.post("/json-rpc", eventHandler);
      const result = await t.fetch("/json-rpc", {
        method: "POST",
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "unauthorized",
          id: 1,
        }),
      });
      const json = await result.json();
      expect(json).toEqual({
        jsonrpc: "2.0",
        id: 1,
        error: {
          code: -32_001,
          message: "Authentication required",
        },
      });
    });

    it("should map 403 Forbidden to SERVER_ERROR_FORBIDDEN (-32003)", async () => {
      t.app.post("/json-rpc", eventHandler);
      const result = await t.fetch("/json-rpc", {
        method: "POST",
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "forbidden",
          id: 1,
        }),
      });
      const json = await result.json();
      expect(json).toEqual({
        jsonrpc: "2.0",
        id: 1,
        error: {
          code: -32_003,
          message: "Access denied",
        },
      });
    });

    it("should map 404 Not Found to SERVER_ERROR_NOT_FOUND (-32004)", async () => {
      t.app.post("/json-rpc", eventHandler);
      const result = await t.fetch("/json-rpc", {
        method: "POST",
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "notFound",
          id: 1,
        }),
      });
      const json = await result.json();
      expect(json).toEqual({
        jsonrpc: "2.0",
        id: 1,
        error: {
          code: -32_004,
          message: "Resource not found",
        },
      });
    });

    it("should map 400 Bad Request to INVALID_PARAMS (-32602)", async () => {
      t.app.post("/json-rpc", eventHandler);
      const result = await t.fetch("/json-rpc", {
        method: "POST",
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "badRequest",
          id: 1,
        }),
      });
      const json = await result.json();
      expect(json).toEqual({
        jsonrpc: "2.0",
        id: 1,
        error: {
          code: -32_602,
          message: "Bad request data",
        },
      });
    });

    it("should map 409 Conflict to SERVER_ERROR_CONFLICT (-32009)", async () => {
      t.app.post("/json-rpc", eventHandler);
      const result = await t.fetch("/json-rpc", {
        method: "POST",
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "conflict",
          id: 1,
        }),
      });
      const json = await result.json();
      expect(json).toEqual({
        jsonrpc: "2.0",
        id: 1,
        error: {
          code: -32_009,
          message: "Resource conflict",
        },
      });
    });

    it("should map 429 Too Many Requests to SERVER_ERROR_RATE_LIMITED (-32029)", async () => {
      t.app.post("/json-rpc", eventHandler);
      const result = await t.fetch("/json-rpc", {
        method: "POST",
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "rateLimited",
          id: 1,
        }),
      });
      const json = await result.json();
      expect(json).toEqual({
        jsonrpc: "2.0",
        id: 1,
        error: {
          code: -32_029,
          message: "Too many requests",
        },
      });
    });

    it("should map 500 Internal Server Error to INTERNAL_ERROR (-32603)", async () => {
      t.app.post("/json-rpc", eventHandler);
      const result = await t.fetch("/json-rpc", {
        method: "POST",
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "serverError",
          id: 1,
        }),
      });
      const json = await result.json();
      expect(json).toEqual({
        jsonrpc: "2.0",
        id: 1,
        error: {
          code: -32_603,
          message: "Server exploded",
        },
      });
    });

    it("should map generic errors to INTERNAL_ERROR (-32603)", async () => {
      t.app.post("/json-rpc", eventHandler);
      const result = await t.fetch("/json-rpc", {
        method: "POST",
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "error",
          id: 1,
        }),
      });
      const json = await result.json();
      expect(json).toEqual({
        jsonrpc: "2.0",
        id: 1,
        error: {
          code: -32_603,
          message: "Internal error",
          data: "Handler error",
        },
      });
    });

    it("should preserve falsy data values (0) in error responses", async () => {
      t.app.post("/json-rpc", eventHandler);
      const result = await t.fetch("/json-rpc", {
        method: "POST",
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "errorWithZeroData",
          id: 1,
        }),
      });
      const json = await result.json();
      expect(json).toEqual({
        jsonrpc: "2.0",
        id: 1,
        error: {
          code: -32_602,
          message: "Validation failed",
          data: 0,
        },
      });
    });

    it("should preserve falsy data values (empty string) in error responses", async () => {
      t.app.post("/json-rpc", eventHandler);
      const result = await t.fetch("/json-rpc", {
        method: "POST",
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "errorWithEmptyStringData",
          id: 1,
        }),
      });
      const json = await result.json();
      expect(json).toEqual({
        jsonrpc: "2.0",
        id: 1,
        error: {
          code: -32_602,
          message: "Validation failed",
          data: "",
        },
      });
    });

    it("should preserve falsy data values (false) in error responses", async () => {
      t.app.post("/json-rpc", eventHandler);
      const result = await t.fetch("/json-rpc", {
        method: "POST",
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "errorWithFalseData",
          id: 1,
        }),
      });
      const json = await result.json();
      expect(json).toEqual({
        jsonrpc: "2.0",
        id: 1,
        error: {
          code: -32_602,
          message: "Validation failed",
          data: false,
        },
      });
    });

    it("should map 3xx redirects to SERVER_ERROR (-32000)", async () => {
      t.app.post("/json-rpc", eventHandler);
      const result = await t.fetch("/json-rpc", {
        method: "POST",
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "redirect",
          id: 1,
        }),
      });
      const json = await result.json();
      expect(json).toEqual({
        jsonrpc: "2.0",
        id: 1,
        error: {
          code: -32_000,
          message: "Resource moved permanently",
        },
      });
    });
  });
});
