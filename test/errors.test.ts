import { vi } from "vitest";
import { HttpError } from "../src/index.ts";
import { describeMatrix } from "./_setup.ts";

describeMatrix("errors", (t, { it, expect }) => {
  const consoleMock = ((globalThis.console.error as any) = vi.fn());

  it("throw HttpError", async () => {
    t.app.use(() => {
      throw new HttpError({
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

  it("return HttpError", async () => {
    t.app.use(() => {
      return new HttpError({
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
      throw new HttpError({
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
      throw new HttpError(new CustomError());
    });

    const res = await t.fetch("/");
    expect(res.status).toBe(500);

    expect(t.errors[0].cause).toBeInstanceOf(CustomError);
  });

  it("can inherit from cause", async () => {
    class CustomError extends Error {
      cause = new HttpError({
        status: 400,
        statusText: "Bad Request",
        unhandled: true,
        fatal: true,
      });
    }

    t.app.get("/", () => {
      throw new HttpError(new CustomError());
    });

    const res = await t.fetch("/");
    expect(res.status).toBe(400);
    expect(t.errors[0].unhandled).toBe(true);
    expect(t.errors[0].fatal).toBe(true);

    t.errors = [];
  });
});
