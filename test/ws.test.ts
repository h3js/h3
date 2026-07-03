import { describe, it, expect } from "vitest";
import { defineWebSocket, defineWebSocketHandler } from "../src/index.ts";

const hooks = { message: () => {} };

describe("defineWebSocket", () => {
  it("should return the provided hooks", () => {
    const result = defineWebSocket(hooks);
    expect(result).toEqual(hooks);
  });
});

describe("defineWebSocketHandler", () => {
  it("should attach the provided hooks", () => {
    const wsHandler = defineWebSocketHandler(hooks);
    const res = wsHandler({} as any);
    expect(res).toBeInstanceOf(Response);
    expect((res as Response).status).toBe(426);
    // expect((res as Response).statusText).toBe("Upgrade Required");
    expect((res as any).crossws).toEqual(hooks);
  });

  it("should attach the provided hooks with function argument", () => {
    const wsHandler = defineWebSocketHandler(() => hooks);
    const res = wsHandler({} as any);
    expect(res).toBeInstanceOf(Response);
    expect((res as Response).status).toBe(426);
    // expect((res as Response).statusText).toBe("Upgrade Required");
    expect((res as any).crossws).toEqual(hooks);
  });

  it("should serve the http handler for non-upgrade requests", () => {
    const wsHandler = defineWebSocketHandler(hooks, () => "hello");
    const event = { req: new Request("http://localhost/") } as any;
    expect(wsHandler(event)).toBe("hello");
  });

  it("should attach hooks for upgrade requests even with an http handler", () => {
    const wsHandler = defineWebSocketHandler(hooks, () => "hello");
    const event = {
      req: new Request("http://localhost/", {
        headers: { connection: "Upgrade", upgrade: "websocket" },
      }),
    } as any;
    const res = wsHandler(event);
    expect(res).toBeInstanceOf(Response);
    expect((res as Response).status).toBe(426);
    expect((res as any).crossws).toEqual(hooks);
  });

  it("exposes crossws on the returned response without an `as any` cast (#1258)", () => {
    // Given a WebSocket handler defined via defineWebSocketHandler
    const wsHandler = defineWebSocketHandler(hooks);
    // When the handler is invoked in-process (as crossws adapters do internally)
    const res = wsHandler({} as any);
    // Then `res.crossws` is readable, typed, and is the exact hooks object
    expect(res.crossws).toBe(hooks);
  });
});
