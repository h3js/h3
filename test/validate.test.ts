import supertest, { SuperTest, Test } from "supertest";
import { describe, it, expect, beforeEach } from "vitest";
import { z } from "zod";
import {
  createApp,
  toNodeListener,
  App,
  eventHandler,
  readValidatedBody,
  getValidatedQuery,
  ValidateFunction,
} from "../src";

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
  invalid: z.never().optional() /* WTF! */,
}).parse;

describe("Validate", () => {
  let app: App;
  let request: SuperTest<Test>;

  beforeEach(() => {
    app = createApp({ debug: true });
    request = supertest(toNodeListener(app));
  });

  describe("readValidatedBody", () => {
    beforeEach(() => {
      app.use(
        "/custom",
        eventHandler(async (event) => {
          const data = await readValidatedBody(event, customValidate);
          return data;
        }),
      );

      app.use(
        "/zod",
        eventHandler(async (event) => {
          const data = await readValidatedBody(event, zodValidate);
          return data;
        }),
      );
    });

    describe("custom validator", () => {
      it("Valid JSON", async () => {
        const res = await request.post("/custom").send({ field: "value" });
        expect(res.body).toEqual({ field: "value", default: "default" });
        expect(res.status).toEqual(200);
      });

      it("Valid x-www-form-urlencoded", async () => {
        const res = await request
          .post("/custom")
          .set("Content-Type", "application/x-www-form-urlencoded")
          .send("field=value");
        expect(res.body).toEqual({ field: "value", default: "default" });
        expect(res.status).toEqual(200);
      });

      it("Invalid JSON", async () => {
        const res = await request.post("/custom").send({ invalid: true });
        expect(res.text).include("Invalid key");
        expect(res.status).toEqual(400);
      });
    });

    describe("zod validator", () => {
      it("Valid", async () => {
        const res = await request.post("/zod").send({ field: "value" });
        expect(res.body).toEqual({ field: "value", default: "default" });
        expect(res.status).toEqual(200);
      });

      it("Invalid", async () => {
        const res = await request.post("/zod").send({ invalid: true });
        expect(res.status).toEqual(400);
        // TODO: zod5 error message is stringified
        const payload = JSON.parse(res.body.data.message);
        expect(payload[0].code).toEqual("invalid_type");
      });
    });
  });

  describe("getQuery", () => {
    beforeEach(() => {
      app.use(
        "/custom",
        eventHandler(async (event) => {
          const data = await getValidatedQuery(event, customValidate);
          return data;
        }),
      );

      app.use(
        "/zod",
        eventHandler(async (event) => {
          const data = await getValidatedQuery(event, (data) => {
            try {
              return zodValidate(data);
            } catch (error) {
              console.log(error.toJSON());
            }
          });
          return data;
        }),
      );
    });

    describe("custom validator", () => {
      it("Valid", async () => {
        const res = await request.get("/custom?field=value");
        expect(res.body).toEqual({ field: "value", default: "default" });
        expect(res.status).toEqual(200);
      });

      it("Invalid", async () => {
        const res = await request.get("/custom?invalid=true");
        expect(res.text).include("Invalid key");
        expect(res.status).toEqual(400);
      });
    });

    describe("zod validator", () => {
      it("Valid", async () => {
        const res = await request.get("/zod?field=value");
        expect(res.body).toEqual({ field: "value", default: "default" });
        expect(res.status).toEqual(200);
      });

      it("Invalid", async () => {
        const res = await request.get("/zod?invalid=true");
        expect(res.status).toEqual(400);
      });
    });
  });
});
