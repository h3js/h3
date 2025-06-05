import { vi } from "vitest";
import { HttpError } from "../src/index.ts";
import { describeMatrix } from "./_setup.ts";

describeMatrix("hooks", (t, { it, expect }) => {
  it("calls onRequest and onResponse", async () => {
    t.app.use(() => Promise.resolve("Hello World!"));
    await t.fetch("/foo");

    expect(t.hooks.onRequest).toHaveBeenCalledTimes(1);
    expect(t.hooks.onRequest.mock.calls[0]![0]!.path).toBe("/foo");

    expect(t.hooks.onError).toHaveBeenCalledTimes(0);

    expect(t.hooks.onBeforeResponse).toHaveBeenCalledTimes(1);

    // In Node.js, srvx garbage collects the response body after preparing it for Node.js
    if (t.target !== "node") {
      const res = t.hooks.onBeforeResponse.mock.calls[0]![1]!;
      const resBody = res instanceof Response ? await res.text() : res.body;
      expect(resBody).toBe("Hello World!");
    }
  });

  it("сalls onRequest and onResponse when an exception is thrown", async () => {
    t.app.use(() => {
      throw new HttpError({ status: 503 });
    });
    await t.fetch("/foo");

    expect(t.hooks.onRequest).toHaveBeenCalledTimes(1);
    expect(t.hooks.onRequest.mock.calls[0]![0]!.path).toBe("/foo");

    expect(t.hooks.onError).toHaveBeenCalledTimes(1);
    expect(t.hooks.onError.mock.calls[0]![0]!.status).toBe(503);
    expect(t.hooks.onError.mock.calls[0]![1]!.path).toBe("/foo");

    expect(t.hooks.onBeforeResponse).toHaveBeenCalledTimes(1);
  });

  it("calls onRequest and onResponse when an error is thrown", async () => {
    t.app.use(() => {
      throw new HttpError({ status: 404 });
    });
    await t.fetch("/foo");

    expect(t.hooks.onRequest).toHaveBeenCalledTimes(1);
    expect(t.hooks.onRequest.mock.calls[0]![0]!.path).toBe("/foo");

    expect(t.hooks.onError).toHaveBeenCalledTimes(1);
    expect(t.hooks.onError.mock.calls[0]![0]!.status).toBe(404);
    expect(t.hooks.onError.mock.calls[0]![1]!.path).toBe("/foo");

    expect(t.hooks.onBeforeResponse).toHaveBeenCalledTimes(1);
  });

  it("calls onRequest and onResponse when an unhandled error occurs", async () => {
    t.app.use((event) => {
      // @ts-expect-error
      return event.unknown.property;
    });

    vi.spyOn(console, "error").mockImplementation(() => {});
    await t.fetch("/foo");

    const errors = t.errors;
    t.errors = [];

    expect(errors.length).toBe(1);
    expect(errors[0].status).toBe(500);

    expect(t.hooks.onRequest).toHaveBeenCalledTimes(1);
    expect(t.hooks.onRequest.mock.calls[0][0].path).toBe("/foo");

    console.log(t.hooks.onError.mock.calls[0]![0]!);

    expect(t.hooks.onError).toHaveBeenCalledTimes(1);
    expect(t.hooks.onError.mock.calls[0]![0]!.status).toBe(500);
    expect(t.hooks.onError.mock.calls[0]![0]!.cause).toBeInstanceOf(TypeError);
    expect(t.hooks.onError.mock.calls[0]![1]!.path).toBe("/foo");

    expect(t.hooks.onBeforeResponse).toHaveBeenCalledTimes(1);
  });
});
