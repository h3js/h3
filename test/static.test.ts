import { request as httpRequest } from "node:http";
import supertest, { SuperTest, Test } from "supertest";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  App,
  createApp,
  toNodeListener,
  eventHandler,
  serveStatic,
} from "../src";

describe("Serve Static", () => {
  let app: App;
  let request: SuperTest<Test>;

  const serveStaticOptions = {
    getContents: vi.fn((id) =>
      id.includes("404") ? undefined : `asset:${id}`,
    ),
    getMeta: vi.fn((id) =>
      id.includes("404")
        ? undefined
        : {
            type: "text/plain",
            encoding: "utf8",
            etag: "w/123",
            mtime: 1_700_000_000_000,
            path: id,
            size: `asset:${id}`.length,
          },
    ),
    indexNames: ["/index.html"],
    encodings: { gzip: ".gz", br: ".br" },
  };

  beforeEach(() => {
    app = createApp({ debug: true });
    app.use(
      "/",
      eventHandler((event) => {
        return serveStatic(event, serveStaticOptions);
      }),
    );
    request = supertest(toNodeListener(app));
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  const expectedHeaders = {
    "content-type": "text/plain",
    etag: "w/123",
    "content-encoding": "utf8",
    "last-modified": new Date(1_700_000_000_000).toUTCString(),
    vary: "accept-encoding",
  };

  it("Can serve asset (GET)", async () => {
    const res = await request
      .get("/test.png")
      .set("if-none-match", "w/456")
      .set("if-modified-since", new Date(1_700_000_000_000 - 1).toUTCString())
      .set("accept-encoding", "gzip, br");

    expect(res.status).toEqual(200);
    expect(res.text).toBe("asset:/test.png.gz");
    expect(res.headers).toMatchObject(expectedHeaders);
    expect(res.headers["content-length"]).toBe("18");
  });

  it("Can serve asset (HEAD)", async () => {
    const headRes = await request
      .head("/test.png")
      .set("if-none-match", "w/456")
      .set("if-modified-since", new Date(1_700_000_000_000 - 1).toUTCString())
      .set("accept-encoding", "gzip, br");

    expect(headRes.status).toEqual(200);
    expect(headRes.text).toBeUndefined();
    expect(headRes.headers).toMatchObject(expectedHeaders);
    expect(headRes.headers["content-length"]).toBe("18");
  });

  it("Handles cache (if-none-match)", async () => {
    const res = await request.get("/test.png").set("if-none-match", "w/123");
    expect(res.headers.etag).toBe(expectedHeaders.etag);
    expect(res.status).toEqual(304);
    expect(res.text).toBe("");
  });

  it("Handles cache (if-modified-since)", async () => {
    const res = await request
      .get("/test.png")
      .set("if-modified-since", new Date(1_700_000_000_001).toUTCString());
    expect(res.status).toEqual(304);
    expect(res.text).toBe("");
  });

  it("Returns 404 if not found", async () => {
    const res = await request.get("/404/test.png");
    expect(res.status).toEqual(404);

    const headRes = await request.head("/404/test.png");
    expect(headRes.status).toEqual(404);
  });

  it("Returns 405 if other methods used", async () => {
    const res = await request.post("/test.png");
    expect(res.status).toEqual(405);
  });

  it("Prevents path traversal via percent-encoded dot segments", async () => {
    const listener = toNodeListener(app);
    const server = await import("node:http").then((m) =>
      m.createServer(listener),
    );
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as any).port;
    try {
      const res = await new Promise<{ statusCode: number }>((resolve) => {
        httpRequest(
          {
            hostname: "127.0.0.1",
            port,
            path: "/%2e%2e/%2e%2e/etc/passwd",
            method: "GET",
          },
          (res) => resolve({ statusCode: res.statusCode! }),
        ).end();
      });
      expect(serveStaticOptions.getMeta).not.toHaveBeenCalledWith(
        expect.stringContaining(".."),
      );
      expect(res.statusCode).toEqual(404);
    } finally {
      server.close();
    }
  });
});
