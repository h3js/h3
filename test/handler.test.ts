import { describe, it, expect, vi } from "vitest";
import {
  toRequest,
  defineHandler,
  dynamicEventHandler,
  defineLazyEventHandler,
  defineValidatedHandler,
  getRouterParams,
  H3,
} from "../src/index.ts";
import type { ValidateIssues } from "../src/utils/internal/validate.ts";

import type { H3Event } from "../src/event.ts";
import { z } from "zod/v4";

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
          "x-token": z.string("Missing required header"),
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
    const handlerCustomError = defineValidatedHandler({
      validate: {
        body: z.object({
          name: z.string(),
          age: z.number().optional().default(20),
        }),
        headers: z.object({
          "x-token": z.string("Missing required header"),
        }),
        query: z.object({
          id: z.string().min(3),
        }),
        onError: ({ _source, issues }) => {
          return {
            status: 500,
            statusText: `Custom Zod ${_source} validation error`,
            message: summarize(issues),
          };
        },
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

    it("malformed JSON body", async () => {
      const res = await handler.fetch(
        toRequest("/?id=123", {
          method: "POST",
          headers: { "x-token": "abc" },
          body: "{ not json ",
        }),
      );
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({
        status: 400,
        message: "Invalid JSON body",
      });
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

    describe("custom error messages", () => {
      it("invalid body", async () => {
        const res = await handlerCustomError.fetch(
          toRequest("/?id=123", {
            method: "POST",
            headers: { "x-token": "abc" },
            body: JSON.stringify({ name: 123 }),
          }),
        );
        expect(await res.json()).toMatchObject({
          status: 500,
          statusText: "Custom Zod body validation error",
          message: "- Invalid input: expected string, received number",
        });
        expect(res.status).toBe(500);
      });

      it("invalid headers", async () => {
        const res = await handlerCustomError.fetch(
          toRequest("/?id=123", {
            method: "POST",
            body: JSON.stringify({ name: 123 }),
          }),
        );
        expect(await res.json()).toMatchObject({
          status: 500,
          statusText: "Custom Zod headers validation error",
          message: "- Missing required header",
        });
        expect(res.status).toBe(500);
      });

      it("invalid query", async () => {
        const res = await handlerCustomError.fetch(
          toRequest("/?id=", {
            method: "POST",
            headers: { "x-token": "abc" },
            body: JSON.stringify({ name: "tommy" }),
          }),
        );
        expect(await res.json()).toMatchObject({
          status: 500,
          statusText: "Custom Zod query validation error",
          message: "- Too small: expected string to have >=3 characters",
        });
        expect(res.status).toBe(500);
      });
    });

    describe("async validation", () => {
      const asyncHandler = defineValidatedHandler({
        validate: {
          body: z.object({
            name: z.string().refine(async (name) => name !== "banned", "Name is banned"),
          }),
          headers: z.object({
            "x-token": z.string().refine(async (token) => token.length >= 3, "Token too short"),
          }),
          query: z.object({
            id: z.string().refine(async (id) => id.length >= 3, "Id too short"),
          }),
        },
        handler: async (event) => {
          return { body: await event.req.json() };
        },
      });

      it("valid request", async () => {
        const res = await asyncHandler.fetch(
          toRequest("/?id=123", {
            method: "POST",
            headers: { "x-token": "abc" },
            body: JSON.stringify({ name: "tommy" }),
          }),
        );
        expect(res.status).toBe(200);
        expect(await res.json()).toMatchObject({ body: { name: "tommy" } });
      });

      it("invalid headers", async () => {
        const res = await asyncHandler.fetch(
          toRequest("/?id=123", {
            method: "POST",
            headers: { "x-token": "ab" },
            body: JSON.stringify({ name: "tommy" }),
          }),
        );
        expect(res.status).toBe(400);
        expect(await res.json()).toMatchObject({
          data: { issues: [{ path: ["x-token"], message: "Token too short" }] },
        });
      });

      it("invalid query", async () => {
        const res = await asyncHandler.fetch(
          toRequest("/?id=1", {
            method: "POST",
            headers: { "x-token": "abc" },
            body: JSON.stringify({ name: "tommy" }),
          }),
        );
        expect(res.status).toBe(400);
        expect(await res.json()).toMatchObject({
          data: { issues: [{ path: ["id"], message: "Id too short" }] },
        });
      });

      it("invalid body", async () => {
        const res = await asyncHandler.fetch(
          toRequest("/?id=123", {
            method: "POST",
            headers: { "x-token": "abc" },
            body: JSON.stringify({ name: "banned" }),
          }),
        );
        expect(res.status).toBe(400);
        expect(await res.json()).toMatchObject({
          data: { issues: [{ path: ["name"], message: "Name is banned" }] },
        });
      });
    });

    // Regression: async header validation must short-circuit query validation.
    // A racing `Promise.all` would run the query schema even when headers
    // already failed, and let its error win nondeterministically.
    describe("async validation ordering", () => {
      const querySpy = vi.fn(async (id: string) => id.length >= 3);
      const orderingHandler = defineValidatedHandler({
        validate: {
          body: z.object({ name: z.string() }),
          headers: z.object({
            "x-token": z.string().refine(async (token) => token.length >= 3, "Token too short"),
          }),
          query: z.object({
            id: z.string().refine(querySpy, "Id too short"),
          }),
        },
        handler: async () => "ok",
      });

      it("runs query validation once headers pass", async () => {
        querySpy.mockClear();
        const res = await orderingHandler.fetch(
          toRequest("/?id=123", { headers: { "x-token": "abc" } }),
        );
        expect(res.status).toBe(200);
        expect(querySpy).toHaveBeenCalled();
      });

      it("skips query validation and reports the headers error when headers fail", async () => {
        querySpy.mockClear();
        const res = await orderingHandler.fetch(
          // query would also be invalid, yet the headers error must surface
          toRequest("/?id=1", { headers: { "x-token": "ab" } }),
        );
        expect(res.status).toBe(400);
        expect(await res.json()).toMatchObject({
          data: { issues: [{ path: ["x-token"], message: "Token too short" }] },
        });
        expect(querySpy).not.toHaveBeenCalled();
      });
    });

    describe("params validation", () => {
      // `defineValidatedHandler`'s TypedRequest return type isn't assignable to `app.get` (pre-exisitng)
      const mount = (route: string, handler: unknown) => new H3().get(route, handler as any);

      const paramsHandler = defineValidatedHandler({
        validate: {
          params: z.object({
            id: z.string().min(3),
            role: z.string().default("user"),
          }),
        },
        handler: (event) => getRouterParams(event),
      });

      it("valid params, validated output written back to context", async () => {
        const app = mount("/users/:id", paramsHandler);
        const res = await app.request("/users/123");
        expect(res.status).toBe(200);
        // the `role` default proves the validated output lands in context.params
        expect(await res.json()).toMatchObject({ id: "123", role: "user" });
      });

      it("invalid params", async () => {
        const app = mount("/users/:id", paramsHandler);
        const res = await app.request("/users/1");
        expect(res.status).toBe(400);
        expect(await res.json()).toMatchObject({
          data: { issues: [{ path: ["id"] }] },
        });
      });

      // The schema output replaces `context.params` entirely: params it strips
      // are intentionally dropped so non-validated data never leaks through.
      it("drops router params stripped by the schema", async () => {
        const partialHandler = defineValidatedHandler({
          validate: {
            params: z.object({ id: z.string().min(3) }),
          },
          handler: (event) => getRouterParams(event),
        });
        const app = mount("/users/:id/posts/:postId", partialHandler);
        const res = await app.request("/users/123/posts/456");
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ id: "123" });
      });

      it("keeps extra router params with a loose schema", async () => {
        const looseHandler = defineValidatedHandler({
          validate: {
            params: z.looseObject({ id: z.string().min(3) }),
          },
          handler: (event) => getRouterParams(event),
        });
        const app = mount("/users/:id/posts/:postId", looseHandler);
        const res = await app.request("/users/123/posts/456");
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ id: "123", postId: "456" });
      });

      describe("decode", () => {
        const decodeHandler = defineValidatedHandler({
          validate: {
            params: z.object({ name: z.literal("foo@bar") }),
            decodeParams: true,
          },
          handler: (event) => getRouterParams(event),
        });
        const noDecodeHandler = defineValidatedHandler({
          validate: { params: z.object({ name: z.literal("foo@bar") }) },
          handler: (event) => getRouterParams(event),
        });

        it("decodes params before validation when decode:true", async () => {
          const app = mount("/files/:name", decodeHandler);
          const res = await app.request("/files/foo%40bar");
          expect(res.status).toBe(200);
          expect(await res.json()).toMatchObject({ name: "foo@bar" });
        });

        it("leaves params encoded by default", async () => {
          const app = mount("/files/:name", noDecodeHandler);
          const res = await app.request("/files/foo%40bar");
          expect(res.status).toBe(400);
        });
      });

      describe("async", () => {
        const headerSpy = vi.fn(async (token: string) => token.length >= 3);
        const asyncParamsHandler = defineValidatedHandler({
          validate: {
            params: z.object({
              id: z.string().refine(async (id) => id.length >= 3, "Id too short"),
            }),
            headers: z.object({
              "x-token": z.string().refine(headerSpy, "Token too short"),
            }),
          },
          handler: async () => "ok",
        });

        it("validates async params", async () => {
          headerSpy.mockClear();
          const app = mount("/users/:id", asyncParamsHandler);
          const res = await app.request("/users/1", { headers: { "x-token": "abc" } });
          expect(res.status).toBe(400);
          expect(await res.json()).toMatchObject({
            data: { issues: [{ path: ["id"], message: "Id too short" }] },
          });
        });

        it("short-circuits header validation when params fail", async () => {
          headerSpy.mockClear();
          const app = mount("/users/:id", asyncParamsHandler);
          // header would also be invalid, yet params validation runs first
          const res = await app.request("/users/1", { headers: { "x-token": "ab" } });
          expect(res.status).toBe(400);
          expect(await res.json()).toMatchObject({
            data: { issues: [{ path: ["id"], message: "Id too short" }] },
          });
          expect(headerSpy).not.toHaveBeenCalled();
        });
      });
    });
  });
});

/**
 * Fork of valibot's `summarize` function.
 *
 * LICENSE: MIT
 * SOURCE: https://github.com/fabian-hiller/valibot/blob/44b2e6499562e19d0a66ade1e25e44087e0d2c16/library/src/methods/summarize/summarize.ts
 */
function summarize(issues: ValidateIssues): string {
  let summary = "";

  for (const issue of issues) {
    if (summary) {
      summary += "\n";
    }

    summary += `- ${issue.message}`;
  }

  return summary;
}
