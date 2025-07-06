import type {
  ValidateFunction,
  ValidateIssues,
} from "../src/utils/internal/validate.ts";
import { beforeEach } from "vitest";
import { z } from "zod/v4";
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
  const customValidateWithoutError: ValidateFunction<{
    invalidKey: never;
    default: string;
    field?: string;
  }> = (data: any) => {
    if (data.invalid) {
      return false;
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

      t.app.post("/custom-error", async (event) => {
        const data = await readValidatedBody(
          event,
          customValidateWithoutError,
          {
            onError() {
              return {
                status: 500,
                statusText: "Custom validation error",
              };
            },
          },
        );

        return data;
      });

      t.app.post("/custom-error-zod", async (event) => {
        const data = await readValidatedBody(event, zodValidate, {
          onError: (issues) => ({
            status: 500,
            statusText: "Custom Zod validation error",
            message: summarize(issues),
          }),
        });

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

    describe("custom error", () => {
      it("Custom error message", async () => {
        const res = await t.fetch("/custom-error", {
          method: "POST",
          body: JSON.stringify({ invalid: true }),
        });

        expect(res.status).toEqual(500);
        expect(await res.json()).toMatchObject({
          statusText: "Custom validation error",
        });
      });

      it("Custom error with zod", async () => {
        const res = await t.fetch("/custom-error-zod", {
          method: "POST",
          body: JSON.stringify({ invalid: true, field: 2 }),
        });

        expect(res.status).toEqual(500);
        expect(await res.json()).toMatchObject({
          statusText: "Custom Zod validation error",
          message:
            "- Invalid input: expected string, received number\n- Invalid input: expected never, received boolean",
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

      t.app.get("/custom-error", async (event) => {
        const data = await getValidatedQuery(
          event,
          customValidateWithoutError,
          {
            onError() {
              return {
                status: 500,
                statusText: "Custom validation error",
              };
            },
          },
        );

        return data;
      });

      t.app.get("/custom-error-zod", async (event) => {
        const data = await getValidatedQuery(event, zodValidate, {
          onError: (issues) => ({
            status: 500,
            statusText: "Custom Zod validation error",
            message: summarize(issues),
          }),
        });

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

    describe("custom error", () => {
      it("Custom error message", async () => {
        const res = await t.fetch("/custom-error?invalid=true");

        expect(res.status).toEqual(500);
        expect(await res.json()).toMatchObject({
          statusText: "Custom validation error",
        });
      });

      it("Custom error with zod", async () => {
        const res = await t.fetch("/custom-error-zod?invalid=true");

        expect(res.status).toEqual(500);
        expect(await res.json()).toMatchObject({
          statusText: "Custom Zod validation error",
          message: "- Invalid input: expected never, received string",
        });
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
        .regex(
          REGEX_NUMBER_STRING,
          "Invalid input: expected number, received string",
        )
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

      t.app.get("/custom-error-zod/:id", async (event) => {
        const data = await getValidatedRouterParams(event, zodParamValidate, {
          onError: (issues) => ({
            status: 500,
            statusText: "Custom Zod validation error",
            message: summarize(issues),
          }),
        });

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

    describe("custom error", () => {
      it("Custom error with zod", async () => {
        const res = await t.fetch("/custom-error-zod/abc");

        expect(res.status).toEqual(500);
        expect(await res.json()).toMatchObject({
          statusText: "Custom Zod validation error",
          message: "- Invalid input: expected number, received string",
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
