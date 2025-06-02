/* eslint-disable @typescript-eslint/no-unused-expressions */
import type { H3Event } from "../../src/index.ts";
import { describe, it, expectTypeOf } from "vitest";
import {
  defineEventHandler,
  getQuery,
  readBody,
  readValidatedBody,
  getValidatedQuery,
} from "../../src/index.ts";

describe("types", () => {
  describe("eventHandler", () => {
    it("return type (inferred)", () => {
      const handler = defineEventHandler(() => {
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
      defineEventHandler(async (event) => {
        const body = await readBody(event);
        expectTypeOf(body).toBeUnknown;
      });
    });

    it("typed via generic", () => {
      defineEventHandler(async (event) => {
        const body = await readBody<string>(event);
        expectTypeOf(body).not.toBeAny;
        expectTypeOf(body!).toBeString;
      });
    });

    it("typed via validator", () => {
      defineEventHandler(async (event) => {
        const validator = (body: unknown) => body as { id: string };
        const body = await readValidatedBody(event, validator);
        expectTypeOf(body).not.toBeAny;
        expectTypeOf(body).toEqualTypeOf<{ id: string }>;
      });
    });

    it("typed via event handler", () => {
      defineEventHandler<{ body: { id: string } }>(async (event) => {
        const body = await readBody(event);
        expectTypeOf(body).not.toBeAny;
        expectTypeOf(body).toEqualTypeOf<{ id: string } | undefined>();
      });
    });
  });

  describe("getQuery", () => {
    it("untyped", () => {
      defineEventHandler((event) => {
        const query = getQuery(event);
        expectTypeOf(query).not.toBeAny;
        expectTypeOf(query).toEqualTypeOf<Record<string, string>>();
      });
    });

    it("typed via generic", () => {
      defineEventHandler((event) => {
        const query = getQuery<{ id: string }>(event);
        expectTypeOf(query).not.toBeAny;
        expectTypeOf(query).toEqualTypeOf<{ id: string }>();
      });
    });

    it("typed via validator", () => {
      defineEventHandler(async (event) => {
        const validator = (body: unknown) => body as { id: string };
        const body = await getValidatedQuery(event, validator);
        expectTypeOf(body).not.toBeAny;
        expectTypeOf(body).toEqualTypeOf<{ id: string }>();
      });
    });

    it("typed via event handler", () => {
      defineEventHandler<{ query: { id: string } }>((event) => {
        const query = getQuery(event);
        expectTypeOf(query).not.toBeAny;
        expectTypeOf(query).toEqualTypeOf<{ id: string }>();
      });
    });
  });
});
