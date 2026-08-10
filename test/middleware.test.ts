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
      (event.context._middleware as string[]).push(`async (event, next) (passthrough)`);
      await next();
    });

    t.app.use((event, next) => {
      (event.context._middleware as string[]).push(`(event, next)`);
      return next();
    });

    t.app.use(
      "/test/**",
      new H3().all("/test", (event) =>
        event.req.headers.has("x-async") ? Promise.resolve("Hello World!") : "Hello World!",
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

  it("GET-scoped global middleware also runs for HEAD requests", async () => {
    const app = new H3();
    const seen: string[] = [];
    app.use(
      (event) => {
        seen.push(event.req.method);
      },
      { method: "GET" },
    );
    app.get("/foo", () => "hello");

    const headRes = await app.request("/foo", { method: "HEAD" });
    expect(headRes.status).toBe(200);
    expect(await headRes.text()).toBe("");

    const postRes = await app.request("/foo", { method: "POST" });
    expect(postRes.status).toBe(404); // no POST route; POST-scoped exclusion still holds

    expect(seen).toEqual(["HEAD"]); // ran for HEAD, not for POST
  });

  it('onResponse() does not duplicate "Set-Cookie" headers', async () => {
    // onResponse uses toResponse() internally (#1259)
    t.app.use(onResponse(() => {}));

    t.app.use((event) => {
      event.res.headers.append("Set-Cookie", "session=abc123; Path=/; HttpOnly");
      return new Response("Hello");
    });

    const res = await t.fetch("/");
    expect(res.status).toBe(200);
    expect(res.headers.getSetCookie()).toMatchObject(["session=abc123; Path=/; HttpOnly"]);
  });

  // Regression for #1477: the Uint8Array branch used to set `content-length` on
  // `event.res.headers` after it had already been cleared, losing the header and
  // re-populating `event.res`, which a second `toResponse()` pass (e.g. this
  // `onResponse()` middleware, #1259) would then merge as stale/duplicated headers.
  it("keeps content-length for a Uint8Array response without duplicating headers (#1477)", async () => {
    t.app.use(onResponse(() => {}));

    t.app.use((event) => {
      event.res.headers.append("Set-Cookie", "session=abc123; Path=/; HttpOnly");
      return new Uint8Array([1, 2, 3]);
    });

    const res = await t.fetch("/");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-length")).toBe("3");
    expect(res.headers.getSetCookie()).toMatchObject(["session=abc123; Path=/; HttpOnly"]);
  });

  // Regression: `event.url.pathname` is canonicalized before matching (needless
  // escapes like `%40` decoded to `@`), but a route filter string passed to
  // `use(route, ...)` was handed to `routeToRegExp()` raw — so an escaped filter
  // like `/%40admin/**` could never match the canonicalized pathname of a
  // request for `/@admin/...`.
  it("canonicalizes a needlessly-escaped route filter passed to use()", async () => {
    let ran = false;
    t.app.use("/%40admin/**", () => {
      ran = true;
    });
    t.app.get("/@admin/x", () => "ok");

    const res = await t.fetch("/@admin/x");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
    expect(ran).toBe(true);
  });
});

// Regression: `use(route, ...)` used to compile its own regex for the route
// filter while the router matched with rou3, and the two disagreed — so a
// request could reach a handler with the guard registered for it skipped.
// A `:param` regex was `[^/]+`, rejecting the empty segment rou3's trie accepts
// (`/admin/7//` reached `/admin/:id` unguarded), and the `/**` regex made the
// separator optional (`/admin/**` also fired on `/adminx`). Both matchers are
// now rou3, so the scope of a `use()` is the match-set of the same pattern.
describeMatrix("middleware route scope", (t, { it, expect }) => {
  // Every path here is routed by its own pattern, so its guard must fire.
  const scopes = [
    { route: "/admin/:id", paths: ["/admin/7", "/admin/7/", "/admin/7//"] },
    { route: "/admin/**", paths: ["/admin", "/admin/", "/admin//", "/admin/x", "/admin/x/y"] },
    // A named `**` needs at least one segment, so `/files` itself is not routed.
    { route: "/files/**:rest", paths: ["/files/a", "/files/a/b", "/files/a/b/"] },
    { route: "/a/*", paths: ["/a", "/a/", "/a/x", "/a/x/"] },
    { route: "/api", paths: ["/api", "/api/", "/api//"] },
  ];

  for (const { route, paths } of scopes) {
    it(`guards every path routed by ${route}`, async () => {
      t.app.use(route, () => "DENIED");
      t.app.all(route, () => "ALLOWED");
      for (const path of paths) {
        const res = await t.fetch(path);
        expect(await res.text(), `${route} vs ${path}`).toBe("DENIED");
      }
    });
  }

  it("does not let a `/**` scope bleed past the segment boundary", async () => {
    const seen: string[] = [];
    t.app.use("/admin/**", (event) => {
      seen.push(event.url.pathname);
    });
    t.app.get("/**", () => "ok");

    for (const path of ["/adminx", "/administrator", "/admin-panel", "/ad"]) {
      expect(await (await t.fetch(path)).text()).toBe("ok");
    }
    expect(seen).toEqual([]);

    await t.fetch("/admin/x");
    expect(seen).toEqual(["/admin/x"]);
  });

  // A leading empty segment is only reachable in web mode: the node test client
  // resolves `//admin/...` against its base URL as a protocol-relative URL.
  it.skipIf(t.target === "node")("guards a path with an empty leading segment", async () => {
    t.app.use("/:tenant/admin/**", () => "DENIED");
    t.app.get("/:tenant/admin/users", () => "ALLOWED");

    const res = await t.app.request(new Request("http://localhost//admin/users"));
    expect(await res.text()).toBe("DENIED");
  });

  it("exposes rou3 param names in middlewareParams", async () => {
    let params: Record<string, string> | undefined;
    t.app.use("/mix/*/:id/**:rest", (event) => {
      params = event.context.middlewareParams;
    });
    t.app.get("/**", () => "ok");

    await t.fetch("/mix/q/7/a/b");
    expect(params).toEqual({ "0": "q", id: "7", rest: "a/b" });
  });
});
