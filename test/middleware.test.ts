import { beforeEach } from "vitest";
import { describeMatrix } from "./_setup.ts";
import { H3 } from "../src/h3.ts";
import { defineHandler } from "../src/handler.ts";
import { Hono } from "hono";
import { toMiddleware } from "../src/middleware.ts";
import { onResponse } from "../src/index.ts";

describeMatrix("middleware", (t, { it, expect }) => {
  beforeEach(() => {
    t.app.use((event) => {
      if (event.req.headers.has("x-intercept1")) {
        return "Intercepted 1";
      }
      event.context._middleware = [];
      (event.context._middleware as string[]).push(`(event)`);
    });

    t.app.use(async (event) => {
      (event.context._middleware as string[]).push(`async (event)`);
      await Promise.resolve();
    });

    t.app.use(async (event, next) => {
      (event.context._middleware as string[]).push(`async (event, next)`);
      const value = await next();
      return value;
    });

    t.app.use(async (event, next) => {
      (event.context._middleware as string[]).push(
        `async (event, next) (passthrough)`,
      );
      await next();
    });

    t.app.use((event, next) => {
      (event.context._middleware as string[]).push(`(event, next)`);
      return next();
    });

    t.app.use(
      "/test/**",
      new H3().all("/test", (event) =>
        event.req.headers.has("x-async")
          ? Promise.resolve("Hello World!")
          : "Hello World!",
      ).handler,
      {
        method: "GET",
        match: (event) => !event.req.headers.has("x-skip"),
      },
    );

    t.app.use(
      "/custom-404",
      () =>
        new Response("Not found", {
          status: 404,
          statusText: "Page not found",
        }),
    );

    let count = 0;
    t.app.get(
      "/**",
      defineHandler({
        middleware: [
          (event) => {
            (event.context._middleware as string[]).push(`route (define)`);
          },
        ],
        handler: (event) => {
          count++;
          return {
            count,
            log: (event.context._middleware as string[]).join(" > "),
          };
        },
      }),
      {
        middleware: [
          (event) => {
            (event.context._middleware as string[]).push(`route (register)`);
          },
        ],
      },
    );
  });

  it("should run all middleware in order", async () => {
    const response = await t.app.request("/");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      log: "(event) > async (event) > async (event, next) > async (event, next) (passthrough) > (event, next) > route (register) > route (define)",
      count: 1,
    });
  });

  it("intercepted middleware", async () => {
    const response = await t.app.request("/", {
      headers: { "x-intercept1": "1" },
    });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("Intercepted 1");
  });

  it("routed middleware", async () => {
    const response = await t.app.request("/test/");
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("Hello World!");

    const response2 = await t.app.request("/test/", {
      headers: { "x-async": "1" },
    });
    expect(response2.status).toBe(200);
    expect(await response2.text()).toBe("Hello World!");
  });

  it("middleware filters", async () => {
    expect(
      (
        await t.app.request("/test", {
          method: "POST",
        })
      ).status,
    ).toBe(404);

    expect(
      await (
        await t.app.request("/test", {
          headers: { "x-skip": "1" },
        })
      ).text(),
    ).not.toBe("Hello World!");
  });

  it("routed middleware (fallback to main)", async () => {
    const response = await t.app.request("/test/...");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ log: expect.any(String) });
  });

  it("return custom 404 response in middleware", async () => {
    const result = await t.fetch("/custom-404");
    expect(result.status).toBe(404);
    expect(result.statusText).toBe("Page not found");
  });

  it("can mount sub-router as middleware", async () => {
    t.app.get("/", () => "hi!");

    const honoApp = new Hono().get("/hello", (c) => {
      return c.text("world");
    });
    t.app.use(toMiddleware(honoApp));

    const res = await t.fetch("/hello");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("world");

    const res2 = await t.fetch("/");
    expect(res2.status).toBe(200);
    expect(await res2.text()).toBe("hi!");
  });

  it('onResponse() does not duplicate "Set-Cookie" headers', async () => {
    // onResponse uses toResponse() internally (#1259)
    t.app.use(onResponse(() => {}));

    t.app.use((event) => {
      event.res.headers.append(
        "Set-Cookie",
        "session=abc123; Path=/; HttpOnly",
      );
      return new Response("Hello");
    });

    const res = await t.fetch("/");
    expect(res.status).toBe(200);
    expect(res.headers.getSetCookie()).toMatchObject([
      "session=abc123; Path=/; HttpOnly",
    ]);
  });
});
