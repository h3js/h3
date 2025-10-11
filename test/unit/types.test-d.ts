/* eslint-disable @typescript-eslint/no-unused-expressions */
import type { H3Event } from "../../src/index.ts";
import { describe, it, expectTypeOf } from "vitest";
import {
  defineHandler,
  getQuery,
  readBody,
  readValidatedBody,
  getValidatedQuery,
  defineValidatedHandler,
  getRouterParams,
  getRouterParam,
} from "../../src/index.ts";
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

    it("typed via event handler", () => {
      defineHandler<{ query: { id: string } }>((event) => {
        const query = getQuery(event);
        expectTypeOf(query).not.toBeAny();
        expectTypeOf(query).toEqualTypeOf<{ id: string }>();
      });
    });
  });

  describe("routerParams inference", () => {
    it("should infer router params from EventHandlerRequest (non-optional)", () => {
      defineHandler<{
        routerParams: { id: string; name: string };
      }>((event) => {
        expectTypeOf(event.context.params).toEqualTypeOf<{
          id: string;
          name: string;
        }>();
        expectTypeOf(event.context.params.id).toEqualTypeOf<string>();
        expectTypeOf(event.context.params.name).toEqualTypeOf<string>();
      });
    });

    it("should default to optional Record<string, string> when no routerParams specified", () => {
      defineHandler((event) => {
        expectTypeOf(event.context.params).toEqualTypeOf<
          Record<string, string> | undefined
        >();
      });
    });

    it("should work with specific param types (non-optional)", () => {
      defineHandler<{
        routerParams: { userId: string; postId: string };
      }>((event) => {
        const userId = event.context.params.userId;
        const postId = event.context.params.postId;
        expectTypeOf(userId).toEqualTypeOf<string>();
        expectTypeOf(postId).toEqualTypeOf<string>();
      });
    });

    it("should work with getRouterParams helper", () => {
      defineHandler<{
        routerParams: { id: string; slug: string };
      }>((event) => {
        const params = getRouterParams(event);
        expectTypeOf(params).toEqualTypeOf<{ id: string; slug: string }>();
        expectTypeOf(params.id).toEqualTypeOf<string>();
        expectTypeOf(params.slug).toEqualTypeOf<string>();
      });
    });

    it("should work with getRouterParam helper", () => {
      defineHandler<{
        routerParams: { id: string; slug: string };
      }>((event) => {
        const id = getRouterParam(event, "id");
        const slug = getRouterParam(event, "slug");
        expectTypeOf(id).toEqualTypeOf<string>();
        expectTypeOf(slug).toEqualTypeOf<string>();
      });
    });

    it("getRouterParam should provide autocomplete for param keys", () => {
      defineHandler<{
        routerParams: { userId: string; postId: string };
      }>((event) => {
        // This should only allow "userId" | "postId" as the second parameter
        const userId = getRouterParam(event, "userId");
        expectTypeOf(userId).toEqualTypeOf<string>();
      });
    });
  });
});
