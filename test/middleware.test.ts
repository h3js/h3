import { beforeEach } from "vitest";
import { describeMatrix } from "./_setup.ts";
import { H3 } from "../src/h3.ts";

describeMatrix("middleware", (t, { it, expect }) => {
  beforeEach(() => {
    t.app.use((event) => {
      if (event.req.headers.has("x-intercept1")) {
        return "Intercepted 1";
      }
      event.context._middleware = [];
      event.context._middleware.push(`(event)`);
    });

    t.app.use(async (event) => {
      event.context._middleware.push(`async (event)`);
      await Promise.resolve();
    });

    t.app.use(async (event, next) => {
      event.context._middleware.push(`async (event, next)`);
      const value = await next();
      return value;
    });

    t.app.use((event, next) => {
      event.context._middleware.push(`(event, next)`);
      return next();
    });

    t.app.use(
      new H3().get("/test", (event) =>
        event.req.headers.has("x-async")
          ? Promise.resolve("Hello World!")
          : "Hello World!",
      ),
      {
        method: "GET",
        route: "/test/**",
      },
    );

    t.app.get("/**", (event) => {
      return {
        log: event.context._middleware.join(" > "),
      };
    });
  });

  it("should run all middleware in order", async () => {
    const response = await t.app.fetch("/");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      log: "(event) > async (event) > async (event, next) > (event, next)",
    });
  });

  it("intercepted middleware", async () => {
    const response = await t.app.fetch("/", {
      headers: { "x-intercept1": "1" },
    });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("Intercepted 1");
  });

  it("routed middleware", async () => {
    const response = await t.app.fetch("/test/");
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("Hello World!");

    const response2 = await t.app.fetch("/test/", {
      headers: { "x-async": "1" },
    });
    expect(response2.status).toBe(200);
    expect(await response2.text()).toBe("Hello World!");
  });

  it("routed middleware (method matching)", async () => {
    const response = await t.app.fetch("/test", {
      method: "POST",
    });
    expect(response.status).toBe(404);
  });

  it("routed middleware (fallback to main)", async () => {
    const response = await t.app.fetch("/test/...");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ log: expect.any(String) });
  });

  it("mounting invalid middleware", async () => {
    const app = new H3();
    expect(() => app.use({} as any)).toThrowError(
      "Invalid middleware: [object Object]",
    );
  });
});
