import supertest, { SuperTest, Test } from "supertest";
import { describe, it, expect, beforeEach } from "vitest";
import {
  createApp,
  App,
  toNodeListener,
  eventHandler,
  readBody,
  getRequestWebStream,
  getRequestURL,
} from "../src";

describe("Event", () => {
  let app: App;
  let request: SuperTest<Test>;

  beforeEach(() => {
    app = createApp({ debug: false });
    request = supertest(toNodeListener(app));
  });

  it("can read the method", async () => {
    app.use(
      "/",
      eventHandler((event) => {
        expect(event.method).toBe(event.method);
        expect(event.method).toBe("POST");
        return "200";
      }),
    );
    const result = await request.post("/hello");
    expect(result.text).toBe("200");
  });

  it("can read the headers", async () => {
    app.use(
      "/",
      eventHandler((event) => {
        return {
          headers: [...event.headers.entries()],
        };
      }),
    );
    const result = await request
      .post("/hello")
      .set("X-Test", "works")
      .set("Cookie", ["a", "b"]);
    const { headers } = JSON.parse(result.text);
    expect(headers.find(([key]) => key === "x-test")[1]).toBe("works");
    expect(headers.find(([key]) => key === "cookie")[1]).toBe("a; b");
  });

  it("can get request url", async () => {
    app.use(
      "/",
      eventHandler((event) => {
        return getRequestURL(event);
      }),
    );
    const result = await request.get("/hello");
    expect(result.text).toMatch(/http:\/\/127.0.0.1:\d+\/hello/);
  });

  it("can read request body", async () => {
    app.use(
      "/",
      eventHandler(async (event) => {
        const bodyStream = getRequestWebStream(event);
        let bytes = 0;
        // @ts-expect-error TODO: ReadableStream type is not async iterable!
        for await (const chunk of bodyStream) {
          bytes += chunk.length;
        }
        return {
          bytes,
        };
      }),
    );

    const result = await request.post("/hello").send(Buffer.from([1, 2, 3]));

    expect(result.body).toMatchObject({ bytes: 3 });
  });

  it("can convert to a web request", async () => {
    app.use(
      "/",
      eventHandler(async (event) => {
        expect(event.method).toBe("POST");
        expect(event.headers.get("x-test")).toBe("123");
        // TODO: Find a workaround for Node.js 16
        if (!process.versions.node.startsWith("16")) {
          expect(await readBody(event)).toMatchObject({ hello: "world" });
        }
        return "200";
      }),
    );
    const result = await request
      .post("/hello")
      .set("x-test", "123")
      .set("content-type", "application/json")
      .send(JSON.stringify({ hello: "world" }));

    expect(result.text).toBe("200");
  });

  it("can read path with URL", async () => {
    app.use(
      "/",
      eventHandler((event) => {
        expect(event.path).toBe("/?url=https://example.com");
        return "200";
      }),
    );

    const result = await request.get("/?url=https://example.com");

    expect(result.text).toBe("200");
  });
});
