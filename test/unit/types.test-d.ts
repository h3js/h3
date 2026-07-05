import type { H3Event, WebSocketResponse } from "../../src/index.ts";
import { describe, it, expectTypeOf } from "vitest";
import {
  defineHandler,
  getQuery,
  readBody,
  readValidatedBody,
  getValidatedQuery,
  defineValidatedHandler,
  defineWebSocketHandler,
} from "../../src/index.ts";
import { defineEventHandler } from "../../src/_deprecated.ts";
import { z } from "zod";

describe("types", () => {
  describe("eventHandler", () => {
    it("return type (inferred)", () => {
      const handler = defineHandler(() => {
        return {
          foo: "bar",
        };
      });
      const response = handler({} as H3Event);
      expectTypeOf(response).toEqualTypeOf<{ foo: string }>();
    });
  });

  describe("readBody", () => {
    it("untyped", () => {
      defineHandler(async (event) => {
        const body = await readBody(event);
        expectTypeOf(body).toBeUnknown;
      });
    });

    it("typed via generic", () => {
      defineHandler(async (event) => {
        const body = await readBody<string>(event);
        expectTypeOf(body).not.toBeAny();
        expectTypeOf(body!).toBeString;
      });
    });

    it("typed via validator", () => {
      defineHandler(async (event) => {
        const validator = (body: unknown) => body as { id: string };
        const body = await readValidatedBody(event, validator);
        expectTypeOf(body).not.toBeAny();
        expectTypeOf(body).toEqualTypeOf<{ id: string }>;
      });
    });

    it("typed via event handler", () => {
      defineHandler<{ body: { id: string } }>(async (event) => {
        const body = await readBody(event);
        expectTypeOf(body).not.toBeAny();
        expectTypeOf(body).toEqualTypeOf<{ id: string } | undefined>();
      });
    });

    it("typed via validated event handler", () => {
      defineValidatedHandler({
        validate: {
          body: z.object({
            id: z.string(),
          }),
          headers: z.object({
            "x-thing": z.string(),
          }),
          query: z.object({
            search: z.string().optional(),
          }),
        },
        async handler(event) {
          const query = getQuery(event);
          expectTypeOf(query.search).not.toBeAny();
          expectTypeOf(query.search).toEqualTypeOf<string | undefined>();

          // TODO:
          // type PossibleParams = Parameters<typeof event.url.searchParams.get>[0]
          // expectTypeOf<PossibleParams>().toEqualTypeOf<(string & {}) | "search">();

          const value = await event.req.json();
          expectTypeOf(value).toEqualTypeOf<{ id: string }>();

          const body = await readBody(event);
          expectTypeOf(body).not.toBeAny();
          expectTypeOf(body).toEqualTypeOf<{ id: string } | undefined>();
        },
      });
    });
  });

  describe("getQuery", () => {
    it("untyped", () => {
      defineHandler((event) => {
        const query = getQuery(event);
        expectTypeOf(query).not.toBeAny();
        expectTypeOf(query).toEqualTypeOf<Partial<Record<string, string>>>();
      });
    });

    it("typed via generic", () => {
      defineHandler((event) => {
        const query = getQuery<{ id: string }>(event);
        expectTypeOf(query).not.toBeAny();
        expectTypeOf(query).toEqualTypeOf<{ id: string }>();
      });
    });

    it("typed via validator", () => {
      defineHandler(async (event) => {
        const validator = (body: unknown) => body as { id: string };
        const body = await getValidatedQuery(event, validator);
        expectTypeOf(body).not.toBeAny();
        expectTypeOf(body).toEqualTypeOf<{ id: string }>();
      });
    });

    it("typed via zod schema", () => {
      defineHandler(async (event) => {
        const query = await getValidatedQuery(
          event,
          z.object({
            search: z.string().optional(),
          }),
        );
        expectTypeOf(query).not.toBeAny();
        expectTypeOf(query).toEqualTypeOf<{ search?: string | undefined }>();
      });
    });

    it("typed via zod schema in defineEventHandler object", () => {
      defineEventHandler({
        async handler(event) {
          const query = await getValidatedQuery(
            event,
            z.object({
              search: z.string().optional(),
            }),
          );
          expectTypeOf(query).not.toBeAny();
          expectTypeOf(query).toEqualTypeOf<{ search?: string | undefined }>();
        },
      });
    });

    it("typed via event handler", () => {
      defineHandler<{ query: { id: string } }>((event) => {
        const query = getQuery(event);
        expectTypeOf(query).not.toBeAny();
        expectTypeOf(query).toEqualTypeOf<{ id: string }>();
      });
    });
  });

  describe("defineWebSocketHandler", () => {
    it("exposes crossws on the returned response type without a cast", () => {
      // https://github.com/h3js/h3/issues/1258
      // Given a WebSocket handler defined via defineWebSocketHandler
      const wsHandler = defineWebSocketHandler({ message: () => {} });
      // When the handler is invoked directly (as crossws adapters do)
      const res = wsHandler({} as H3Event);
      // Then `crossws` must be visible on the returned type, with no `as any` cast
      expectTypeOf(res).toHaveProperty("crossws");
    });

    it("still types the http fallback handler's return value", () => {
      // Given a WebSocket handler with an http fallback returning a string
      const wsHandler = defineWebSocketHandler({ message: () => {} }, () => "hello");
      const res = wsHandler({} as H3Event);
      // Then the returned type is the union of the WebSocket response
      // (with `crossws` visible) and the http handler's return type —
      // neither branch is widened away.
      expectTypeOf(res).toExtend<string | (Response & { crossws?: unknown })>();
      expectTypeOf(res).not.toBeUnknown();
    });

    it("types an async hooks factory's return value without a cast", async () => {
      // Given a WebSocket handler defined with an async hooks factory
      const wsHandler = defineWebSocketHandler(async (_event) => {
        await Promise.resolve();
        return { message: () => {} };
      });
      // When the handler is invoked directly (as crossws adapters do)
      const res = wsHandler({} as H3Event);
      // Then the return type must itself be the union of the sync response
      // and a Promise of it, not just `WebSocketResponse`. Otherwise
      // await-ing a sync-typed value would be a no-op and this assertion
      // would pass regardless of whether the factory was actually awaited.
      expectTypeOf(res).toEqualTypeOf<WebSocketResponse | Promise<WebSocketResponse>>();
      // And the resolved value still exposes `crossws` with no cast.
      const awaited = await res;
      expectTypeOf(awaited).toHaveProperty("crossws");
    });
  });
});
