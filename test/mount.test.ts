import { H3 } from "../src/h3.ts";
import { HTTPError } from "../src/error.ts";
import { describeMatrix } from "./_setup.ts";

describeMatrix("mount", (t, { it, expect, describe }) => {
  describe("mount fetch", () => {
    it("works with fetch function passed", async () => {
      t.app.mount("/test", (req) => new Response(new URL(req.url).pathname));
      expect(await t.fetch("/test").then((r) => r.text())).toBe("/");
      expect(await t.fetch("/test/").then((r) => r.text())).toBe("/");
      expect(await t.fetch("/test/123").then((r) => r.text())).toBe("/123");
    });

    it("normalizes percent-encoded base path", async () => {
      t.app.mount("/api", async (req) => {
        const url = new URL(req.url);
        if (url.pathname.startsWith("/admin")) {
          return new Response("Forbidden", { status: 403 });
        }
        return new Response(`OK: ${url.pathname}`);
      });

      // Normal request should be blocked
      const res1 = await t.fetch("/api/admin");
      expect(res1.status).toBe(403);

      // Percent-encoded base path should still be blocked
      const res2 = await t.fetch("/%61pi/admin");
      expect(res2.status).toBe(403);
    });

    it("strips base for h3-based fetch handlers when runtime provides req._url", async () => {
      const subApp = new H3();
      subApp.get("/hello", () => "sub");
      // Passing the bound fetch function takes the generic fetch-handler path,
      // so the sub-app re-parses the proxied request instead of sharing routes.
      t.app.mount("/sub", subApp.fetch);
      const res = await t.fetch("/sub/hello");
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("sub");
    });

    it("works with compat object", async () => {
      t.app.mount("/test", {
        fetch: (req: Request) => new Response(new URL(req.url).pathname),
      });
      expect(await t.fetch("/test/123").then((r) => r.text())).toBe("/123");
    });

    it("collapses leading slashes after stripping base", async () => {
      t.app.mount("/api", (req) => new Response(new URL(req.url).pathname));
      // A protocol-relative pathname must not survive base stripping, otherwise a
      // downstream redirect to it becomes a `//host` open redirect.
      expect(await t.fetch("/api//evil.com").then((r) => r.text())).toBe("/evil.com");
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

      expect(t.app["~routes"]).toHaveLength(1);
      expect(t.app["~routes"][0].route).toBe("/test/**:slug");

      expect(t.app["~middleware"]).toHaveLength(1);

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

    it("collapses leading slashes for child middleware after stripping base", async () => {
      let seenPathname = "";
      const subApp = new H3();
      subApp.use((event) => {
        seenPathname = event.url.pathname;
        return event.url.pathname;
      });
      subApp.get("/**", () => "unused");

      t.app.mount("/api", subApp);

      const res = await t.fetch("/api//evil.com");
      // Child middleware must not see a protocol-relative pathname.
      expect(seenPathname).toBe("/evil.com");
      expect(await res.text()).toBe("/evil.com");
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

    it("restores pathname when mounted middleware returns without calling next", async () => {
      let pathInResponse = "";
      t.app.config.onResponse = (_res, event) => {
        pathInResponse = event.url.pathname;
      };

      const subApp = new H3();
      subApp.use((_event) => {
        return "intercepted";
      });
      subApp.get("/test", () => new Response("ok"));

      t.app.mount("/api", subApp);

      const res = await t.fetch("/api/test");
      expect(await res.text()).toBe("intercepted");
      // onResponse must see the original pathname, not the stripped one
      expect(pathInResponse).toBe("/api/test");
    });

    it("restores pathname when mounted middleware throws synchronously", async () => {
      const subApp = new H3();
      subApp.use((_event) => {
        throw new HTTPError({ status: 500, statusText: "Sync Error" });
      });
      subApp.get("/test", () => new Response("ok"));

      t.app.mount("/api", subApp);

      t.app.config.onError = (error, event) => {
        return Response.json({ path: event.url.pathname }, { status: 500 });
      };

      const res = await t.fetch("/api/test");
      const body = await res.json();
      expect(body.path).toBe("/api/test");
      t.errors = [];
    });

    it("restores pathname when mounted middleware throws asynchronously", async () => {
      const subApp = new H3();
      subApp.use(async (_event) => {
        await Promise.resolve();
        throw new HTTPError({ status: 500, statusText: "Async Error" });
      });
      subApp.get("/test", () => new Response("ok"));

      t.app.mount("/api", subApp);

      t.app.config.onError = (error, event) => {
        return Response.json({ path: event.url.pathname }, { status: 500 });
      };

      const res = await t.fetch("/api/test");
      const body = await res.json();
      expect(body.path).toBe("/api/test");
      t.errors = [];
    });

    it("supports mounted handler returning a bare thenable (no .finally)", async () => {
      const subApp = new H3();
      subApp.use((_event, next) => {
        next(); // returns undefined, so the raw handler result propagates
      });
      subApp.get("/test", () => ({
        // eslint-disable-next-line unicorn/no-thenable
        then(resolve: (value: string) => void) {
          resolve("thenable");
        },
      }));

      t.app.mount("/api", subApp);

      const res = await t.fetch("/api/test");
      expect(await res.text()).toBe("thenable");
    });

    it("v1 compat: app.use(router) with H3 instance (#1341)", async () => {
      const router = new H3();
      router.get("/", () => "Hello world!");
      t.app.use(router);
      const res = await t.fetch("/");
      expect(await res.text()).toBe("Hello world!");
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

    it("mounted middleware should not execute for prefix-matching paths without segment boundary", async () => {
      const adminApp = new H3();
      adminApp.use((event, next) => {
        event.context.isAdmin = true;
        return next();
      });
      adminApp.get("/dashboard", () => ({ admin: true }));

      t.app.mount("/admin", adminApp);
      t.app.get("/admin-public/info", (event) => ({
        path: event.url.pathname,
        isAdmin: event.context.isAdmin ?? false,
      }));

      // /admin/dashboard should trigger admin middleware
      const adminRes = await t.fetch("/admin/dashboard");
      expect(adminRes.status).toBe(200);

      // /admin-public/info should NOT trigger admin middleware
      const publicRes = await t.fetch("/admin-public/info");
      const body = await publicRes.json();
      expect(body.isAdmin).toBe(false);
    });
  });
});
