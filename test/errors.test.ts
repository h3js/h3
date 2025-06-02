import { vi } from "vitest";
import { createError } from "../src/index.ts";
import { describeMatrix } from "./_setup.ts";

describeMatrix("errors", (t, { it, expect }) => {
  const consoleMock = ((globalThis.console.error as any) = vi.fn());

  it("logs errors", async () => {
    t.app.use(() => {
      throw createError({ statusMessage: "Unprocessable", statusCode: 422 });
    });
    const result = await t.fetch("/");

    expect(result.status).toBe(422);
  });

  it("returns errors", async () => {
    t.app.use(() => {
      throw createError({ statusMessage: "Unprocessable", statusCode: 422 });
    });
    const result = await t.fetch("/");

    expect(result.status).toBe(422);
  });

  it("can send internal error", async () => {
    t.app.get("/api/test", () => {
      throw new Error("Booo");
    });
    const result = await t.fetch("/api/test");

    expect(result.status).toBe(500);
    expect(JSON.parse(await result.text())).toMatchObject({
      statusCode: 500,
    });
  });

  it("can send runtime error", async () => {
    consoleMock.mockReset();

    t.app.get("/api/test", () => {
      throw createError({
        statusCode: 400,
        statusMessage: "Bad Request",
        data: {
          message: "Invalid Input",
        },
      });
    });

    const result = await t.fetch("/api/test");

    expect(result.status).toBe(400);
    // expect(result.type).toMatch("application/json"); // TODO: fix this

    expect(console.error).not.toBeCalled();

    expect(JSON.parse(await result.text())).toMatchObject({
      statusCode: 400,
      statusMessage: "Bad Request",
      data: {
        message: "Invalid Input",
      },
    });
  });

  it("can handle errors in promises", async () => {
    t.app.get("/", () => {
      throw new Error("failed");
    });

    const res = await t.fetch("/");
    expect(res.status).toBe(500);
  });

  it("can handle returned Error", async () => {
    t.app.get("/", () => new Error("failed"));

    const res = await t.fetch("/");
    expect(res.status).toBe(500);
  });

  it("can handle returned H3Error", async () => {
    t.app.get("/", () => createError({ statusCode: 501 }));

    const res = await t.fetch("/");
    expect(res.status).toBe(501);
  });

  it("can access original error", async () => {
    class CustomError extends Error {
      customError = true;
    }

    t.app.get("/", () => {
      throw createError(new CustomError());
    });

    const res = await t.fetch("/");
    expect(res.status).toBe(500);

    expect(t.errors[0].cause).toBeInstanceOf(CustomError);
  });

  it("can inherit from cause", async () => {
    class CustomError extends Error {
      cause = createError({
        statusCode: 400,
        statusMessage: "Bad Request",
        unhandled: true,
        fatal: true,
      });
    }

    t.app.get("/", () => {
      throw createError(new CustomError());
    });

    const res = await t.fetch("/");
    expect(res.status).toBe(400);
    expect(t.errors[0].unhandled).toBe(true);
    expect(t.errors[0].fatal).toBe(true);

    t.errors = [];
  });
});
