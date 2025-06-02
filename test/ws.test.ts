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
});
