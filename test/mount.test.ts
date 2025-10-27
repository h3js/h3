import { H3 } from "../src/h3.ts";
import { describeMatrix } from "./_setup.ts";

describeMatrix("mount", (t, { it, expect, describe }) => {
  describe("mount fetch", () => {
    it("works with fetch function passed", async () => {
      t.app.mount("/test", (req) => new Response(new URL(req.url).pathname));
      expect(await t.fetch("/test").then((r) => r.text())).toBe("/");
      expect(await t.fetch("/test/").then((r) => r.text())).toBe("/");
      expect(await t.fetch("/test/123").then((r) => r.text())).toBe("/123");
    });

    it("works with compat object", async () => {
      t.app.mount("/test", {
        fetch: (req: Request) => new Response(new URL(req.url).pathname),
      });
      expect(await t.fetch("/test/123").then((r) => r.text())).toBe("/123");
    });
  });

  describe("mount H3", () => {
    it("works with H3 handler", async () => {
      t.app.mount(
        "/test",
        new H3()
          .use((event) => {
            event.res.headers.set("x-test", "1");
          })
          .use((event) => {
            // After mount, child middleware sees adjusted pathname
            if (event.url.pathname === "/intercept") {
              return "intercepted";
            }
          })
          .get("/**:slug", (event) => ({
            // Route handler sees original pathname (restored by wrappedNext)
            url: event.url.pathname,
            slug: event.context.params?.slug,
          })),
      );

      expect(t.app._routes).toHaveLength(1);
      expect(t.app._routes[0].route).toBe("/test/**:slug");

      expect(t.app._middleware).toHaveLength(1);

      const res = await t.fetch("/test/123");
      expect(res.headers.get("x-test")).toBe("1");
      expect(await res.json()).toMatchObject({
        url: "/test/123",
        slug: "123",
      });

      const interceptRes = await t.fetch("/test/intercept");
      expect(interceptRes.headers.get("x-test")).toBe("1");
      expect(await interceptRes.text()).toBe("intercepted");
    });
  });

  describe("mount sub-app with routed middleware", () => {
    it("middleware with path should inherit base URL", async () => {
      const logs: string[] = [];

      const subApp = new H3();
      subApp.use("/hello", (event, next) => {
        logs.push(`middleware: ${event.url.pathname}`);
        return next();
      });
      subApp.get("/hello", () => new Response("world"));

      t.app.mount("/api", subApp);

      const response = await t.fetch("/api/hello");

      expect(response.status).toBe(200);
      expect(await response.text()).toBe("world");
      expect(logs).toContain("middleware: /hello"); // Should see adjusted path
      expect(logs).toHaveLength(1); // Middleware should execute once
    });

    it("path-less middleware should work with mounted app", async () => {
      const logs: string[] = [];

      const subApp = new H3();
      subApp.use((event, next) => {
        logs.push(`global: ${event.url.pathname}`);
        return next();
      });
      subApp.get("/test", () => new Response("ok"));

      t.app.mount("/api", subApp);

      const response = await t.fetch("/api/test");

      expect(response.status).toBe(200);
      expect(logs).toContain("global: /test"); // Adjusted path
    });

    it("nested mounting should work correctly", async () => {
      const logs: string[] = [];

      const deepApp = new H3();
      deepApp.use("/endpoint", (event, next) => {
        logs.push(`deep: ${event.url.pathname}`);
        return next();
      });
      deepApp.get("/endpoint", () => new Response("deep"));

      const midApp = new H3();
      midApp.mount("/v1", deepApp);

      t.app.mount("/api", midApp);

      const response = await t.fetch("/api/v1/endpoint");

      expect(response.status).toBe(200);
      expect(logs).toContain("deep: /endpoint");
    });

    it("multiple middleware should all execute with correct paths", async () => {
      const logs: string[] = [];

      const subApp = new H3();
      subApp.use("/hello", (event, next) => {
        logs.push("first");
        return next();
      });
      subApp.use("/hello", (event, next) => {
        logs.push("second");
        return next();
      });
      subApp.get("/hello", () => new Response("ok"));

      t.app.mount("/api", subApp);

      await t.fetch("/api/hello");

      expect(logs).toEqual(["first", "second"]);
    });

    it("middleware with wildcards should work with base", async () => {
      const logs: string[] = [];

      const subApp = new H3();
      subApp.use("/admin/**", (event, next) => {
        logs.push(`admin: ${event.url.pathname}`);
        return next();
      });
      subApp.get("/admin/users", () => new Response("users"));

      t.app.mount("/api", subApp);

      await t.fetch("/api/admin/users");

      expect(logs).toContain("admin: /admin/users"); // Adjusted path
    });

    it("middleware should not execute for non-matching paths", async () => {
      const logs: string[] = [];

      const subApp = new H3();
      subApp.use("/hello", (event, next) => {
        logs.push("should-not-execute");
        return next();
      });
      subApp.get("/other", () => new Response("other"));

      t.app.mount("/api", subApp);

      await t.fetch("/api/other");

      expect(logs).toHaveLength(0); // Middleware should not execute
    });
  });
});
