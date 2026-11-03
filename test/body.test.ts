import { Agent, request, Server, type IncomingMessage } from "node:http";
import { once } from "node:events";
import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { PassThrough, Readable } from "node:stream";
import { setImmediate as nextTurn } from "node:timers/promises";
import getPort from "get-port";
import { Client } from "undici";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  createApp,
  toNodeListener,
  App,
  readRawBody,
  readBody,
  eventHandler,
  readMultipartFormData,
  getRequestWebStream,
  toWebRequest,
  setResponseStatus,
} from "../src";

describe("body", () => {
  let app: App;
  let server: Server;
  let client: Client;

  beforeEach(async () => {
    app = createApp({ debug: true });
    server = new Server(toNodeListener(app));
    const port = await getPort();
    server.listen(port);
    client = new Client(`http://localhost:${port}`);
  });

  afterEach(() => {
    client.close();
    server.close();
  });

  it("backpressures a fast upload while the web reader is stalled", async () => {
    const chunk = Buffer.alloc(64 * 1024, "a");
    const req = Readable.from(
      Array.from({ length: 128 }, () => chunk),
      {
        objectMode: false,
        highWaterMark: chunk.length,
      },
    );
    let webBytes = 0;
    let chunks = 0;
    req.on("data", (data: Buffer) => {
      webBytes += data.length;
      chunks++;
    });
    const reader = getRequestWebStream({
      method: "POST",
      node: { req },
    } as any)!.getReader();
    const first = await reader.read();
    // The in-memory source can finish this turn unless the bridge pauses it.
    await nextTurn();
    const buffered = {
      webBytes: webBytes - first.value.length,
      nodeBytes: req.readableLength,
      highWaterMark: req.readableHighWaterMark,
      chunks,
    };
    let bytes = first.value.length;
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      bytes += value.length;
    }
    console.log("backpressure:", buffered);
    expect(bytes).toBe(128 * chunk.length);
    // At most one queued Web chunk plus Node's high water mark.
    expect(buffered.webBytes + buffered.nodeBytes).toBeLessThanOrEqual(
      2 * chunk.length,
    );
    expect(buffered.chunks).toBeLessThanOrEqual(2);
  });

  it("fulfills two concurrent pending web reads", async () => {
    const chunks = [Buffer.from("first"), Buffer.from("second")];
    const req = Readable.from(chunks, { objectMode: false });
    const reader = getRequestWebStream({
      method: "POST",
      node: { req },
    } as any)!.getReader();

    expect(await Promise.all([reader.read(), reader.read()])).toEqual(
      chunks.map((value) => ({ value, done: false })),
    );
    expect(await reader.read()).toEqual({ value: undefined, done: true });
  });

  it("rejects after the client aborts before the first pull", async () => {
    const result = new Promise<unknown>((resolve) => {
      app.use(
        eventHandler(async (event) => {
          const body = getRequestWebStream(event)!;
          await new Promise<void>((closed) => {
            event.node.req.once("close", closed);
          });
          resolve(new Response(body).text().catch((error) => error));
          return "ok";
        }),
      );
    });
    const received = once(server, "request");
    const upload = request({
      hostname: "localhost",
      port: (server.address() as { port: number }).port,
      method: "POST",
    });
    upload.on("error", () => {});
    try {
      upload.write("first");
      const [incoming] = await received;
      upload.socket!.destroy();
      expect(await result).toBe(incoming.errored);
      expect(incoming.errored).toMatchObject({
        message: "aborted",
        code: "ECONNRESET",
      });
    } finally {
      upload.destroy();
      server.closeAllConnections();
    }
  }, 1500);

  it.each(["destroyed", "ended"])(
    "settles a request already %s before the first pull",
    async (state) => {
      const req = new PassThrough();
      const reader = getRequestWebStream({
        method: "POST",
        node: { req },
      } as any)!.getReader();
      const finished = once(req, state === "ended" ? "end" : "close");
      if (state === "ended") {
        req.end();
        req.resume();
      } else {
        req.destroy();
      }
      await finished;
      expect(req.errored).toBeNull();
      if (state === "ended") {
        expect(await reader.read()).toEqual({ value: undefined, done: true });
      } else {
        await expect(reader.read()).rejects.toMatchObject({
          message: "aborted",
          code: "ECONNRESET",
        });
      }
    },
    1500,
  );

  it("delivers a complete buffered upload before the first pull", async () => {
    const body = "all buffered upload bytes";
    app.use(
      eventHandler(async (event) => {
        const stream = getRequestWebStream(event)!;
        const req = event.node.req;
        await once(req, "readable");
        await nextTurn();
        expect(req.complete).toBe(true);
        expect(req.readableEnded).toBe(false);
        expect(req.readableLength).toBe(Buffer.byteLength(body));
        return await new Response(stream).text();
      }),
    );
    const response = await client.request({
      path: "/",
      method: "POST",
      headers: { "content-length": String(Buffer.byteLength(body)) },
      body,
    });
    expect(await response.body.text()).toBe(body);
  }, 1500);

  it("rejects a pending web read when the response finishes", async () => {
    let reader: ReadableStreamDefaultReader;
    const pending = new Promise<unknown>((resolve) => {
      app.use(
        eventHandler(async (event) => {
          reader = getRequestWebStream(event)!.getReader();
          await reader.read();
          resolve(reader.read().catch((error) => error));
          return "ok";
        }),
      );
    });
    const body = new PassThrough();
    try {
      const response = client.request({ path: "/", method: "POST", body });
      body.write("first");
      expect(await (await response).body.text()).toBe("ok");
      expect(await pending).toMatchObject({
        message: "Response already finished",
      });
      await expect(reader!.read()).rejects.toThrow("Response already finished");
    } finally {
      body.destroy();
      server.closeAllConnections();
    }
  }, 1500);

  it("rejects the first web read after an early response drains the upload", async () => {
    let stream: ReadableStream;
    let incoming: IncomingMessage;
    app.use(
      eventHandler((event) => {
        incoming = event.node.req;
        stream = getRequestWebStream(event)!;
        return "ok";
      }),
    );
    const upload = request({
      hostname: "localhost",
      port: (server.address() as { port: number }).port,
      method: "POST",
      headers: { "content-length": 9 },
    });
    upload.on("error", () => {});
    try {
      const response = once(upload, "response");
      upload.write("first");
      const [res] = await response;
      let result = "";
      for await (const chunk of res) {
        result += chunk;
      }
      expect(result).toBe("ok");
      expect(incoming!.complete).toBe(false);
      const ended = once(incoming!, "end");
      upload.end("late");
      await ended;
      expect(incoming!.readableEnded).toBe(true);
      await expect(new Response(stream!).text()).rejects.toThrow(
        "Response already finished",
      );
    } finally {
      upload.destroy();
      server.closeAllConnections();
    }
  }, 1500);

  it("rejects a pending web read when the request closes without an error", async () => {
    let incoming: IncomingMessage;
    let pending: Promise<unknown>;
    const reading = new Promise<void>((resolve) => {
      app.use(
        eventHandler(async (event) => {
          incoming = event.node.req;
          const reader = getRequestWebStream(event)!.getReader();
          await reader.read();
          pending = reader.read();
          resolve();
          await pending.catch(() => {});
          return "ok";
        }),
      );
    });
    const upload = request({
      hostname: "localhost",
      port: (server.address() as { port: number }).port,
      method: "POST",
    });
    upload.on("error", () => {});
    try {
      upload.write("first");
      await reading;
      const closed = once(incoming!, "close");
      incoming!.destroy();
      await closed;
      expect(incoming!.readableEnded).toBe(false);
      expect(incoming!.errored).toBeNull();
      await expect(pending!).rejects.toMatchObject({
        message: "aborted",
        code: "ECONNRESET",
      });
    } finally {
      upload.destroy();
      server.closeAllConnections();
    }
  }, 1500);

  it.each([
    ["an unused Web body", false, false],
    ["toWebRequest and readRawBody", true, false],
    ["a partial Web body read", false, true],
  ])("keeps a socket usable after %s", async (_name, readRaw, readPartial) => {
    const total = 512 * 1024;
    const firstChunk = Buffer.alloc(1024, "a");
    let incoming: IncomingMessage;
    let connections = 0;
    server.on("connection", () => connections++);
    app.use(
      eventHandler(async (event) => {
        if (event.method === "GET") {
          return "ok";
        }
        incoming = event.node.req;
        if (readPartial) {
          const { value, done } = await getRequestWebStream(event)!
            .getReader()
            .read();
          expect(done).toBe(false);
          expect(value.length).toBeGreaterThan(0);
          expect(value).toEqual(firstChunk.subarray(0, value.length));
          return "ok";
        }
        toWebRequest(event);
        if (readRaw) {
          return String((await readRawBody(event, false))?.length ?? 0);
        }
        await once(incoming, "data");
        return "ok";
      }),
    );

    const agent = new Agent({ keepAlive: true, maxSockets: 1 });
    const requests: ReturnType<typeof request>[] = [];
    const send = (method: string, length?: number) => {
      const req = request({
        hostname: "localhost",
        port: (server.address() as { port: number }).port,
        method,
        agent,
        headers: length === undefined ? {} : { "content-length": length },
      });
      requests.push(req);
      req.setTimeout(1500, () => req.destroy(new Error("Request timed out")));
      const response = once(req, "response").then(async ([res]) => {
        let body = "";
        for await (const chunk of res) {
          body += chunk;
        }
        return { status: res.statusCode, body, reused: req.reusedSocket };
      });
      return { req, response };
    };

    try {
      const post = send("POST", total);
      if (readRaw) {
        post.req.end(Buffer.alloc(total, "a"));
      } else {
        post.req.write(firstChunk);
      }
      expect(await post.response).toMatchObject({
        status: 200,
        body: readRaw ? String(total) : "ok",
      });
      if (!readRaw) {
        const finished = once(post.req, "finish");
        post.req.end(Buffer.alloc(total - 1024, "a"));
        await finished;
      }
      const next = send("GET");
      next.req.end();
      expect(await next.response).toEqual({
        status: 200,
        body: "ok",
        reused: true,
      });
      expect(connections).toBe(1);
      expect(incoming!.readableEnded).toBe(true);
    } finally {
      for (const req of requests) {
        req.destroy();
      }
      agent.destroy();
      server.closeAllConnections();
    }
  });

  it.each([false, true])("cancels uploads (early: %s)", async (early) => {
    const events = ["data", "end", "error"] as const;
    let request: IncomingMessage;
    let firstChunk: ReadableStreamReadResult<Buffer>;
    let listenerCounts: number[];
    let onCancelled: () => void;
    let onFinished: () => void;
    const cancelled = new Promise<void>((resolve) => {
      onCancelled = resolve;
    });
    const finished = new Promise<void>((resolve) => {
      onFinished = resolve;
    });

    app.use(
      "/",
      eventHandler(async (event) => {
        request = event.node.req;
        request.once("close", onFinished);
        listenerCounts = events.map((name) => request.listenerCount(name));
        const reader = getRequestWebStream(event)!.getReader();
        firstChunk = await reader.read();
        await reader.cancel(new Error("Stop reading"));
        onCancelled();
        if (!early) {
          await finished;
        }
        expect(events.map((name) => request.listenerCount(name))).toEqual(
          listenerCounts,
        );
        setResponseStatus(event, 413);
        return "rejected";
      }),
    );

    const body = new PassThrough();
    const response = client.request({ path: "/", method: "POST", body }).then(
      async (result) => ({
        status: result.statusCode,
        body: await result.body.text(),
      }),
      (error) => ({ error: error.code }),
    );
    const uncaughtErrors: Error[] = [];
    const onUncaughtError = (error: Error) => uncaughtErrors.push(error);
    process.on("uncaughtExceptionMonitor", onUncaughtError);
    try {
      body.write("first");
      await cancelled;
      if (!early) {
        body.end("late");
        await finished;
      }
      expect(await response).toEqual({ status: 413, body: "rejected" });
      expect(firstChunk!.value).toEqual(Buffer.from("first"));
      expect(uncaughtErrors).toEqual([]);
    } finally {
      process.off("uncaughtExceptionMonitor", onUncaughtError);
      body.destroy();
    }
  });

  describe("readRawBody", () => {
    it("can handle raw string", async () => {
      app.use(
        "/",
        eventHandler(async (request) => {
          const body = await readRawBody(request);
          expect(body).toEqual('{"bool":true,"name":"string","number":1}');
          return "200";
        }),
      );
      const result = await client.request({
        path: "/api/test",
        method: "POST",
        body: JSON.stringify({
          bool: true,
          name: "string",
          number: 1,
        }),
      });

      expect(await result.body.text()).toBe("200");
    });

    it("can handle chunked string", async () => {
      const requestJsonUrl = new URL("assets/sample.json", import.meta.url);
      app.use(
        "/",
        eventHandler(async (request) => {
          const body = await readRawBody(request);
          const json = (await readFile(requestJsonUrl)).toString("utf8");

          expect(body).toEqual(json);
          return "200";
        }),
      );
      const result = await client.request({
        path: "/api/test",
        method: "POST",
        body: createReadStream(requestJsonUrl),
      });

      expect(await result.body.text()).toBe("200");
    });

    it("returns undefined if body is not present", async () => {
      let _body: string | undefined = "initial";
      app.use(
        "/",
        eventHandler(async (request) => {
          _body = await readRawBody(request);
          return "200";
        }),
      );
      const result = await client.request({
        path: "/api/test",
        method: "POST",
      });

      expect(_body).toBeUndefined();
      expect(await result.body.text()).toBe("200");
    });

    it("handles case-insensitive Transfer-Encoding: chunked header (CVE)", async () => {
      // Test that Transfer-Encoding header check is case-insensitive per RFC 7230
      // This prevents HTTP Request Smuggling via TE.TE desynchronization attacks

      const testCases = [
        { encoding: "ChunKed", expected: '{"test":"data"}' },
        { encoding: "CHUNKED", expected: '{"test":"data"}' },
        { encoding: "Chunked", expected: '{"test":"data"}' },
      ];

      for (const testCase of testCases) {
        // Simulate a raw HTTP request with mixed-case Transfer-Encoding
        const mockReq = {
          method: "POST",
          headers: { "transfer-encoding": testCase.encoding },
          on(event: string, handler: (chunk?: Buffer) => void) {
            if (event === "data") {
              // Simulate chunked data arrival
              handler(Buffer.from(testCase.expected));
            } else if (event === "end") {
              handler();
            }
            return this;
          },
        };

        const mockEvent = { method: "POST", node: { req: mockReq } };

        const result = await readRawBody(mockEvent as any);

        // Should properly read the body regardless of Transfer-Encoding case
        // If the check is case-sensitive, this will fail and return undefined
        expect(result).toEqual(testCase.expected);
      }
    });

    it("returns an empty string if body is empty", async () => {
      let _body: string | undefined = "initial";
      app.use(
        "/",
        eventHandler(async (request) => {
          _body = await readRawBody(request);
          return "200";
        }),
      );
      const result = await client.request({
        path: "/api/test",
        method: "POST",
        body: '""',
      });

      expect(_body).toBe('""');
      expect(await result.body.text()).toBe("200");
    });

    it("returns an empty object string if body is empty object", async () => {
      let _body: string | undefined = "initial";
      app.use(
        "/",
        eventHandler(async (request) => {
          _body = await readRawBody(request);
          return "200";
        }),
      );
      const result = await client.request({
        path: "/api/test",
        method: "POST",
        body: "{}",
      });

      expect(_body).toBe("{}");
      expect(await result.body.text()).toBe("200");
    });
  });

  describe("readBody", () => {
    it("can parse json payload", async () => {
      app.use(
        "/",
        eventHandler(async (request) => {
          const body = await readBody(request);
          expect(body).toMatchObject({
            bool: true,
            name: "string",
            number: 1,
          });
          return "200";
        }),
      );
      const result = await client.request({
        path: "/api/test",
        method: "POST",
        body: JSON.stringify({
          bool: true,
          name: "string",
          number: 1,
        }),
      });

      expect(await result.body.text()).toBe("200");
    });

    it("handles non-present body", async () => {
      let _body: string | undefined;
      app.use(
        "/",
        eventHandler(async (request) => {
          _body = await readBody(request);
          return "200";
        }),
      );
      const result = await client.request({
        path: "/api/test",
        method: "POST",
      });
      expect(_body).toBeUndefined();
      expect(await result.body.text()).toBe("200");
    });

    it("handles empty body", async () => {
      let _body: string | undefined = "initial";
      app.use(
        "/",
        eventHandler(async (request) => {
          _body = await readBody(request);
          return "200";
        }),
      );
      const result = await client.request({
        path: "/api/test",
        method: "POST",
        headers: {
          "Content-Type": "text/plain",
        },
        body: '""',
      });
      expect(_body).toStrictEqual('""');
      expect(await result.body.text()).toBe("200");
    });

    it("handles empty object as body", async () => {
      let _body: string | undefined = "initial";
      app.use(
        "/",
        eventHandler(async (request) => {
          _body = await readBody(request);
          return "200";
        }),
      );
      const result = await client.request({
        path: "/api/test",
        method: "POST",
        body: "{}",
      });
      expect(_body).toStrictEqual({});
      expect(await result.body.text()).toBe("200");
    });

    it("parse the form encoded into an object", async () => {
      app.use(
        "/",
        eventHandler(async (request) => {
          const body = await readBody(request);
          expect(body).toMatchObject({
            field: "value",
            another: "true",
            number: ["20", "30", "40"],
          });
          return "200";
        }),
      );
      const result = await client.request({
        path: "/api/test",
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        },
        body: "field=value&another=true&number=20&number=30&number=40",
      });

      expect(await result.body.text()).toBe("200");
    });

    it("handle readBody with buffer type (unenv)", async () => {
      app.use(
        "/",
        eventHandler(async (event) => {
          // Emulate unenv
          // @ts-ignore
          event.node.req.body = Buffer.from("test");

          const body = await readBody(event);
          expect(body).toMatchObject("test");

          return "200";
        }),
      );
      const result = await client.request({
        path: "/api/test",
        method: "POST",
      });

      expect(await result.body.text()).toBe("200");
    });

    it("handle readBody with Object type (unenv)", async () => {
      app.use(
        "/",
        eventHandler(async (event) => {
          // Emulate unenv
          // @ts-ignore
          event.node.req.body = { test: 1 };

          const body = await readBody(event);
          expect(body).toMatchObject({ test: 1 });

          return "200";
        }),
      );
      const result = await client.request({
        path: "/api/test",
        method: "POST",
      });

      expect(await result.body.text()).toBe("200");
    });

    it("handle readRawBody with array buffer type (unenv)", async () => {
      app.use(
        "/",
        eventHandler(async (event) => {
          // Emulate unenv
          // @ts-ignore
          event.node.req.body = new Uint8Array([1, 2, 3]);
          const body = await readRawBody(event, false);
          expect(body).toBeInstanceOf(Buffer);
          expect(body).toMatchObject(Buffer.from([1, 2, 3]));
          return "200";
        }),
      );
      const result = await client.request({
        path: "/api/test",
        method: "POST",
      });
      expect(await result.body.text()).toBe("200");
    });

    it("parses multipart form data", async () => {
      app.use(
        "/",
        eventHandler(async (request) => {
          const parts = (await readMultipartFormData(request)) || [];
          return parts.map((part) => ({
            ...part,
            data: part.data.toString("utf8"),
          }));
        }),
      );
      const result = await client.request({
        path: "/api/test",
        method: "POST",
        headers: {
          "content-type":
            "multipart/form-data; boundary=---------------------------12537827810750053901680552518",
        },
        body: '-----------------------------12537827810750053901680552518\r\nContent-Disposition: form-data; name="baz"\r\n\r\nother\r\n-----------------------------12537827810750053901680552518\r\nContent-Disposition: form-data; name="号楼电表数据模版.xlsx"\r\n\r\nsomething\r\n-----------------------------12537827810750053901680552518--\r\n',
      });

      expect(await result.body.json()).toMatchInlineSnapshot(`
        [
          {
            "data": "other",
            "name": "baz",
          },
          {
            "data": "something",
            "name": "号楼电表数据模版.xlsx",
          },
        ]
      `);
    });

    it("returns undefined if body is not present with text/plain", async () => {
      let _body: string | undefined;
      app.use(
        "/",
        eventHandler(async (request) => {
          _body = await readBody(request);
          return "200";
        }),
      );
      const result = await client.request({
        path: "/api/test",
        method: "POST",
        headers: {
          "Content-Type": "text/plain",
        },
      });

      expect(_body).toBeUndefined();
      expect(await result.body.text()).toBe("200");
    });

    it("returns undefined if body is not present with json", async () => {
      let _body: string | undefined;
      app.use(
        "/",
        eventHandler(async (request) => {
          _body = await readBody(request);
          return "200";
        }),
      );
      const result = await client.request({
        path: "/api/test",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      });

      expect(_body).toBeUndefined();
      expect(await result.body.text()).toBe("200");
    });

    it("returns the string if content type is text/*", async () => {
      let _body: string | undefined;
      app.use(
        "/",
        eventHandler(async (request) => {
          _body = await readBody(request);
          return "200";
        }),
      );
      const result = await client.request({
        path: "/api/test",
        method: "POST",
        headers: {
          "Content-Type": "text/*",
        },
        body: '{ "hello": true }',
      });

      expect(_body).toBe('{ "hello": true }');
      expect(await result.body.text()).toBe("200");
    });

    it("returns string as is if cannot parse with unknown content type", async () => {
      app.use(
        "/",
        eventHandler(async (request) => {
          const _body = await readBody(request);
          return _body;
        }),
      );
      const result = await client.request({
        path: "/api/test",
        method: "POST",
        headers: {
          "Content-Type": "application/foobar",
        },
        body: "{ test: 123 }",
      });

      expect(result.statusCode).toBe(200);
      expect(await result.body.text()).toBe("{ test: 123 }");
    });

    it("fails if json is invalid", async () => {
      app.use(
        "/",
        eventHandler(async (request) => {
          const _body = await readBody(request);
          return _body;
        }),
      );
      const result = await client.request({
        path: "/api/test",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: '{ "hello": true',
      });
      const resultJson = (await result.body.json()) as any;

      expect(result.statusCode).toBe(400);
      expect(resultJson.statusMessage).toBe("Bad Request");
      expect(resultJson.stack[0]).toBe("Error: Invalid JSON body");
    });
  });
});
