import type { ValidateFunction } from "../src/utils/internal/validate.ts";
import { beforeEach } from "vitest";
import { z } from "zod";
import {
  readValidatedBody,
  getValidatedQuery,
  getValidatedRouterParams,
} from "../src/index.ts";
import { describeMatrix } from "./_setup.ts";

describeMatrix("validate", (t, { it, describe, expect }) => {
  // Custom validator
  const customValidate: ValidateFunction<{
    invalidKey: never;
    default: string;
    field?: string;
  }> = (data: any) => {
    if (data.invalid) {
      throw new Error("Invalid key");
    }
    data.default = "default";
    return data;
  };

  // Zod validator (example)
  const zodValidate = z.object({
    default: z.string().default("default"),
    field: z.string().optional(),
    invalid: z.never().optional(),
  });

  describe("readValidatedBody", () => {
    beforeEach(() => {
      t.app.post("/custom", async (event) => {
        const data = await readValidatedBody(event, customValidate);
        return data;
      });

      t.app.post("/zod", async (event) => {
        const data = await readValidatedBody(event, zodValidate);
        return data;
      });
    });

    describe("custom validator", () => {
      it("Valid JSON", async () => {
        const res = await t.fetch("/custom", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ field: "value" }),
        });
        expect(await res.json()).toEqual({
          field: "value",
          default: "default",
        });
        expect(res.status).toEqual(200);
      });

      it("Validate x-www-form-urlencoded", async () => {
        const res = await t.fetch("/custom", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: "field=value",
        });
        expect(await res.json()).toEqual({
          field: "value",
          default: "default",
        });
        expect(res.status).toEqual(200);
      });

      it("Invalid JSON", async () => {
        const res = await t.fetch("/custom", {
          method: "POST",
          body: JSON.stringify({ invalid: true }),
        });
        expect(await res.text()).include("Invalid key");
        expect(res.status).toEqual(400);
      });
    });

    describe("zod validator", () => {
      it("Valid", async () => {
        const res = await t.fetch("/zod", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ field: "value" }),
        });
        expect(await res.json()).toEqual({
          field: "value",
          default: "default",
        });
        expect(res.status).toEqual(200);
      });

      it("Invalid", async () => {
        const res = await t.fetch("/zod", {
          method: "POST",
          body: JSON.stringify({ invalid: true }),
        });
        expect(res.status).toEqual(400);
        expect((await res.json()).data?.issues?.[0]?.code).toEqual(
          "invalid_type",
        );
      });

      it("Caught", async () => {
        const res = await t.fetch("/zod", {
          method: "POST",
          body: JSON.stringify({ invalid: true }),
        });
        expect(res.status).toEqual(400);
        expect(await res.json()).toMatchObject({
          data: {
            message: "Validation failed",
            issues: [
              {
                code: "invalid_type",
              },
            ],
          },
        });
      });
    });
  });

  describe("getQuery", () => {
    beforeEach(() => {
      t.app.get("/custom", async (event) => {
        const data = await getValidatedQuery(event, customValidate);
        return data;
      });

      t.app.get("/zod", async (event) => {
        const data = await getValidatedQuery(event, zodValidate);
        return data;
      });
    });

    describe("custom validator", () => {
      it("Valid", async () => {
        const res = await t.fetch("/custom?field=value");
        expect(await res.json()).toEqual({
          field: "value",
          default: "default",
        });
        expect(res.status).toEqual(200);
      });

      it("Invalid", async () => {
        const res = await t.fetch("/custom?invalid=true");
        expect(await res.text()).include("Invalid key");
        expect(res.status).toEqual(400);
      });
    });

    describe("zod validator", () => {
      it("Valid", async () => {
        const res = await t.fetch("/zod?field=value");
        expect(await res.json()).toEqual({
          field: "value",
          default: "default",
        });
        expect(res.status).toEqual(200);
      });

      it("Invalid", async () => {
        const res = await t.fetch("/zod?invalid=true");
        expect(res.status).toEqual(400);
      });
    });
  });

  describe("getRouterParams", () => {
    const REGEX_NUMBER_STRING = /^-?(?:\d+(?:\.\d+)?|\.\d+)$/;

    // Custom validator
    const customParamValidate: ValidateFunction<{
      id: number;
    }> = (data: any) => {
      if (
        !data.id ||
        typeof data.id !== "string" ||
        !REGEX_NUMBER_STRING.test(data.id)
      ) {
        throw new Error("Invalid id");
      }
      return {
        id: Number(data.id),
      };
    };

    // Zod validator (example)
    const zodParamValidate = z.object({
      id: z
        .string()
        .regex(REGEX_NUMBER_STRING, "Must be a number string")
        .transform(Number),
    });

    beforeEach(() => {
      t.app.get("/custom/:id", async (event) => {
        const data = await getValidatedRouterParams(event, customParamValidate);
        return data;
      });

      t.app.get("/zod/:id", async (event) => {
        const data = await getValidatedRouterParams(event, zodParamValidate);
        return data;
      });
    });

    describe("custom validator", () => {
      it("Valid", async () => {
        const res = await t.fetch("/custom/123");
        expect(await res.json()).toEqual({
          id: 123,
        });
        expect(res.status).toEqual(200);
      });

      it("Invalid", async () => {
        const res = await t.fetch("/custom/abc");
        expect(await res.text()).include("Invalid id");
        expect(res.status).toEqual(400);
      });
    });

    describe("zod validator", () => {
      it("Valid", async () => {
        const res = await t.fetch("/zod/123");
        expect(await res.json()).toEqual({
          id: 123,
        });
        expect(res.status).toEqual(200);
      });

      it("Invalid", async () => {
        const res = await t.fetch("/zod/abc");
        expect(res.status).toEqual(400);
      });
    });
  });
});
