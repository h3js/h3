import { describe, it, expect, vi } from "vitest";
import type { H3Event } from "../src/types";
import {
  defineEventHandler,
  defineRequestMiddleware,
  defineResponseMiddleware,
  dynamicEventHandler,
  defineLazyEventHandler,
} from "../src/handler";

describe("handler.ts", () => {
  describe("defineEventHandler", () => {
    it("should return the handler function when passed a function", () => {
      const handler = vi.fn();
      const eventHandler = defineEventHandler(handler);
      expect(eventHandler).toBe(handler);
    });

    it("should return an object handler when passed an object", async () => {
      const handler = vi.fn(async (_: H3Event) => "response");
      const onRequest = vi.fn();
      const onBeforeResponse = vi.fn();
      const eventHandler = defineEventHandler({
        handler,
        onRequest: [onRequest],
        onBeforeResponse: [onBeforeResponse],
      });

      const mockEvent = {} as H3Event;
      const result = await eventHandler(mockEvent);

      expect(onRequest).toHaveBeenCalledWith(mockEvent);
      expect(handler).toHaveBeenCalledWith(mockEvent);
      expect(onBeforeResponse).toHaveBeenCalledWith(mockEvent, {
        body: "response",
      });
      expect(result).toBe("response");
    });
  });

  describe("defineRequestMiddleware", () => {
    it("should return the same middleware function", () => {
      const middleware = vi.fn();
      const result = defineRequestMiddleware(middleware);
      expect(result).toBe(middleware);
    });
  });

  describe("defineResponseMiddleware", () => {
    it("should return the same middleware function", () => {
      const middleware = vi.fn();
      const result = defineResponseMiddleware(middleware);
      expect(result).toBe(middleware);
    });
  });

  describe("dynamicEventHandler", () => {
    it("should call the initial handler if set", async () => {
      const initialHandler = vi.fn(async (_: H3Event) => "initial");
      const dynamicHandler = dynamicEventHandler(initialHandler);

      const mockEvent = {} as H3Event;
      const result = await dynamicHandler(mockEvent);

      expect(initialHandler).toHaveBeenCalledWith(mockEvent);
      expect(result).toBe("initial");
    });

    it("should allow setting a new handler", async () => {
      const initialHandler = vi.fn(async (_: H3Event) => "initial");
      const newHandler = vi.fn(async (_: H3Event) => "new");
      const dynamicHandler = dynamicEventHandler(initialHandler);

      dynamicHandler.set(newHandler);

      const mockEvent = {} as H3Event;
      const result = await dynamicHandler(mockEvent);

      expect(newHandler).toHaveBeenCalledWith(mockEvent);
      expect(result).toBe("new");
    });
  });

  describe("defineLazyEventHandler", () => {
    it("should resolve and call the lazy-loaded handler", async () => {
      const lazyHandler = vi.fn(async (_: H3Event) => "lazy");
      const load = vi.fn(() => Promise.resolve(lazyHandler));
      const lazyEventHandler = defineLazyEventHandler(load);

      const mockEvent = {} as H3Event;
      const result = await lazyEventHandler(mockEvent);

      expect(load).toHaveBeenCalled();
      expect(lazyHandler).toHaveBeenCalledWith(mockEvent);
      expect(result).toBe("lazy");
    });

    it("should throw an error if the lazy-loaded handler is invalid", async () => {
      const load = vi.fn(() => Promise.resolve({}));
      const lazyEventHandler = defineLazyEventHandler(load as any);

      const mockEvent = {} as H3Event;

      await expect(lazyEventHandler(mockEvent)).rejects.toThrow(
        "Invalid lazy handler result. It should be a function:",
      );
    });
  });
});
