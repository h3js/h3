import { vi } from "vitest";
import { createError, H3, withBase, type H3Error } from "../src/index.ts";
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
      throw createError({
        statusCode: 503,
      });
    });
    await t.fetch("/foo");

    expect(t.hooks.onRequest).toHaveBeenCalledTimes(1);
    expect(t.hooks.onRequest.mock.calls[0]![0]!.path).toBe("/foo");

    expect(t.hooks.onError).toHaveBeenCalledTimes(1);
    expect(t.hooks.onError.mock.calls[0]![0]!.statusCode).toBe(503);
    expect(t.hooks.onError.mock.calls[0]![1]!.path).toBe("/foo");

    expect(t.hooks.onBeforeResponse).toHaveBeenCalledTimes(1);
  });

  it("calls onRequest and onResponse when an error is thrown", async () => {
    t.app.use(() => {
      throw createError({
        statusCode: 404,
      });
    });
    await t.fetch("/foo");

    expect(t.hooks.onRequest).toHaveBeenCalledTimes(1);
    expect(t.hooks.onRequest.mock.calls[0]![0]!.path).toBe("/foo");

    expect(t.hooks.onError).toHaveBeenCalledTimes(1);
    expect(t.hooks.onError.mock.calls[0]![0]!.statusCode).toBe(404);
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
    expect(errors[0].statusCode).toBe(500);

    expect(t.hooks.onRequest).toHaveBeenCalledTimes(1);
    expect(t.hooks.onRequest.mock.calls[0][0].path).toBe("/foo");

    expect(t.hooks.onError).toHaveBeenCalledTimes(1);
    expect(t.hooks.onError.mock.calls[0]![0]!.statusCode).toBe(500);
    expect(t.hooks.onError.mock.calls[0]![0]!.cause).toBeInstanceOf(TypeError);
    expect(t.hooks.onError.mock.calls[0]![1]!.path).toBe("/foo");

    expect(t.hooks.onBeforeResponse).toHaveBeenCalledTimes(1);
  });

  it("calls nested hooks when an unhandled error occurs", async () => {
    const nestedErrors: H3Error[] = [];
    const nestedApp = new H3({
      onError(error, event) {
        nestedErrors.push(error);

        if (event.url.pathname.includes("/err-handled")) {
          return "Error handled in nested app";
        } else if (event.url.pathname.includes("/err-propagation")) {
          throw error;
        }
      },
    });
    // @ts-expect-error
    nestedApp.get("/err-handled", (event) => event.unknown.property);
    // @ts-expect-error
    nestedApp.get("/err-propagation", (event) => event.unknown.property);
    // @ts-expect-error
    nestedApp.get("/err-default", (event) => event.unknown.property);

    // @ts-expect-error
    t.app.get("/err", (event) => event.unknown.property);
    t.app.get("/nested/**", withBase("/nested", nestedApp));

    const topErrors = t.errors;

    topErrors.length = 0;
    nestedErrors.length = 0;
    await t.fetch("/err");
    expect(topErrors.length).toBe(1);
    expect(topErrors[0].statusCode).toBe(500);
    expect(nestedErrors.length).toBe(0);

    topErrors.length = 0;
    nestedErrors.length = 0;
    const result = await t.fetch("/nested/err-handled");
    expect(topErrors.length).toBe(0);
    expect(nestedErrors.length).toBe(1);
    expect(nestedErrors[0].statusCode).toBe(500);
    expect(await result.text()).toBe("Error handled in nested app");

    topErrors.length = 0;
    nestedErrors.length = 0;
    await t.fetch("/nested/err-propagation");
    expect(topErrors.length).toBe(1);
    expect(topErrors[0].statusCode).toBe(500);
    expect(nestedErrors.length).toBe(1);
    expect(nestedErrors[0].statusCode).toBe(500);

    topErrors.length = 0;
    nestedErrors.length = 0;
    await t.fetch("/nested/err-default");
    expect(topErrors.length).toBe(1);
    expect(topErrors[0].statusCode).toBe(500);
    expect(nestedErrors.length).toBe(1);
    expect(nestedErrors[0].statusCode).toBe(500);
  });
});
