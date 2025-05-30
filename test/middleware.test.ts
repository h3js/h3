import { beforeEach } from "vitest";
import { describeMatrix } from "./_setup.ts";

describeMatrix("middleware", (t, { it, expect }) => {
  beforeEach(() => {
    t.app.use((event) => {
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

    t.app.get("/**", (event) => {
      return {
        log: event.context._middleware.join(" > "),
      };
    });
  });

  it("should run all middleware in order", async () => {
    const response = await t.app.fetch("/test");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchInlineSnapshot(`
      {
        "log": "(event) > async (event) > async (event, next) > (event, next)",
      }
    `);
  });
});
