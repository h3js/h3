import { describe, it, expect, vi } from "vitest";
import { defineWebSocket, defineWebSocketHandler } from "../src/utils/ws";
import { defineEventHandler } from "../src/handler";
import { createError } from "../src/error";

vi.mock("../src/handler", () => ({
  defineEventHandler: vi.fn(),
}));

vi.mock("../src/error", () => ({
  createError: vi.fn(),
}));

describe("defineWebSocket", () => {
  it("should return the provided hooks", () => {
    const hooks = { onConnection: vi.fn() };
    const result = defineWebSocket(hooks);
    expect(result).toEqual(hooks);
  });
});

describe("defineWebSocketHandler", () => {
  it("should call defineEventHandler with the correct arguments", () => {
    const hooks = { onConnection: vi.fn() };
    const mockError = {
      statusCode: 426,
      statusMessage: "Upgrade Required",
      expected: "undefined",
      actual: "undefined",
      stacks: [],
    };
    (createError as any).mockReturnValue(mockError);

    defineWebSocketHandler(hooks);

    expect(defineEventHandler).toHaveBeenCalledWith({
      handler: expect.any(Function),
      websocket: hooks,
    });
  });
});
