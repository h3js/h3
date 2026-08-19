import { vi } from "vitest";
import { Readable as NodeStreamReadable, Transform as NodeStreamTransoform } from "node:stream";
import { fromNodeHandler } from "../src/adapters.ts";
import { withBase } from "../src/utils/base.ts";
import { HTTPError } from "../src/error.ts";
import { onResponse } from "../src/utils/middleware.ts";
import { onDispose } from "../src/index.ts";
import { setCookie } from "../src/utils/cookie.ts";
import { handleCors } from "../src/utils/cors.ts";
import { describeMatrix } from "./_setup.ts";

describeMatrix("app", (t, { it, expect }) => {
  it("can return JSON directly", async () => {
    t.app.get("/api", (event) => ({ url: event.url.pathname }));
    const res = await t.fetch("/api");

    expect(await res.json()).toEqual({ url: "/api" });
  });

  it("can return bigint directly", async () => {
    t.app.get("/", () => 9_007_199_254_740_991n);
    const res = await t.fetch("/");

    expect(await res.text()).toBe("9007199254740991");
  });

  it("returning symbol or function", async () => {
    t.app.get("/fn", () => {
      return function test() {};
    });
    t.app.get("/symbol", () => {
      return Symbol.for("test");
    });

    const resFn = await t.fetch("/fn");
    expect(resFn.status).toBe(200);
    expect(await resFn.text()).toMatch("test()");

    const resSymbol = await t.fetch("/symbol");
    expect(resSymbol.status).toBe(200);
    expect(await resSymbol.text()).toMatch("Symbol(test)");
  });

  it("can return thenable", async () => {
    t.app.get("/api", () => {
      const p = Promise.resolve("value");
      // eslint-disable-next-line unicorn/no-thenable
      return { then: p.then.bind(p) };
    });
    const res = await t.fetch("/api");
    expect(await res.text()).toEqual("value");
  });

  it("can return Response directly", async () => {
    t.app.use(
      () =>
        new Response("Hello World!", {
          status: 201,
          headers: { "x-test": "test" },
        }),
    );
    const res = await t.fetch("/");
    expect(res.status).toBe(201);
    expect(await res.text()).toBe("Hello World!");
  });

  it("can return a null response", async () => {
    t.app.get("/api", () => null);
    const res = await t.fetch("/api");

    expect(res.status).toBe(200);
    expect(await res.text()).toEqual("");
    expect(res.ok).toBeTruthy();
  });

  it("can return primitive values", async () => {
    const values = [true, false, 42, 0, 1];
    for (const value of values) {
      t.app.get(`/${value}`, () => value);
      expect(await (await t.fetch(`/${value}`)).json()).toEqual(value);
    }
  });

  it("can return Blob directly", async () => {
    t.app.use(() => {
      return new Blob(["<h1>Hello World</h1>"], {
        type: "text/html",
      });
    });
    const res = await t.fetch("/");

    expect(res.headers.get("content-type")).toBe("text/html");
    expect(await res.text()).toBe("<h1>Hello World</h1>");
  });

  it("can return File directly", async () => {
    t.app.use(
      () =>
        new File(["<h1>Hello World</h1>"], "hello ❤️.html", {
          type: "text/html",
        }),
    );
    const res = await t.fetch("/");

    expect(res.headers.get("content-type")).toBe("text/html");
    expect(res.headers.get("Content-Disposition")).toBe(
      "filename=\"hello%20%E2%9D%A4%EF%B8%8F.html\"; filename*=UTF-8''hello%20%E2%9D%A4%EF%B8%8F.html",
    );
    expect(await res.text()).toBe("<h1>Hello World</h1>");
  });

  it("can return Buffer directly", async () => {
    t.app.use(() => Buffer.from("<h1>Hello world!</h1>", "utf8"));
    const res = await t.fetch("/");

    expect(await res.text()).toBe("<h1>Hello world!</h1>");
  });

  it.runIf(t.target === "node")("Node.js Readable Stream", async () => {
    t.app.use(() => {
      return new NodeStreamReadable({
        read() {
          this.push(Buffer.from("<h1>Hello world!</h1>", "utf8"));
          this.push(null);
        },
      });
    });
    const res = await t.fetch("/");

    expect(await res.text()).toBe("<h1>Hello world!</h1>");
    expect(res.headers.get("transfer-encoding")).toBe("chunked");
  });

  it.runIf(t.target === "node")("pipeable response body survives response clone", async () => {
    t.app.use(
      onResponse((response) => {
        response.clone();
      }),
    );
    t.app.use(() => ({
      pipe(writable: { write: (chunk: string) => void; end: () => void }) {
        writable.write("test");
        writable.end();
      },
    }));

    const res = await t.fetch("/");

    expect(await res.text()).toBe("test");
  });

  it.runIf(t.target === "node")("Node.js Readable Stream with Error", async () => {
    t.app.use(() => {
      return new NodeStreamReadable({
        read() {
          this.push(Buffer.from("123", "utf8"));
          this.push(null);
        },
      }).pipe(
        new NodeStreamTransoform({
          transform(_chunk, _encoding, callback) {
            const err = new HTTPError({
              statusCode: 500,
              statusText: "test",
            });
            setTimeout(() => callback(err), 0);
          },
        }),
      );
    });
    const res = await t.fetch("/");
    expect(res.status).toBe(500);
  });

  it("Web Stream", async () => {
    t.app.use(() => {
      return new ReadableStream({
        start(controller) {
          const encoder = new TextEncoder();
          controller.enqueue(encoder.encode("<h1>Hello world!</h1>"));
          controller.close();
        },
      });
    });
    const res = await t.fetch("/");

    expect(await res.text()).toBe("<h1>Hello world!</h1>");
    if (t.target === "node") {
      // In Web API, we cannot determine protocol and connection type
      expect(res.headers.get("transfer-encoding")).toBe("chunked");
    }
  });

  it("Web Stream with Error", async () => {
    t.app.use(() => {
      return new ReadableStream({
        start() {
          throw new HTTPError({ status: 500, statusText: "test" });
        },
      });
    });
    const res = await t.fetch("/");

    expect(res.status).toBe(500);
    expect(JSON.parse(await res.text()).statusText).toBe("test");
  });

  it("can return text directly", async () => {
    t.app.use(() => "Hello world!");
    const res = await t.fetch("/");

    expect(await res.text()).toBe("Hello world!");
  });

  it("allows overriding Content-Type", async () => {
    t.app.use((event) => {
      event.res.headers.set("content-type", "text/xhtml");
      return "<h1>Hello world!</h1>";
    });
    const res = await t.fetch("/");

    expect(res.headers.get("content-type")).toBe("text/xhtml");
  });

  it("can match simple prefixes", async () => {
    t.app.get("/1", () => "prefix1");
    t.app.get("/2", () => "prefix2");
    const res = await t.fetch("/2");

    expect(await res.text()).toBe("prefix2");
  });

  it("can chain .use calls", async () => {
    t.app.get("/1", () => "prefix1").use("/2", () => "prefix2");
    const res = await t.fetch("/2");

    expect(await res.text()).toBe("prefix2");
  });

  it("can use async routes", async () => {
    t.app.get("/promise", async () => {
      return await Promise.resolve("42");
    });
    t.app.use(async () => {});

    const res = await t.fetch("/promise");
    expect(await res.text()).toBe("42");
  });

  it("can use fetchable routes", async () => {
    t.app.get("/fetchable", {
      fetch: async () => {
        return new Response("fetchable");
      },
    });
    const res = await t.fetch("/fetchable");
    expect(await res.text()).toBe("fetchable");
  });

  it("handles next() call with no routes matching", async () => {
    t.app.use(() => {});
    t.app.use(() => {});

    const response = await t.fetch("/");
    expect(response.status).toEqual(404);
  });

  it("can short-circuit route matching", async () => {
    t.app.use(() => "done");
    t.app.use(() => "valid");

    const response = await t.fetch("/");
    expect(await response.text()).toEqual("done");
  });

  it("can normalise route definitions", async () => {
    t.app.get("/test/", () => "valid");

    const res = await t.fetch("/test");
    expect(await res.text()).toBe("valid");
  });

  it("can add and match unicode routes", async () => {
    t.app.get("/سلام", () => "valid");

    const res = await t.fetch("/سلام");
    expect(res.status).toBe(200);

    const res2 = await t.app.request("/سلام");
    expect(res2.status).toBe(200);
  });

  it.skipIf(t.target !== "node")("wait for node middleware (req, res, next)", async () => {
    t.app.use(
      fromNodeHandler((_req, res, next) => {
        setTimeout(() => {
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify({ works: 1 }));
          next();
        }, 10);
      }),
    );
    const res = await t.fetch("/");
    expect(await res.json()).toEqual({ works: 1 });
  });

  it.skipIf(t.target !== "node")("fromNodeHandler syncs raw req.url with the h3 view", async () => {
    let rawUrlAfter: string | undefined;
    t.app.config.onResponse = (_res, event) => {
      rawUrlAfter = event.runtime?.node?.req?.url;
    };
    t.app.use(
      "/api/**",
      withBase(
        "/api",
        fromNodeHandler((req, res) => {
          res.end(req.url || "");
        }),
      ),
    );

    // Legacy handler must see the base-stripped path in raw req.url
    expect(await t.fetch("/api/hello?q=1").then((r) => r.text())).toBe("/hello?q=1");

    // Rewrites must propagate in the wire encoding, without re-encoding or
    // decoding the pathname on the way to the legacy handler
    expect(await t.fetch("/api/caf%C3%A9?q=1").then((r) => r.text())).toBe("/caf%C3%A9?q=1");
    // ...and the raw url is restored once the handler settles
    expect(rawUrlAfter).toBe("/api/caf%C3%A9?q=1");
  });

  it.skipIf(t.target !== "node")("fromNodeHandler + piping", async () => {
    t.app.all(
      "/*",
      fromNodeHandler((req, res) => {
        const iterator = (async function* () {
          yield "item1,";
          yield "item2,";
          yield "item3";
        })();
        NodeStreamReadable.from(iterator).pipe(res);
      }),
    );
    const res = await t.fetch("/");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("item1,item2,item3");
  });

  it.skipIf(t.target !== "node")(
    "fromNodeHandler + piping (with Error and custom status)",
    async () => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      t.app.all(
        "/*",
        fromNodeHandler((req, res) => {
          res.statusCode = 201;
          const iterator = (async function* () {
            yield "item1,";
            yield "item2";
            throw new Error("Test Error");
          })();
          NodeStreamReadable.from(iterator).pipe(res);
        }),
      );
      const res = await t.fetch("/");
      expect(res.status).toBe(201);
      expect(await res.text()).toBe("item1,item2");
      spy.mockRestore();
    },
  );

  it.skipIf(t.target !== "node")(
    "fromNodeHandler + piping (client disconnect settles the event)",
    async () => {
      // `pipe` only unpipes the source when the response closes, so an aborted
      // request must not leave the handler promise pending: the event lifecycle
      // has to complete and the source has to be released.
      const { promise: destroyed, resolve: onDestroyed } = Promise.withResolvers<boolean>();
      const { promise: disposed, resolve: onDisposed } = Promise.withResolvers<boolean>();

      t.app.use((event) => {
        onDispose(event, () => onDisposed(true));
      });
      t.app.all(
        "/*",
        fromNodeHandler((req, res) => {
          new NodeStreamReadable({
            read() {
              this.push("x".repeat(64 * 1024));
            },
            destroy(err, cb) {
              onDestroyed(true);
              cb(err);
            },
          }).pipe(res);
        }),
      );

      const controller = new AbortController();
      const res = await t.fetch("/", { signal: controller.signal });
      await res.body!.getReader().read();
      controller.abort();

      const timeout = <T>(value: T) => new Promise<T>((r) => setTimeout(() => r(value), 500));
      expect(await Promise.race([destroyed, timeout(false)])).toBe(true);
      expect(await Promise.race([disposed, timeout(false)])).toBe(true);
    },
  );

  it("set headers via event.res + Response (mutable)", async () => {
    t.app.use((event) => {
      event.res.headers.set("x-from-event", "1");
      return new Response("hello", {
        headers: { "x-from-response": "1" },
      });
    });
    const res = await t.fetch("/");
    expect(res.headers.get("x-from-event")).toBe("1");
    expect(res.headers.get("x-from-response")).toBe("1");
  });

  it("strips the body for a HEAD request while merging prepared headers into a mutable Response", async () => {
    t.app.use((event) => {
      event.res.headers.set("x-from-event", "1");
      return new Response("hello", {
        headers: { "x-from-response": "1" },
      });
    });
    const res = await t.fetch("/", { method: "HEAD" });
    expect(res.headers.get("x-from-event")).toBe("1");
    expect(res.headers.get("x-from-response")).toBe("1");
    expect(await res.text()).toBe("");
  });

  it("set headers via event.res + Response (immutable)", async () => {
    t.app.use((event) => {
      event.res.headers.set("x-from-event", "1");
      const res = new Response("hello", {
        headers: { "x-from-response": "1" },
      });
      res.headers.set = () => {
        throw new Error("immutable");
      };
      res.headers.append = () => {
        throw new Error("immutable");
      };
      return res;
    });
    const res = await t.fetch("/");
    expect(res.headers.get("x-from-response")).toBe("1");
    expect(res.headers.get("x-from-event")).toBe("1");
  });

  it("keeps prepared headers for a redirect Response", async () => {
    t.app.use((event) => {
      setCookie(event, "sid", "1");
      return new Response(null, { status: 302, headers: { location: "/login" } });
    });
    const res = await t.fetch("/", { redirect: "manual" });
    expect(res.status).toBe(302);
    expect(res.headers.get("set-cookie")).toBe("sid=1; Path=/");
  });

  it("drops prepared headers but keeps errHeaders for an error Response", async () => {
    t.app.use((event) => {
      event.res.headers.set("cache-control", "max-age=3600");
      event.res.errHeaders.set("access-control-allow-origin", "*");
      return new Response("nope", { status: 401 });
    });
    const res = await t.fetch("/");
    expect(res.status).toBe(401);
    expect(res.headers.get("cache-control")).toBe(null);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("returned and thrown errors agree on errHeaders", async () => {
    t.app.use((event) => {
      handleCors(event, { origin: "*" });
    });
    t.app.get("/returned", () => new Response("no", { status: 401 }));
    t.app.get("/thrown", () => {
      throw new HTTPError({ status: 401 });
    });
    for (const path of ["/returned", "/thrown"]) {
      const res = await t.fetch(path, { headers: { origin: "http://example.com" } });
      expect(res.status, path).toBe(401);
      expect(res.headers.get("access-control-allow-origin"), path).toBe("*");
    }
  });
  it("does not mutate a handler-returned Response when merging prepared headers", async () => {
    // A reused Response (module constant, memoized fallback, ...) must not accumulate
    // request-scoped headers: appended `set-cookie` values would leak across requests.
    const shared = new Response(null, { status: 302, headers: { location: "/login" } });
    let user = 0;
    t.app.get("/shared", (event) => {
      setCookie(event, "sid", `user${++user}`);
      return shared;
    });

    for (const expected of ["user1", "user2", "user3"]) {
      const res = await t.fetch("/shared");
      expect(res.headers.getSetCookie()).toEqual([`sid=${expected}; Path=/`]);
      expect(res.headers.get("location")).toBe("/login");
    }

    expect([...shared.headers.keys()]).toEqual(["location"]);
  });

  it("keeps a handler-returned Response's own set-cookie values when merging", async () => {
    t.app.get("/multi", (event) => {
      setCookie(event, "staged", "s");
      const headers = new Headers();
      headers.append("set-cookie", "a=1; Path=/");
      headers.append("set-cookie", "b=2; Path=/");
      return new Response(null, { status: 204, headers });
    });
    const res = await t.fetch("/multi");
    expect(res.headers.getSetCookie()).toEqual(["a=1; Path=/", "b=2; Path=/", "staged=s; Path=/"]);
  });
});
