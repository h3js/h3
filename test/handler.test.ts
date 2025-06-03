import { describe, it, expect, vi } from "vitest";
import {
  defineEventHandler,
  dynamicEventHandler,
  defineLazyEventHandler,
} from "../src/index.ts";

import type { H3Event } from "../src/types/event.ts";

describe("handler.ts", () => {
  describe("defineEventHandler", () => {
    it("should return the handler function when passed a function", () => {
      const handler = vi.fn();
      const eventHandler = defineEventHandler(handler);
      expect(eventHandler).toBe(handler);
    });

    it("object syntax", () => {
      const handler = vi.fn();
      const middleware = [vi.fn()];
      const eventHandler = defineEventHandler({ handler, middleware });
      eventHandler({} as H3Event);
      expect(middleware[0]).toHaveBeenCalled();
      expect(handler).toHaveBeenCalled();
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
