import { vi } from "vitest";
import { runInNewContext } from "node:vm";
import { H3, HTTPError } from "../src/index.ts";
import { describeMatrix } from "./_setup.ts";

describeMatrix("errors", (t, { it, expect, describe }) => {
  const consoleMock = ((globalThis.console.error as any) = vi.fn());

  it("throw HTTPError", async () => {
    t.app.use(() => {
      throw new HTTPError({
        statusText: "Unprocessable",
        status: 422,
        data: { test: 123 },
        body: { topLevel: "works" },
      });
    });
    const result = await t.fetch("/");
    expect(result.status).toBe(422);
    expect(result.statusText).toBe("Unprocessable");
    expect(await result.json()).toMatchObject({
      status: 422,
      statusText: "Unprocessable",
      message: "Unprocessable",
      data: { test: 123 },
      topLevel: "works",
    });
  });

  it("return HTTPError", async () => {
    t.app.use(() => {
      return new HTTPError({
        statusText: "Unprocessable",
        status: 422,
        data: { test: 123 },
      });
    });
    const result = await t.fetch("/");
    expect(result.status).toBe(422);
    expect(result.statusText).toBe("Unprocessable");
    expect(await result.json()).toMatchObject({
      status: 422,
      statusText: "Unprocessable",
      message: "Unprocessable",
      data: { test: 123 },
    });
  });

  it("unandled errors", async () => {
    t.app.use("/api/test", () => {
      // @ts-expect-error
      foo.bar = 123;
    });
    const result = await t.fetch("/api/test");

    expect(t.errors[0].message).toMatch("foo is not defined");
    expect(t.errors[0].unhandled).toBe(true);
    t.errors = [];

    expect(result.status).toBe(500);
    expect(JSON.parse(await result.text())).toMatchObject({
      status: 500,
    });
  });

  it("can send runtime error", async () => {
    consoleMock.mockReset();

    t.app.get("/api/test", () => {
      throw new HTTPError({
        status: 400,
        statusText: "Bad Request",
        data: {
          message: "Invalid Input",
        },
      });
    });

    const result = await t.fetch("/api/test");

    expect(result.status).toBe(400);
    expect(result.headers.get("content-type")).toMatch("application/json");

    expect(console.error).not.toBeCalled();

    expect(JSON.parse(await result.text())).toMatchObject({
      status: 400,
      statusText: "Bad Request",
      data: {
        message: "Invalid Input",
      },
    });
  });

  it("can access original error", async () => {
    class CustomError extends Error {
      customError = true;
    }

    t.app.get("/", () => {
      throw new HTTPError(new CustomError());
    });

    const res = await t.fetch("/");
    expect(res.status).toBe(500);

    expect(t.errors[0].cause).toBeInstanceOf(CustomError);
  });

  it("can inherit from cause", async () => {
    class CustomError extends Error {
      override cause = new HTTPError({
        status: 400,
        statusText: "Bad Request",
        unhandled: true,
      });
    }

    t.app.get("/", () => {
      throw new HTTPError(new CustomError());
    });

    const res = await t.fetch("/");
    expect(res.status).toBe(400);
    expect(t.errors[0].unhandled).toBe(true);

    t.errors = [];
  });

  it("can inherit deprecated statusCode/statusMessage from cause", async () => {
    const cause = { statusCode: 404, statusMessage: "Not Found" };

    t.app.get("/", () => {
      throw new HTTPError({ cause });
    });

    const res = await t.fetch("/");
    expect(res.status).toBe(404);
    expect(res.statusText).toBe("Not Found");

    t.errors = [];
  });

  it("error headers", async () => {
    t.app.config.onError = async (error, event) => {
      const headers = new Headers(event.res.headers);
      headers.set("set-cookie", "error=1");
      return new Response(error.toString(), { status: 501, headers });
    };

    t.app.get("/", async (event) => {
      event.res.headers.set("set-cookie", "auth=1");
      event.res.headers.set("x-test", "1");
      throw new HTTPError("test");
    });

    const res = await t.fetch("/");
    expect(res.status).toBe(501);
    expect(res.headers.get("x-test")).toBe("1");
    expect(res.headers.getSetCookie()).toEqual(["error=1"]);

    t.errors = [];
  });

  it("throw number coerces to status", async () => {
    t.app.use(() => {
      throw 404;
    });
    const res = await t.fetch("/");
    expect(res.status).toBe(404);
  });

  it("throw async number coerces to status", async () => {
    t.app.use(async () => {
      throw 500;
    });
    const res = await t.fetch("/");
    expect(res.status).toBe(500);
  });

  it("return number is unchanged", async () => {
    t.app.use(() => 404);
    const res = await t.fetch("/");
    expect(res.status).toBe(200);
    expect(await res.json()).toBe(404);
  });

  describe("non-Error throws", () => {
    it("throw object does not leak into the response body", async () => {
      t.app.use(() => {
        throw { secret: "db-password", status: 403 };
      });
      const res = await t.fetch("/");
      expect(res.status).toBe(500);
      const body = await res.text();
      expect(body).not.toContain("db-password");
      expect(JSON.parse(body)).toMatchObject({
        status: 500,
        message: "HTTPError",
        unhandled: true,
      });

      expect(t.errors[0].unhandled).toBe(true);
      expect(t.errors[0].cause).toMatchObject({ secret: "db-password" });
      t.errors = [];
    });

    it("throw async object does not leak into the response body", async () => {
      t.app.use(async () => {
        throw { secret: "db-password" };
      });
      const res = await t.fetch("/");
      expect(res.status).toBe(500);
      expect(await res.text()).not.toContain("db-password");
      t.errors = [];
    });

    it("throw string", async () => {
      t.app.use(() => {
        throw "not-an-error";
      });
      const res = await t.fetch("/");
      expect(res.status).toBe(500);
      expect(await res.text()).not.toContain("not-an-error");
      t.errors = [];
    });

    it("throw undefined", async () => {
      t.app.use(() => {
        throw undefined;
      });
      const res = await t.fetch("/");
      expect(res.status).toBe(500);
      expect(await res.json()).toMatchObject({ status: 500, unhandled: true });
      t.errors = [];
    });

    it("thrown object cannot forge response headers", async () => {
      t.app.use(() => {
        throw { headers: { "x-forged": "1" } };
      });
      const res = await t.fetch("/");
      expect(res.status).toBe(500);
      expect(res.headers.get("x-forged")).toBe(null);
      t.errors = [];
    });

    // `toError` must use the same `instanceof Error` check as `prepareResponse`. A broader check
    // (e.g. `Error.isError`) would pass this through, only for `prepareResponse` to reject it and
    // render it as a successful body again.
    it("cross-realm error is not rendered as a body", async () => {
      const foreign = runInNewContext(`new Error("cross-realm secret")`);
      t.app.use(() => {
        throw foreign;
      });
      const res = await t.fetch("/");
      expect(res.status).toBe(500);
      expect(await res.text()).not.toContain("cross-realm secret");
      t.errors = [];
    });

    it("onError receives the wrapped error", async () => {
      const onError = vi.fn();
      const app = new H3({ onError, silent: true });
      app.use(() => {
        throw { secret: "db-password" };
      });
      const res = await app.request("/");
      expect(res.status).toBe(500);
      expect(onError).toHaveBeenCalledTimes(1);
      const error = onError.mock.calls[0][0];
      expect(HTTPError.isError(error)).toBe(true);
      expect(error.unhandled).toBe(true);
      expect(error.cause).toMatchObject({ secret: "db-password" });
    });
  });
});
