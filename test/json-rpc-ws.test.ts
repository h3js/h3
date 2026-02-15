import { describe, it, expect, vi } from "vitest";
import { defineJsonRpcWebSocketHandler, HTTPError } from "../src/index.ts";

import type { Peer as WebSocketPeer } from "crossws";

// Helper: create a mock WebSocket peer with a spy on `send`.
function createMockPeer(): WebSocketPeer & { _sent: string[] } {
  const sent: string[] = [];
  return {
    _sent: sent,
    send: vi.fn((data: unknown) => {
      sent.push(typeof data === "string" ? data : JSON.stringify(data));
    }),
    // Provide minimal stubs for Peer properties used in tests.
    id: "test-peer-id",
    close: vi.fn(),
    terminate: vi.fn(),
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
    publish: vi.fn(),
  } as unknown as WebSocketPeer & { _sent: string[] };
}

// Helper: create a mock Message from a string payload.
function createMockMessage(data: string) {
  return {
    text: () => data,
    json: () => JSON.parse(data),
    rawData: data,
  } as any;
}

describe("defineJsonRpcWebSocketHandler", () => {
  const methods = {
    echo: ({ params }: any) => {
      const message = Array.isArray(params) ? params[0] : params?.message;
      return `Received ${message}`;
    },
    sum: ({ params }: any) => {
      return params.a + params.b;
    },
    error: () => {
      throw new Error("Handler error");
    },
    unauthorized: () => {
      throw new HTTPError({ status: 401, message: "Authentication required" });
    },
    constructor: () => {
      return "ok";
    },
  };

  describe("handler structure", () => {
    it("should return an EventHandler that produces a 426 response with crossws hooks", () => {
      const handler = defineJsonRpcWebSocketHandler(methods);
      const res = handler({} as any);
      expect(res).toBeInstanceOf(Response);
      expect((res as Response).status).toBe(426);
      expect((res as any).crossws).toBeDefined();
      expect((res as any).crossws.message).toBeInstanceOf(Function);
    });

    it("should include user-provided hooks (open, close, error)", () => {
      const openFn = vi.fn();
      const closeFn = vi.fn();
      const errorFn = vi.fn();

      const handler = defineJsonRpcWebSocketHandler(methods, {
        hooks: {
          open: openFn,
          close: closeFn,
          error: errorFn,
        },
      });
      const res = handler({} as any);
      const hooks = (res as any).crossws;

      expect(hooks.open).toBe(openFn);
      expect(hooks.close).toBe(closeFn);
      expect(hooks.error).toBe(errorFn);
    });

    it("should not override message hook with user hooks", () => {
      const handler = defineJsonRpcWebSocketHandler(methods);
      const res = handler({} as any);
      const hooks = (res as any).crossws;
      // The message hook should be the internal JSON-RPC processor.
      expect(hooks.message).toBeInstanceOf(Function);
    });
  });

  describe("message processing", () => {
    async function sendMessage(
      messageData: unknown,
      methodsMap?: Record<string, any>,
    ): Promise<{ peer: ReturnType<typeof createMockPeer>; sent: string[] }> {
      const handler = defineJsonRpcWebSocketHandler(methodsMap || methods);
      const res = handler({} as any);
      const hooks = (res as any).crossws;

      const peer = createMockPeer();
      const msg = createMockMessage(
        typeof messageData === "string" ? messageData : JSON.stringify(messageData),
      );

      await hooks.message(peer, msg);
      return { peer, sent: peer._sent };
    }

    it("should handle a valid JSON-RPC request", async () => {
      const { sent } = await sendMessage({
        jsonrpc: "2.0",
        method: "echo",
        params: ["Hello World"],
        id: 1,
      });

      expect(sent).toHaveLength(1);
      expect(JSON.parse(sent[0])).toEqual({
        jsonrpc: "2.0",
        id: 1,
        result: "Received Hello World",
      });
    });

    it("should handle named params", async () => {
      const { sent } = await sendMessage({
        jsonrpc: "2.0",
        method: "sum",
        params: { a: 3, b: 7 },
        id: 2,
      });

      expect(sent).toHaveLength(1);
      expect(JSON.parse(sent[0])).toEqual({
        jsonrpc: "2.0",
        id: 2,
        result: 10,
      });
    });

    it("should not send a response for notifications", async () => {
      const { sent } = await sendMessage({
        jsonrpc: "2.0",
        method: "echo",
        params: ["Hello World"],
        // No id — this is a notification.
      });

      expect(sent).toHaveLength(0);
    });

    it("should treat id:null as a request (not a notification)", async () => {
      const { sent } = await sendMessage({
        jsonrpc: "2.0",
        method: "echo",
        params: ["test"],
        id: null,
      });

      expect(sent).toHaveLength(1);
      expect(JSON.parse(sent[0])).toEqual({
        jsonrpc: "2.0",
        id: null,
        result: "Received test",
      });
    });

    it("should return parse error for invalid JSON", async () => {
      const { sent } = await sendMessage("{ invalid json }");

      expect(sent).toHaveLength(1);
      expect(JSON.parse(sent[0])).toEqual({
        jsonrpc: "2.0",
        id: null,
        error: { code: -32_700, message: "Parse error" },
      });
    });

    it("should return Invalid Request for non-object body", async () => {
      const { sent } = await sendMessage('"just a string"');

      expect(sent).toHaveLength(1);
      expect(JSON.parse(sent[0])).toEqual({
        jsonrpc: "2.0",
        id: null,
        error: { code: -32_700, message: "Parse error" },
      });
    });

    it("should return Invalid Request for wrong jsonrpc version", async () => {
      const { sent } = await sendMessage({
        jsonrpc: "1.0",
        method: "echo",
        id: 1,
      });

      expect(sent).toHaveLength(1);
      expect(JSON.parse(sent[0])).toEqual({
        jsonrpc: "2.0",
        id: 1,
        error: { code: -32_600, message: "Invalid Request" },
      });
    });

    it("should return method not found for unknown methods", async () => {
      const { sent } = await sendMessage({
        jsonrpc: "2.0",
        method: "unknownMethod",
        id: 3,
      });

      expect(sent).toHaveLength(1);
      expect(JSON.parse(sent[0])).toEqual({
        jsonrpc: "2.0",
        id: 3,
        error: { code: -32_601, message: "Method not found" },
      });
    });

    it("should return Invalid params for non-structured params", async () => {
      const { sent } = await sendMessage({
        jsonrpc: "2.0",
        method: "echo",
        params: 42,
        id: 1,
      });

      expect(sent).toHaveLength(1);
      expect(JSON.parse(sent[0])).toEqual({
        jsonrpc: "2.0",
        id: 1,
        error: { code: -32_602, message: "Invalid params" },
      });
    });

    it("should reject rpc. prefixed method names", async () => {
      const { sent } = await sendMessage({
        jsonrpc: "2.0",
        method: "rpc.discover",
        id: 1,
      });

      expect(sent).toHaveLength(1);
      expect(JSON.parse(sent[0])).toEqual({
        jsonrpc: "2.0",
        id: 1,
        error: { code: -32_601, message: "Method not found" },
      });
    });

    it("should handle handler errors and map to JSON-RPC error", async () => {
      const { sent } = await sendMessage({
        jsonrpc: "2.0",
        method: "error",
        id: 4,
      });

      expect(sent).toHaveLength(1);
      expect(JSON.parse(sent[0])).toEqual({
        jsonrpc: "2.0",
        id: 4,
        error: { code: -32_603, message: "Internal error", data: "Handler error" },
      });
    });

    it("should map HTTPError status codes to JSON-RPC error codes", async () => {
      const { sent } = await sendMessage({
        jsonrpc: "2.0",
        method: "unauthorized",
        id: 1,
      });

      expect(sent).toHaveLength(1);
      expect(JSON.parse(sent[0])).toEqual({
        jsonrpc: "2.0",
        id: 1,
        error: { code: -32_001, message: "Authentication required" },
      });
    });

    it("should handle a method named 'constructor' safely", async () => {
      const { sent } = await sendMessage({
        jsonrpc: "2.0",
        method: "constructor",
        id: 1,
      });

      expect(sent).toHaveLength(1);
      expect(JSON.parse(sent[0])).toEqual({
        jsonrpc: "2.0",
        id: 1,
        result: "ok",
      });
    });

    it("should return method not found for prototype methods", async () => {
      const { sent } = await sendMessage({
        jsonrpc: "2.0",
        method: "__proto__",
        id: 1,
      });

      expect(sent).toHaveLength(1);
      expect(JSON.parse(sent[0])).toEqual({
        jsonrpc: "2.0",
        id: 1,
        error: { code: -32_601, message: "Method not found" },
      });
    });

    it("should return Invalid Request for invalid id type", async () => {
      const { sent } = await sendMessage({
        jsonrpc: "2.0",
        method: "echo",
        params: ["test"],
        id: { invalid: true },
      });

      expect(sent).toHaveLength(1);
      expect(JSON.parse(sent[0])).toEqual({
        jsonrpc: "2.0",
        id: null,
        error: { code: -32_600, message: "Invalid Request" },
      });
    });
  });

  describe("batch requests", () => {
    async function sendMessage(
      messageData: unknown,
    ): Promise<{ peer: ReturnType<typeof createMockPeer>; sent: string[] }> {
      const handler = defineJsonRpcWebSocketHandler({
        echo: ({ params }: any) => {
          const message = Array.isArray(params) ? params[0] : params?.message;
          return `Received ${message}`;
        },
        sum: ({ params }: any) => {
          return params.a + params.b;
        },
      });
      const res = handler({} as any);
      const hooks = (res as any).crossws;

      const peer = createMockPeer();
      const msg = createMockMessage(JSON.stringify(messageData));

      await hooks.message(peer, msg);
      return { peer, sent: peer._sent };
    }

    it("should handle batch requests with mixed results", async () => {
      const { sent } = await sendMessage([
        { jsonrpc: "2.0", method: "echo", params: ["A"], id: 1 },
        { jsonrpc: "2.0", method: "sum", params: { a: 2, b: 3 }, id: 2 },
        { jsonrpc: "2.0", method: "unknownMethod", id: 3 },
        { jsonrpc: "2.0", method: "echo", params: ["Notify"] }, // notification
      ]);

      expect(sent).toHaveLength(1);
      expect(JSON.parse(sent[0])).toEqual([
        { jsonrpc: "2.0", id: 1, result: "Received A" },
        { jsonrpc: "2.0", id: 2, result: 5 },
        { jsonrpc: "2.0", id: 3, error: { code: -32_601, message: "Method not found" } },
      ]);
    });

    it("should not send anything for batch of only notifications", async () => {
      const { sent } = await sendMessage([
        { jsonrpc: "2.0", method: "echo", params: ["Notify1"] },
        { jsonrpc: "2.0", method: "echo", params: ["Notify2"] },
      ]);

      expect(sent).toHaveLength(0);
    });

    it("should return Invalid Request for empty batch array", async () => {
      const { sent } = await sendMessage([]);

      expect(sent).toHaveLength(1);
      expect(JSON.parse(sent[0])).toEqual({
        jsonrpc: "2.0",
        id: null,
        error: { code: -32_600, message: "Invalid Request" },
      });
    });

    it("should return Invalid Request for non-object batch items", async () => {
      const { sent } = await sendMessage([1, 2, 3]);

      expect(sent).toHaveLength(1);
      expect(JSON.parse(sent[0])).toEqual([
        { jsonrpc: "2.0", id: null, error: { code: -32_600, message: "Invalid Request" } },
        { jsonrpc: "2.0", id: null, error: { code: -32_600, message: "Invalid Request" } },
        { jsonrpc: "2.0", id: null, error: { code: -32_600, message: "Invalid Request" } },
      ]);
    });
  });

  describe("peer context", () => {
    it("should pass the WebSocket peer as second argument to method handlers", async () => {
      const methodSpy = vi.fn((_data: any, peer: WebSocketPeer) => {
        return `peer:${peer.id}`;
      });

      const handler = defineJsonRpcWebSocketHandler({
        test: methodSpy,
      });
      const res = handler({} as any);
      const hooks = (res as any).crossws;

      const peer = createMockPeer();
      const msg = createMockMessage(JSON.stringify({ jsonrpc: "2.0", method: "test", id: 1 }));

      await hooks.message(peer, msg);

      expect(methodSpy).toHaveBeenCalledOnce();
      expect(methodSpy.mock.calls[0][1]).toBe(peer);

      expect(peer._sent).toHaveLength(1);
      expect(JSON.parse(peer._sent[0])).toEqual({
        jsonrpc: "2.0",
        id: 1,
        result: "peer:test-peer-id",
      });
    });
  });
});
