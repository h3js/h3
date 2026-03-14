import type { H3Event, ExtractRouteParams } from "../../src/index.ts";
import { describe, it, expectTypeOf } from "vitest";
import {
  H3,
  defineHandler,
  getQuery,
  getRouterParams,
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

  describe("ExtractRouteParams", () => {
    it("extracts single param", () => {
      expectTypeOf<ExtractRouteParams<"/users/:id">>().toEqualTypeOf<{
        id: string;
      }>();
    });

    it("extracts multiple params", () => {
      expectTypeOf<ExtractRouteParams<"/users/:id/posts/:slug">>().toEqualTypeOf<{
        id: string;
        slug: string;
      }>();
    });

    it("returns Record<string, string> for no params", () => {
      expectTypeOf<ExtractRouteParams<"/users">>().toEqualTypeOf<Record<string, string>>();
    });
  });

  describe("route param inference", () => {
    it("infers params from app.get path", () => {
      const app = new H3();
      app.get("/users/:id", (event) => {
        const params = getRouterParams(event);
        expectTypeOf(params).toEqualTypeOf<{ id: string }>();
      });
    });

    it("infers multiple params from app.post path", () => {
      const app = new H3();
      app.post("/users/:userId/posts/:postId", (event) => {
        const params = getRouterParams(event);
        expectTypeOf(params).toEqualTypeOf<{
          userId: string;
          postId: string;
        }>();
      });
    });

    it("infers Record<string, string> for static route", () => {
      const app = new H3();
      app.get("/users", (event) => {
        const params = getRouterParams(event);
        expectTypeOf(params).toEqualTypeOf<Record<string, string>>();
      });
    });
  });
});
