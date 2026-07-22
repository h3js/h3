import type {
  H3Event,
  H3EventContext,
  EventHandlerRequest,
  RouteRules,
  WebSocketResponse,
} from "../../src/index.ts";
import { describe, it, expectTypeOf } from "vitest";
import {
  defineHandler,
  getQuery,
  getRouterParams,
  getRouterParam,
  readBody,
  readValidatedBody,
  getValidatedQuery,
  defineValidatedHandler,
  defineWebSocketHandler,
} from "../../src/index.ts";
import {
  appendHeaders,
  appendResponseHeaders,
  defineEventHandler,
  sendRedirect,
} from "../../src/_deprecated.ts";
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
          params: z.object({
            userId: z.string(),
            n: z.coerce.number(),
          }),
        },
        async handler(event) {
          const query = getQuery(event);
          expectTypeOf(query.search).not.toBeAny();
          expectTypeOf(query.search).toEqualTypeOf<string | undefined>();

          // params carry the FULL coerced schema output (core-typed, not StringsOnly)
          const params = getRouterParams(event);
          expectTypeOf(params).not.toBeAny();
          expectTypeOf(params).toEqualTypeOf<{ userId: string; n: number }>();

          // direct context access is coerced AND required: validation guarantees
          // `context.params` is set before the handler runs, so no `?.` needed
          expectTypeOf(event.context.params).toEqualTypeOf<{ userId: string; n: number }>();

          // non-overridden context fields keep their base types
          expectTypeOf(event.context.clientAddress).toEqualTypeOf<string | undefined>();

          // singular helper is coerced and key-checked
          expectTypeOf(getRouterParam(event, "n")).toEqualTypeOf<number | undefined>();
          expectTypeOf(getRouterParam(event, "userId")).toEqualTypeOf<string | undefined>();

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

    it("non-validated handler keeps Record<string, string> defaults", () => {
      defineHandler((event) => {
        expectTypeOf(getRouterParams(event)).toEqualTypeOf<Record<string, string>>();
        expectTypeOf(getRouterParam(event, "x")).toEqualTypeOf<string | undefined>();
        // explicit generic override wins, mirroring getQuery
        expectTypeOf(getRouterParams<{ custom: string }>(event)).toEqualTypeOf<{
          custom: string;
        }>();
      });
    });

    it("H3Event's second generic types the whole context (no `declare module` needed)", () => {
      type MyContext = H3EventContext & { user: { id: number } };
      const event = {} as H3Event<EventHandlerRequest, MyContext>;
      expectTypeOf(event.context.user).toEqualTypeOf<{ id: number }>();
      // built-in context fields still typed as before
      expectTypeOf(event.context.params).toEqualTypeOf<Record<string, string> | undefined>();
    });

    it("`declare module` augmentation reaches plain and validated contexts", () => {
      defineHandler((event) => {
        expectTypeOf(event.context.augmentedUser).toEqualTypeOf<{ id: number } | undefined>();
      });
      defineValidatedHandler({
        validate: { params: z.object({ id: z.string() }) },
        // TypedH3EventContext is a mapped view — augmented fields must pass through
        handler: (event) => {
          expectTypeOf(event.context.augmentedUser).toEqualTypeOf<{ id: number } | undefined>();
          expectTypeOf(event.context.params).toEqualTypeOf<{ id: string }>();
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

// Route rules are declared empty by h3 and filled in by modules
// (`h3-rules`, Nitro, ...) through declaration merging.
declare module "../../src/index.ts" {
  interface RouteRules {
    swr?: number | boolean;
  }
  // Ecosystem invariant (nitro/nuxt-style): H3EventContext must stay augmentable.
  interface H3EventContext {
    augmentedUser?: { id: number };
  }
}

describe("routeRules", () => {
  it("augmented keys merge into the interface used by the event context", () => {
    defineHandler((event) => {
      // The augmentation reaches `RouteRules` through h3's re-export, so the
      // key keeps its declared type rather than widening to `any`/`unknown`.
      expectTypeOf(event.context.routeRules?.swr).toEqualTypeOf<number | boolean | undefined>();
    });
  });

  it("stays closed for keys nobody declared", () => {
    defineHandler((event) => {
      // @ts-expect-error unknown rule keys are a compile error until augmented
      event.context.routeRules?.notDeclaredAnywhere;
    });
  });

  it("exposes matched rules as readonly", () => {
    defineHandler((event) => {
      // Matchers are typically memoized, so a matched object can be shared
      // between requests. Rules are readonly even though augmenters declare
      // their keys as mutable.
      // @ts-expect-error matched rules must not be mutated in place
      event.context.routeRules.swr = 60;
    });
  });

  it("allows replacing the whole object", () => {
    defineHandler((event) => {
      // How rule modules attach matched rules (see Nitro's generated middleware).
      event.context.routeRules = {} as RouteRules;
    });
  });
});

describe("deprecated v1 signatures", () => {
  // The v1 signature took a headers record; the implementation still iterates one
  // with `Object.entries`, so the declared `string` makes the export uncallable.
  it("appendResponseHeaders takes a headers record", () => {
    expectTypeOf(appendResponseHeaders).toBeCallableWith({} as H3Event, { "x-foo": "bar" });
    expectTypeOf(appendHeaders).toBeCallableWith({} as H3Event, { "x-foo": "bar" });
  });

  // v1 defaulted to 302 and the delegated `redirect()` still does, so the status is optional.
  it("sendRedirect leaves the status code optional", () => {
    expectTypeOf(sendRedirect).toBeCallableWith({} as H3Event, "/target");
  });
});
