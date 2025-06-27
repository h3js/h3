import { beforeEach } from "vitest";
import { getRouterParams, getRouterParam, H3 } from "../src/index.ts";
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
          expect(getRouterParam(event, "name", { decode: true })).toEqual(
            "string with space",
          );
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
});
