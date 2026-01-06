import {
  Readable as NodeStreamReadable,
  Transform as NodeStreamTransoform,
} from "node:stream";
import { HTTPError, fromNodeHandler } from "../src/index.ts";
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

  // TODO: investigate issues with stream errors on srvx
  it.runIf(/* t.target === "node" */ false)(
    "Node.js Readable Stream with Error",
    async () => {
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
      expect(JSON.parse(await res.text()).statusMessage).toBe("test");
    },
  );

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

  it.skipIf(t.target !== "node")(
    "wait for node middleware (req, res, next)",
    async () => {
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
    },
  );

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
      console.log(t.errors);
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
});
