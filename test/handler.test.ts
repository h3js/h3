import { describe, it, expect, vi } from "vitest";
import {
  toRequest,
  defineHandler,
  dynamicEventHandler,
  defineLazyEventHandler,
  defineValidatedHandler,
} from "../src/index.ts";

import type { H3Event } from "../src/event.ts";
import { z } from "zod";

describe("handler.ts", () => {
  describe("defineHandler", () => {
    it("should return the handler function when passed a function", () => {
      const handler = vi.fn();
      const eventHandler = defineHandler(handler);
      expect(eventHandler).toBe(handler);
    });

    it("object syntax (h3 handler)", () => {
      const handler = vi.fn();
      const middleware = [vi.fn()];
      const eventHandler = defineHandler({ handler, middleware });
      eventHandler({} as H3Event);
      expect(middleware[0]).toHaveBeenCalled();
      expect(handler).toHaveBeenCalled();
    });

    it("object syntax (fetchable)", () => {
      const fetchHandler = vi.fn();
      const middleware = [vi.fn()];
      const eventHandler = defineHandler({ fetch: fetchHandler, middleware });
      eventHandler({} as H3Event);
      expect(eventHandler.fetch).toBe(fetchHandler);
      expect(middleware[0]).toHaveBeenCalled();
      expect(fetchHandler).toHaveBeenCalled();
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

    it("should call the initial handler if set (fetchable)", async () => {
      const initialHandler = vi.fn(() => new Response("initial"));
      const dynamicHandler = dynamicEventHandler(initialHandler);

      const mockEvent = {} as H3Event;
      const result = await dynamicHandler(mockEvent);

      expect(initialHandler).toHaveBeenCalledWith(mockEvent);
      expect(result).toBeInstanceOf(Response);
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

    it("should resolve and call the lazy-loaded handler (fetchable)", async () => {
      const lazyHandler = vi.fn(async (_req: Request) => new Response("lazy"));
      const load = vi.fn(() => Promise.resolve({ fetch: lazyHandler }));
      const lazyEventHandler = defineLazyEventHandler(load);

      const mockEvent = {} as H3Event;
      const result = await lazyEventHandler(mockEvent);

      expect(load).toHaveBeenCalled();
      expect(lazyHandler).toHaveBeenCalled();
      expect(result).toBeInstanceOf(Response);
    });

    it("should throw an error if the lazy-loaded handler is invalid", async () => {
      const mod = { test: 123 };
      const load = vi.fn(() => Promise.resolve(mod));
      const lazyEventHandler = defineLazyEventHandler(load as any);
      const mockEvent = {} as H3Event;
      const promise = lazyEventHandler(mockEvent);
      await expect(promise).rejects.toThrowError("Invalid lazy handler");
      await expect(promise).rejects.toMatchObject({ cause: { resolved: mod } });
    });
  });

  describe("defineValidatedHandler", () => {
    const handler = defineValidatedHandler({
      validate: {
        body: z.object({
          name: z.string(),
          age: z.number().optional().default(20),
        }),
        headers: z.object({
          "x-token": z.string(),
        }),
        query: z.object({
          id: z.string().min(3),
        }),
      },
      handler: async (event) => {
        return {
          body: await event.req.json(),
          headers: event.req.headers,
        };
      },
    });

    it("valid request", async () => {
      const res = await handler.fetch(
        toRequest("/?id=123", {
          method: "POST",
          headers: { "x-token": "abc" },
          body: JSON.stringify({ name: "tommy" }),
        }),
      );
      // expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({
        body: { name: "tommy", age: 20 },
        headers: {},
      });
    });

    it("invalid body", async () => {
      const res = await handler.fetch(
        toRequest("/?id=123", {
          method: "POST",
          headers: { "x-token": "abc" },
          body: JSON.stringify({ name: 123 }),
        }),
      );
      expect(await res.json()).toMatchObject({
        status: 400,
        statusText: "Validation failed",
        message: "Validation failed",
        data: { issues: [{ expected: "string" }] },
      });
      expect(res.status).toBe(400);
    });

    it("invalid headers", async () => {
      const res = await handler.fetch(
        toRequest("/?id=123", {
          method: "POST",
          body: JSON.stringify({ name: 123 }),
        }),
      );
      expect(await res.json()).toMatchObject({
        status: 400,
        statusText: "Validation failed",
        message: "Validation failed",
        data: {
          issues: [{ path: ["x-token"], expected: "string" }],
        },
      });
      expect(res.status).toBe(400);
    });

    it("invalid query", async () => {
      const res = await handler.fetch(
        toRequest("/?id=", {
          method: "POST",
          headers: { "x-token": "abc" },
          body: JSON.stringify({ name: "tommy" }),
        }),
      );
      expect(await res.json()).toMatchObject({
        status: 400,
        statusText: "Validation failed",
        message: "Validation failed",
        data: {
          issues: [
            {
              path: ["id"],
              message: "Too small: expected string to have >=3 characters",
            },
          ],
        },
      });
      expect(res.status).toBe(400);
    });
  });
});
