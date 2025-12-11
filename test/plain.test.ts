import { describe, it, expect, beforeEach } from "vitest";
import {
  createApp,
  App,
  toPlainHandler,
  PlainHandler,
  eventHandler,
  readBody,
  setResponseHeader,
  sendStream,
} from "../src";

describe("Plain handler", () => {
  let app: App;
  let handler: PlainHandler;

  beforeEach(() => {
    app = createApp({ debug: true });
    handler = toPlainHandler(app);
  });

  it("works", async () => {
    app.use(
      "/test",
      eventHandler(async (event) => {
        const body =
          event.method === "POST" ? await readBody(event) : undefined;
        event.node.res.statusCode = 201;
        event.node.res.statusMessage = "Created";
        event.node.res.setHeader("content-type", "application/json");
        event.node.res.appendHeader("set-cookie", "a=123, b=123");
        event.node.res.appendHeader("set-Cookie", ["c=123"]);
        event.node.res.appendHeader("set-cookie", "d=123");
        return {
          method: event.method,
          path: event.path,
          headers: [...event.headers.entries()],
          body,
          contextKeys: Object.keys(event.context),
        };
      }),
    );

    const res = await handler({
      method: "POST",
      path: "/test/foo/bar",
      headers: [["x-test", "true"]],
      body: "request body",
      context: {
        test: true,
      },
    });

    expect(res).toMatchObject({
      status: 201,
      statusText: "Created",
      headers: [
        ["content-type", "application/json"],
        ["set-cookie", "a=123"],
        ["set-cookie", "b=123"],
        ["set-cookie", "c=123"],
        ["set-cookie", "d=123"],
      ],
    });

    expect(typeof res.body).toBe("string");
    expect(JSON.parse(res.body as string)).toMatchObject({
      method: "POST",
      path: "/foo/bar",
      body: "request body",
      headers: [["x-test", "true"]],
      contextKeys: ["test"],
    });
  });

  it("handles ReadableStream responses with correct headers in serverless environment", async () => {
    const testData = new Uint8Array([0x89, 0x50, 0x4e, 0x47]); // PNG magic bytes

    app.use(
      "/stream",
      eventHandler((event) => {
        setResponseHeader(event, "content-type", "image/png");
        return new ReadableStream({
          start(controller) {
            controller.enqueue(testData);
            controller.close();
          },
        });
      }),
    );

    const res = await handler({
      method: "GET",
      path: "/stream",
      headers: [],
    });

    expect(res.status).toBe(200);
    expect(res.headers).toContainEqual(["content-type", "image/png"]);
    // Body should be the actual stream data, not the stream object
    expect(res.body).toBeInstanceOf(Uint8Array);
    expect(new Uint8Array(res.body as ArrayBuffer)).toEqual(testData);
  });

  it("handles sendStream with correct body in serverless environment", async () => {
    const testData = new TextEncoder().encode("Hello, Stream!");

    app.use(
      "/send-stream",
      eventHandler(async (event) => {
        setResponseHeader(event, "content-type", "text/plain");
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(testData);
            controller.close();
          },
        });
        await sendStream(event, stream);
      }),
    );

    const res = await handler({
      method: "GET",
      path: "/send-stream",
      headers: [],
    });

    expect(res.status).toBe(200);
    expect(res.headers).toContainEqual(["content-type", "text/plain"]);
    expect(res.body).toBeInstanceOf(Uint8Array);
    expect(new TextDecoder().decode(res.body as Uint8Array)).toBe(
      "Hello, Stream!",
    );
  });
});
