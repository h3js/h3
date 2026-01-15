import { Readable, Transform } from "node:stream";
import supertest, { SuperTest, Test } from "supertest";
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  createApp,
  toNodeListener,
  App,
  eventHandler,
  fromNodeMiddleware,
  createError,
} from "../src";

describe("app", () => {
  let app: App;
  let request: SuperTest<Test>;

  const onRequest = vi.fn();
  const onBeforeResponse = vi.fn();
  const onAfterResponse = vi.fn();
  const onError = vi.fn();

  beforeEach(() => {
    app = createApp({
      debug: true,
      onError,
      onRequest,
      onBeforeResponse,
      onAfterResponse,
    });
    request = supertest(toNodeListener(app));
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it("can return JSON directly", async () => {
    app.use(
      "/api",
      eventHandler((event) => ({ url: event.path })),
    );
    const res = await request.get("/api");

    expect(res.body).toEqual({ url: "/" });
  });

  it("can return bigint directly", async () => {
    app.use(
      "/",
      eventHandler(() => 9_007_199_254_740_991n),
    );
    const res = await request.get("/");

    expect(res.text).toBe("9007199254740991");
  });

  it("throws error when returning symbol or function", async () => {
    app.use(
      "/fn",
      eventHandler(() => {
        return function foo() {};
      }),
    );
    app.use(
      "/symbol",
      eventHandler(() => {
        return Symbol.for("foo");
      }),
    );

    const resFn = await request.get("/fn");
    expect(resFn.status).toBe(500);
    expect(resFn.body.statusMessage).toBe(
      "[h3] Cannot send function as response.",
    );

    const resSymbol = await request.get("/symbol");
    expect(resSymbol.status).toBe(500);
    expect(resSymbol.body.statusMessage).toBe(
      "[h3] Cannot send symbol as response.",
    );
  });

  it("can return Response directly", async () => {
    app.use(
      "/",
      eventHandler(
        () =>
          new Response("Hello World!", {
            status: 201,
            headers: { "x-test": "test" },
          }),
      ),
    );

    const res = await request.get("/");
    expect(res.statusCode).toBe(201);
    expect(res.text).toBe("Hello World!");
  });

  it("can return a 204 response", async () => {
    app.use(
      "/api",
      eventHandler(() => null),
    );
    const res = await request.get("/api");

    expect(res.statusCode).toBe(204);
    expect(res.text).toEqual("");
    expect(res.ok).toBeTruthy();
  });

  it("can return primitive values", async () => {
    const values = [true, false, 42, 0, 1];
    for (const value of values) {
      app.use(
        `/${value}`,
        eventHandler(() => value),
      );
      expect(await request.get(`/${value}`).then((r) => r.body)).toEqual(value);
    }
  });

  it("can return Blob directly", async () => {
    app.use(
      eventHandler(
        () =>
          new Blob(["<h1>Hello World</h1>"], {
            type: "text/html",
          }),
      ),
    );
    const res = await request.get("/");

    expect(res.headers["content-type"]).toBe("text/html");
    expect(res.text).toBe("<h1>Hello World</h1>");
  });

  it("can return Buffer directly", async () => {
    app.use(eventHandler(() => Buffer.from("<h1>Hello world!</h1>", "utf8")));
    const res = await request.get("/");

    expect(res.text).toBe("<h1>Hello world!</h1>");
  });

  it("Node.js Readable Stream", async () => {
    app.use(
      eventHandler(() => {
        return new Readable({
          read() {
            this.push(Buffer.from("<h1>Hello world!</h1>", "utf8"));
            this.push(null);
          },
        });
      }),
    );
    const res = await request.get("/");

    expect(res.text).toBe("<h1>Hello world!</h1>");
    expect(res.header["transfer-encoding"]).toBe("chunked");
  });

  it("Node.js Readable Stream with Error", async () => {
    app.use(
      eventHandler(() => {
        return new Readable({
          read() {
            this.push(Buffer.from("123", "utf8"));
            this.push(null);
          },
        }).pipe(
          new Transform({
            transform(_chunk, _encoding, callback) {
              const err = createError({
                statusCode: 500,
                statusText: "test",
              });
              setTimeout(() => callback(err), 0);
            },
          }),
        );
      }),
    );
    const res = await request.get("/");
    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.text).statusMessage).toBe("test");
  });

  it("Web Stream", async () => {
    app.use(
      eventHandler(() => {
        return new ReadableStream({
          start(controller) {
            const encoder = new TextEncoder();
            controller.enqueue(encoder.encode("<h1>Hello world!</h1>"));
            controller.close();
          },
        });
      }),
    );
    const res = await request.get("/");

    expect(res.text).toBe("<h1>Hello world!</h1>");
    expect(res.header["transfer-encoding"]).toBe("chunked");
  });

  it("Web Stream with Error", async () => {
    app.use(
      eventHandler(() => {
        return new ReadableStream({
          start() {
            throw createError({
              statusCode: 500,
              statusText: "test",
            });
          },
        });
      }),
    );
    const res = await request.get("/");

    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.text).statusMessage).toBe("test");
  });

  it("can return HTML directly", async () => {
    app.use(eventHandler(() => "<h1>Hello world!</h1>"));
    const res = await request.get("/");

    expect(res.text).toBe("<h1>Hello world!</h1>");
    expect(res.header["content-type"]).toBe("text/html");
  });

  it("allows overriding Content-Type", async () => {
    app.use(
      eventHandler((event) => {
        event.node.res.setHeader("content-type", "text/xhtml");
        return "<h1>Hello world!</h1>";
      }),
    );
    const res = await request.get("/");

    expect(res.header["content-type"]).toBe("text/xhtml");
  });

  it("can match simple prefixes", async () => {
    app.use(
      "/1",
      eventHandler(() => "prefix1"),
    );
    app.use(
      "/2",
      eventHandler(() => "prefix2"),
    );
    const res = await request.get("/2");

    expect(res.text).toBe("prefix2");
  });

  it("can chain .use calls", async () => {
    app
      .use(
        "/1",
        eventHandler(() => "prefix1"),
      )
      .use(
        "/2",
        eventHandler(() => "prefix2"),
      );
    const res = await request.get("/2");

    expect(res.text).toBe("prefix2");
  });

  it("can use async routes", async () => {
    app.use(
      "/promise",
      eventHandler(async () => {
        return await Promise.resolve("42");
      }),
    );
    app.use(eventHandler(async () => {}));

    const res = await request.get("/promise");
    expect(res.text).toBe("42");
  });

  it("can use route arrays", async () => {
    app.use(
      ["/1", "/2"],
      eventHandler(() => "valid"),
    );

    const responses = [await request.get("/1"), await request.get("/2")].map(
      (r) => r.text,
    );
    expect(responses).toEqual(["valid", "valid"]);
  });

  it("can use handler arrays", async () => {
    app.use("/", [
      eventHandler(() => {}),
      eventHandler(() => {}),
      eventHandler(() => {}),
      eventHandler(eventHandler(() => "valid")),
    ]);

    const response = await request.get("/");
    expect(response.text).toEqual("valid");
  });

  it("prohibits use of next() in non-promisified handlers", () => {
    app.use(
      "/",
      eventHandler(() => {}),
    );
  });

  it("handles next() call with no routes matching", async () => {
    app.use(
      "/",
      eventHandler(() => {}),
    );
    app.use(
      "/",
      eventHandler(() => {}),
    );

    const response = await request.get("/");
    expect(response.status).toEqual(404);
  });

  it("can take an object", async () => {
    app.use({ route: "/", handler: eventHandler(() => "valid") });

    const response = await request.get("/");
    expect(response.text).toEqual("valid");
  });

  it("can short-circuit route matching", async () => {
    app.use(
      eventHandler((event) => {
        event.node.res.end("done");
      }),
    );
    app.use(eventHandler(() => "valid"));

    const response = await request.get("/");
    expect(response.text).toEqual("done");
  });

  it("can use a custom matcher", async () => {
    app.use(
      "/odd",
      eventHandler(() => "Is odd!"),
      { match: (url) => Boolean(Number(url.slice(1)) % 2) },
    );

    const res = await request.get("/odd/41");
    expect(res.text).toBe("Is odd!");

    const notFound = await request.get("/odd/2");
    expect(notFound.status).toBe(404);
  });

  it("can normalise route definitions", async () => {
    app.use(
      "/test/",
      eventHandler(() => "valid"),
    );

    const res = await request.get("/test");
    expect(res.text).toBe("valid");
  });

  it("wait for middleware (req, res, next)", async () => {
    app.use(
      "/",
      fromNodeMiddleware((_req, res, next) => {
        setTimeout(() => {
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify({ works: 1 }));
          next();
        }, 10);
      }),
    );
    const res = await request.get("/");
    expect(res.body).toEqual({ works: 1 });
  });

  it("calls onRequest and onResponse", async () => {
    app.use(eventHandler(() => Promise.resolve("Hello World!")));
    await request.get("/foo");

    expect(onRequest).toHaveBeenCalledTimes(1);
    expect(onRequest.mock.calls[0][0].path).toBe("/foo");

    expect(onError).toHaveBeenCalledTimes(0);

    expect(onBeforeResponse).toHaveBeenCalledTimes(1);
    expect(onBeforeResponse.mock.calls[0][1].body).toBe("Hello World!");

    expect(onAfterResponse).toHaveBeenCalledTimes(1);
    expect(onAfterResponse.mock.calls[0][1].body).toBe("Hello World!");
  });

  it("сalls onRequest and onResponse when an exception is thrown", async () => {
    app.use(
      eventHandler(() => {
        throw createError({
          statusCode: 503,
        });
      }),
    );
    await request.get("/foo");

    expect(onRequest).toHaveBeenCalledTimes(1);
    expect(onRequest.mock.calls[0][0].path).toBe("/foo");

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0].statusCode).toBe(503);
    expect(onError.mock.calls[0][1].path).toBe("/foo");

    expect(onBeforeResponse).toHaveBeenCalledTimes(1);
    expect(onBeforeResponse.mock.calls[0][0].node.res.statusCode).toBe(503);

    expect(onAfterResponse).toHaveBeenCalledTimes(1);
    expect(onAfterResponse.mock.calls[0][0].node.res.statusCode).toBe(503);
  });

  it("calls onRequest and onResponse when an error is returned", async () => {
    app.use(
      eventHandler(() => {
        return createError({
          statusCode: 404,
        });
      }),
    );
    await request.get("/foo");

    expect(onRequest).toHaveBeenCalledTimes(1);
    expect(onRequest.mock.calls[0][0].path).toBe("/foo");

    expect(onError).toHaveBeenCalledTimes(1);

    expect(onBeforeResponse).toHaveBeenCalledTimes(1);
    expect(onBeforeResponse.mock.calls[0][0].node.res.statusCode).toBe(404);

    expect(onAfterResponse).toHaveBeenCalledTimes(1);
    expect(onAfterResponse.mock.calls[0][0].node.res.statusCode).toBe(404);
  });

  it("calls onRequest and onResponse when an unhandled error occurs", async () => {
    app.use(
      eventHandler((event) => {
        // @ts-expect-error
        return event.unknown.property;
      }),
    );
    await request.get("/foo");

    expect(onRequest).toHaveBeenCalledTimes(1);
    expect(onRequest.mock.calls[0][0].path).toBe("/foo");

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0].statusCode).toBe(500);
    expect(onError.mock.calls[0][0].cause).toBeInstanceOf(TypeError);
    expect(onError.mock.calls[0][1].path).toBe("/foo");

    expect(onBeforeResponse).toHaveBeenCalledTimes(1);
    expect(onBeforeResponse.mock.calls[0][0].node.res.statusCode).toBe(500);

    expect(onAfterResponse).toHaveBeenCalledTimes(1);
    expect(onAfterResponse.mock.calls[0][0].node.res.statusCode).toBe(500);
  });
});
