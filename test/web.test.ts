import { Server } from "node:http";
import { Client } from "undici";
import getPort from "get-port";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  createApp,
  App,
  eventHandler,
  WebHandler,
  toWebHandler,
  readBody,
  toWebRequest,
  toNodeListener,
} from "../src";

describe("Web handler", () => {
  let app: App;
  let handler: WebHandler;

  beforeEach(() => {
    app = createApp({ debug: true });
    handler = toWebHandler(app);
  });

  it("works", async () => {
    app.use(
      "/test",
      eventHandler(async (event) => {
        const body =
          event.method === "POST" ? await readBody(event) : undefined;
        event.node.res.statusCode = 201;
        event.node.res.statusMessage = "Created";
        return {
          method: event.method,
          path: event.path,
          headers: [...event.headers.entries()],
          body,
          contextKeys: Object.keys(event.context),
        };
      }),
    );

    const res = await handler(
      new Request(new URL("/test/foo/bar", "http://localhost"), {
        method: "POST",
        headers: {
          "X-Test": "true",
        },
        body: "request body",
      }),
      {
        test: true,
      },
    );

    expect(res.status).toBe(201);
    expect(res.statusText).toBe("Created");
    expect([...res.headers.entries()]).toMatchObject([
      ["content-type", "application/json"],
    ]);

    expect(await res.json()).toMatchObject({
      method: "POST",
      path: "/foo/bar",
      body: "request body",
      headers: [
        ["content-type", "text/plain;charset=UTF-8"],
        ["x-test", "true"],
      ],
      contextKeys: ["test"],
    });
  });
});

describe("Web Request", () => {
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

  it("abort request", async () => {
    let aborted = false;

    app.use(
      "/abort",
      eventHandler(async (event) => {
        const req = toWebRequest(event);
        req.signal.addEventListener("abort", () => {
          aborted = true;
        });

        return new ReadableStream({
          async start(controller) {
            while (!req.signal.aborted) {
              controller.enqueue(
                new TextEncoder().encode(new Date().toISOString() + "\n"),
              );
              await new Promise((resolve) => setTimeout(resolve, 100));
            }
            controller.close();
          },
        });
      }),
    );

    const controller = new AbortController();
    const response = await client.request({
      path: "/abort",
      method: "GET",
      signal: controller.signal,
    });
    controller.abort();

    expect(response.statusCode).toBe(200);
    await expect(response.body.text()).rejects.toThrow("aborted");

    // Node.js http1 variant needs a bit of time to process the abort
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(aborted).toBe(true);
  });
});
