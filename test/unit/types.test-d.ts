import type { H3Event } from "../../src/index.ts";
import { describe, it, expectTypeOf } from "vitest";
import {
  defineHandler,
  defineRoute,
  type RouteDefinition,
  getQuery,
  readBody,
  readValidatedBody,
  getValidatedQuery,
  defineValidatedHandler,
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

  describe("route", () => {
    it("typed via route definition", () => {
      const params = z.object({
        id: z.string(),
      });
      const body = z.object({
        title: z.string(),
      });
      const query = z.object({
        search: z.string().optional(),
      });
      const response = z.object({
        id: z.string(),
        title: z.string(),
      });

      const route = {
        method: "POST",
        route: "/:id",
        validate: {
          params,
          body,
          query,
          response,
          onError: ({ _source }: { _source?: string }) => ({
            message: _source,
          }),
        },
        async handler(event) {
          expectTypeOf(event.context.params?.id).toEqualTypeOf<string | undefined>();

          const queryValue = getQuery(event);
          expectTypeOf(queryValue.search).toEqualTypeOf<string | undefined>();

          const requestBody = await event.req.json();
          expectTypeOf(requestBody).toEqualTypeOf<{ title: string }>();

          return {
            id: event.context.params!.id,
            title: requestBody.title,
          };
        },
      } satisfies RouteDefinition<{
        params: typeof params;
        body: typeof body;
        query: typeof query;
        response: typeof response;
      }>;

      defineRoute(route);
    });
  });
});
