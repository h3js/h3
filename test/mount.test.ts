import { H3 } from "../src/h3.ts";
import { withBase } from "../src/utils/base.ts";
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

    it("canonicalizes a percent-encoded base path before mounting", async () => {
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

      // A percent-encoded base path is canonicalized before `base` is matched
      // and stripped, so the mounted handler sees the same `/admin` the guard
      // above blocks — it can never receive `/%61dmin`.
      const res2 = await t.fetch("/%61pi/admin");
      expect(res2.status).toBe(403);
    });

    it("hands the mounted handler opaque escapes in their wire encoding", async () => {
      t.app.mount("/api", (req) => new Response(`OK: ${new URL(req.url).pathname}`));
      const res = await t.fetch("/api/a%2Fb%5Cc");
      expect(await res.text()).toBe("OK: /a%2Fb%5Cc");
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

    it("keeps the stripped url on req.clone()", async () => {
      t.app.mount("/api", async (req) => {
        const cloned = req.clone();
        const { pathname, search } = new URL(cloned.url);
        return Response.json({ url: pathname + search, body: await cloned.text() });
      });
      const res = await t.fetch("/api/users?x=1", { method: "POST", body: "hi" });
      expect(await res.json()).toEqual({ url: "/users?x=1", body: "hi" });
    });

    it("works with compat object", async () => {
      t.app.mount("/test", {
        fetch: (req: Request) => new Response(new URL(req.url).pathname),
      });
      expect(await t.fetch("/test/123").then((r) => r.text())).toBe("/123");
    });

    it("rejects an empty segment after base", async () => {
      const seen: string[] = [];
      t.app.mount("/api", (req) => (seen.push(new URL(req.url).pathname), new Response("reached")));
      // Neither `/evil.com` (merged past `use()` guards) nor a protocol-relative
      // `//evil.com` (a downstream open redirect) is a safe stripped form.
      expect((await t.fetch("/api//evil.com")).status).toBe(404);
      expect(seen).toEqual([]);
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

    it("rejects an empty segment after base for child middleware and routes", async () => {
      const seen: string[] = [];
      const subApp = new H3();
      subApp.use((event) => {
        seen.push(event.url.pathname);
        return event.url.pathname;
      });
      subApp.get("/**", () => "unprotected");

      t.app.mount("/api", subApp);

      const res = await t.fetch("/api//evil.com");
      // Rejected rather than skipped: skipping the child middleware would let
      // the mounted `/api/**` route serve the request without it.
      expect(res.status).toBe(404);
      expect(seen).toEqual([]);
    });
  });

  describe("empty segment after base", () => {
    // `use()` scopes match the raw path, so a guard at `/api/admin/**` does not
    // cover `/api//admin/secret`. The mounted app must not receive that request
    // as `/admin/secret`, or the empty segment that dodged the guard is merged
    // away and the guarded path is reached.
    const deny = (event: { req: Request }, next: () => unknown) =>
      event.req.headers.get("authorization") === "Bearer good"
        ? next()
        : new Response("unauthorized", { status: 401 });

    for (const path of ["/api//admin/secret", "/api///admin/secret"]) {
      it(`mount(fetch) does not bypass a guard below the base (${path})`, async () => {
        t.app.use("/api/admin/**", deny);
        t.app.mount("/api", (req) => new Response(`secret ${new URL(req.url).pathname}`));
        expect((await t.fetch("/api/admin/secret")).status).toBe(401);
        const res = await t.fetch(path);
        expect(res.status).toBe(404);
        expect(await res.text()).not.toContain("secret /admin/secret");
      });

      it(`mount(H3) middleware does not bypass a guard below the base (${path})`, async () => {
        const subApp = new H3().use((event) => `secret ${event.url.pathname}`);
        t.app.use("/api/admin/**", deny);
        t.app.mount("/api", subApp);
        expect((await t.fetch("/api/admin/secret")).status).toBe(401);
        const res = await t.fetch(path);
        expect(res.status).toBe(404);
        expect(await res.text()).not.toContain("secret /admin/secret");
      });

      it(`withBase does not bypass a guard below the base (${path})`, async () => {
        const api = new H3().get("/admin/secret", (event) => `secret ${event.url.pathname}`);
        t.app.use("/api/admin/**", deny);
        t.app.use("/api/**", withBase("/api", api.handler));
        expect((await t.fetch("/api/admin/secret")).status).toBe(401);
        const res = await t.fetch(path);
        expect(res.status).toBe(404);
        expect(await res.text()).not.toContain("secret /admin/secret");
      });
    }

    it("still mounts interior empty segments verbatim", async () => {
      t.app.mount("/api", (req) => new Response(new URL(req.url).pathname));
      expect(await t.fetch("/api/admin//secret").then((r) => r.text())).toBe("/admin//secret");
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
