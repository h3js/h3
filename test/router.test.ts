import { beforeEach } from "vitest";
import { getRouterParams, getRouterParam, removeRoute, H3 } from "../src/index.ts";
import { describeMatrix } from "./_setup.ts";

describeMatrix("router", (t, { it, expect, describe }) => {
  beforeEach(() => {
    t.app
      .get("/", () => "Hello")
      .get("/many/routes", () => "many routes")
      .post("/many/routes", () => "many routes")
      .get("/test", () => "Test (GET)")
      .post("/test", () => "Test (POST)");
  });

  it("Handle route", async () => {
    const res = await t.fetch("/");
    expect(await res.text()).toEqual("Hello");
  });

  it("Multiple Routers", async () => {
    const secondRouter = new H3().get("/router2", () => "router2");

    t.app.use(secondRouter.handler);

    const res1 = await t.fetch("/");
    expect(await res1.text()).toEqual("Hello");

    const res2 = await t.fetch("/router2");
    expect(await res2.text()).toEqual("router2");
  });

  it("Handle different methods", async () => {
    const res1 = await t.fetch("/test");
    expect(await res1.text()).toEqual("Test (GET)");
    const res2 = await t.fetch("/test", { method: "POST" });
    expect(await res2.text()).toEqual("Test (POST)");
  });

  it("Handle query method", async () => {
    t.app.get("/query", () => "Test (GET)").query("/query", () => "Test (QUERY)");

    const getRes = await t.fetch("/query");
    expect(await getRes.text()).toEqual("Test (GET)");

    const queryRes = await t.fetch("/query", { method: "QUERY" });
    expect(await queryRes.text()).toEqual("Test (QUERY)");
  });

  it("Handle url with query parameters", async () => {
    const res = await t.fetch("/test?title=test");
    expect(res.status).toEqual(200);
  });

  it('Handle url with query parameters, include "?" in url path', async () => {
    const res = await t.fetch("/test/?/a?title=test&returnTo=/path?foo=bar");
    expect(res.status).toEqual(200);
  });

  it("Handle many methods (get)", async () => {
    const res = await t.fetch("/many/routes");
    expect(res.status).toEqual(200);
  });

  it("Handle many methods (post)", async () => {
    const res = await t.fetch("/many/routes", { method: "POST" });
    expect(res.status).toEqual(200);
  });

  it("Not matching route", async () => {
    const res = await t.fetch("/404");
    expect(res.status).toEqual(404);
  });

  it("Handle shadowed route", async () => {
    t.app.post("/test/123", (event) => `[${event.req.method}] ${event.path}`);

    t.app.get("/test/**", (event) => `[${event.req.method}] ${event.path}`);

    // Loop to validate cached behavior
    for (let i = 0; i < 5; i++) {
      const postRed = await t.fetch("/test/123", { method: "POST" });
      expect(postRed.status).toEqual(200);
      expect(await postRed.text()).toEqual("[POST] /test/123");

      const getRes = await t.fetch("/test/123");
      expect(getRes.status).toEqual(200);
      expect(await getRes.text()).toEqual("[GET] /test/123");
    }
  });

  describe("router (preemptive)", () => {
    let router: H3;

    beforeEach(() => {
      router = new H3()
        .get("/preemptive/test", () => "Test")
        .get("/preemptive/undefined", () => undefined);
      t.app.all("/**", router.handler);
    });

    it("Handle /test", async () => {
      const res = await t.fetch("/preemptive/test");
      expect(await res.text()).toEqual("Test");
    });

    it("Handle /404", async () => {
      const res = await t.fetch("/preemptive/404");
      expect(await res.json()).toMatchObject({
        status: 404,
        message: expect.stringMatching(
          /Cannot find any route matching \[GET\] http:\/\/localhost[:\d]*\/preemptive\/404/,
        ),
      });
    });

    it("Not matching route method", async () => {
      const res = await t.fetch("/preemptive/404", { method: "HEAD" });
      expect(res.status).toEqual(404);
    });

    it("Handle /undefined", async () => {
      const res = await t.fetch("/preemptive/undefined");
      expect(await res.text()).toEqual("");
    });
  });

  describe("getRouterParams", () => {
    describe("with router", () => {
      it("can return router params", async () => {
        const router = new H3().get("/test/params/:name", (event) => {
          expect(getRouterParams(event)).toMatchObject({ name: "string" });
          return "200";
        });
        t.app.use(router.handler);
        const result = await t.fetch("/test/params/string");

        expect(await result.text()).toBe("200");
      });

      it("can decode router params", async () => {
        const router = new H3().get("/test/params/:name", (event) => {
          expect(getRouterParams(event, { decode: true })).toMatchObject({
            name: "string with space",
          });
          return "200";
        });
        t.app.use(router.handler);
        const result = await t.fetch("/test/params/string with space");

        expect(await result.text()).toBe("200");
      });

      it("decode does not reintroduce path separators or traversal", async () => {
        // `decode:true` must not be able to turn an encoded path separator
        // (`%2f`/`%5c`) that route matching and pathname-based middleware only
        // ever saw as one opaque, still-encoded segment into a raw `/` or `\`
        // (and thus `..`-based traversal) — a path desync / smuggling vector.
        t.app.get("/files/:id", (event) => {
          return getRouterParams(event, { decode: true }).id;
        });

        const encodedSlash = await (await t.fetch("/files/%2F")).text();
        expect(encodedSlash).not.toContain("/");

        const encodedBackslash = await (await t.fetch("/files/%5C")).text();
        expect(encodedBackslash).not.toContain("\\");

        const encodedTraversal = await (await t.fetch("/files/%2E%2E%2Fetc")).text();
        expect(encodedTraversal).not.toContain("/");
        expect(encodedTraversal).not.toContain("../");

        // Double-encoded separator must not decode down to a raw `/` either.
        const doubleEncodedSlash = await (await t.fetch("/files/%252F")).text();
        expect(doubleEncodedSlash).not.toContain("/");

        // Legitimate decoding of other characters is preserved.
        const spaced = await (await t.fetch("/files/a%20b")).text();
        expect(spaced).toBe("a b");
        const nonAscii = await (await t.fetch("/files/caf%C3%A9")).text();
        expect(nonAscii).toBe("café");
      });
    });

    describe("without router", () => {
      it("can return an empty object if router is not used", async () => {
        t.app.get("/**", (event) => {
          expect(getRouterParams(event)).toMatchObject({});
          return "200";
        });
        const result = await t.fetch("/test/empty/params");

        expect(await result.text()).toBe("200");
      });
    });
  });

  describe("getRouterParam", () => {
    describe("with router", () => {
      it("can return a value of router params corresponding to the given name", async () => {
        const router = new H3().get("/test/params/:name", (event) => {
          expect(getRouterParam(event, "name")).toEqual("string");
          return "200";
        });
        t.app.use(router.handler);
        const result = await t.fetch("/test/params/string");

        expect(await result.text()).toBe("200");
      });

      it("can decode a value of router params corresponding to the given name", async () => {
        const router = new H3().get("/test/params/:name", (event) => {
          expect(getRouterParam(event, "name", { decode: true })).toEqual("string with space");
          return "200";
        });
        t.app.use(router.handler);
        const result = await t.fetch("/test/params/string with space");

        expect(await result.text()).toBe("200");
      });
    });

    describe("without router", () => {
      it("can return `undefined` for any keys", async () => {
        t.app.get("/**", (request) => {
          expect(getRouterParam(request, "name")).toEqual(undefined);
          return "200";
        });
        const result = await t.fetch("/test/empty/params");

        expect(await result.text()).toBe("200");
      });
    });
  });

  describe("evet.context.matchedRoute", () => {
    describe("with router", () => {
      it("can return the matched path", async () => {
        const router = new H3().get("/test/:template", (event) => {
          expect(event.context.matchedRoute).toMatchObject({
            method: "GET",
            route: "/test/:template",
            handler: expect.any(Function),
          });
          return "200";
        });
        t.app.use(router.handler);
        const result = await t.fetch("/test/path");

        expect(await result.text()).toBe("200");
      });
    });

    describe("without router", () => {
      it("middleware can access matched route", async () => {
        t.app.get("/**", (event) => {
          expect(event.context.matchedRoute).toMatchObject({ route: "/**" });
          return "200";
        });
        const result = await t.fetch("/test/path");

        expect(await result.text()).toBe("200");
      });
    });
  });

  describe("removeRoute", () => {
    it("removes a registered route", async () => {
      t.app.get("/removable", () => "exists");

      const res1 = await t.fetch("/removable");
      expect(res1.status).toBe(200);
      expect(await res1.text()).toBe("exists");

      removeRoute(t.app, "GET", "/removable");

      const res2 = await t.fetch("/removable");
      expect(res2.status).toBe(404);
    });

    it("removes only the specified method", async () => {
      t.app.get("/multi", () => "get");
      t.app.post("/multi", () => "post");

      removeRoute(t.app, "GET", "/multi");

      const getRes = await t.fetch("/multi");
      expect(getRes.status).toBe(404);

      const postRes = await t.fetch("/multi", { method: "POST" });
      expect(postRes.status).toBe(200);
      expect(await postRes.text()).toBe("post");
    });

    it("empty method removes only methodless route, not all methods", async () => {
      t.app.get("/path", () => "get");
      t.app.post("/path", () => "post");

      removeRoute(t.app, "", "/path");

      const getRes = await t.fetch("/path");
      expect(getRes.status).toBe(200);
      expect(await getRes.text()).toBe("get");

      const postRes = await t.fetch("/path", { method: "POST" });
      expect(postRes.status).toBe(200);
      expect(await postRes.text()).toBe("post");
    });
  });

  describe("HEAD fallback", () => {
    it("HEAD falls back to GET route with empty body", async () => {
      t.app.get("/head-fallback", () => ({ hello: "world" }));
      const res = await t.fetch("/head-fallback", { method: "HEAD" });
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toMatch(/application\/json/);
      expect(await res.text()).toBe("");
    });

    it("explicit HEAD route takes precedence over GET fallback", async () => {
      t.app.get("/head-precedence", () => "get");
      t.app.head("/head-precedence", (event) => {
        event.res.headers.set("x-handler", "head");
        return null;
      });
      const res = await t.fetch("/head-precedence", { method: "HEAD" });
      expect(res.status).toBe(200);
      expect(res.headers.get("x-handler")).toBe("head");
      expect(await res.text()).toBe("");
    });

    it("HEAD to a path with no GET route still 404s", async () => {
      const res = await t.fetch("/head-missing", { method: "HEAD" });
      expect(res.status).toBe(404);
    });

    it("HEAD to a handler returning a raw Response strips body", async () => {
      t.app.get(
        "/head-raw",
        () =>
          new Response("body content", {
            status: 200,
            headers: { "x-custom": "value" },
          }),
      );
      const res = await t.fetch("/head-raw", { method: "HEAD" });
      expect(res.status).toBe(200);
      expect(res.headers.get("x-custom")).toBe("value");
      expect(await res.text()).toBe("");
    });

    it("HEAD matching an all() route still works", async () => {
      t.app.all("/head-all", () => "all");
      const res = await t.fetch("/head-all", { method: "HEAD" });
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("");
    });

    it("preserves a content-length header set by the GET handler", async () => {
      t.app.get("/head-cl", (event) => {
        event.res.headers.set("content-length", "13");
        return { hello: "world" };
      });
      const res = await t.fetch("/head-cl", { method: "HEAD" });
      expect(res.status).toBe(200);
      expect(res.headers.get("content-length")).toBe("13");
      expect(await res.text()).toBe("");
    });

    it("preserves content-length on a raw Response for HEAD", async () => {
      t.app.get(
        "/head-raw-cl",
        () =>
          new Response("hello world!!", {
            status: 200,
            headers: { "content-length": "13" },
          }),
      );
      const res = await t.fetch("/head-raw-cl", { method: "HEAD" });
      expect(res.status).toBe(200);
      expect(res.headers.get("content-length")).toBe("13");
      expect(await res.text()).toBe("");
    });

    it("route-level middleware on the GET route runs for fallback HEAD", async () => {
      let ran = false;
      t.app.get("/head-mw", () => "get", {
        middleware: [
          (_event, next) => {
            ran = true;
            return next();
          },
        ],
      });
      const res = await t.fetch("/head-mw", { method: "HEAD" });
      expect(res.status).toBe(200);
      expect(ran).toBe(true);
      expect(await res.text()).toBe("");
    });
  });
});
