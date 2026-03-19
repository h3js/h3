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

  describe("Path traversal prevention", () => {
    // Helper to send raw HTTP requests without URL normalization
    async function rawRequest(path: string) {
      const listener = toNodeListener(app);
      const server = await import("node:http").then((m) =>
        m.createServer(listener),
      );
      await new Promise<void>((resolve) => server.listen(0, resolve));
      const port = (server.address() as any).port;
      try {
        return await new Promise<{ statusCode: number }>((resolve) => {
          httpRequest(
            { hostname: "127.0.0.1", port, path, method: "GET" },
            (res) => resolve({ statusCode: res.statusCode! }),
          ).end();
        });
      } finally {
        server.close();
      }
    }

    // --- Blocked paths (must return 404) ---

    it("blocks basic ../", async () => {
      const res = await rawRequest("/../etc/passwd");
      expect(res.statusCode).toEqual(404);
    });

    it("blocks percent-encoded dot segments (%2e%2e)", async () => {
      const res = await rawRequest("/%2e%2e/%2e%2e/etc/passwd");
      expect(res.statusCode).toEqual(404);
      expect(serveStaticOptions.getMeta).not.toHaveBeenCalledWith(
        expect.stringContaining(".."),
      );
    });

    it("blocks mixed-case percent-encoded dots (%2E%2E)", async () => {
      const res = await rawRequest("/%2E%2E/%2E%2E/etc/passwd");
      expect(res.statusCode).toEqual(404);
    });

    it("blocks mid-path traversal", async () => {
      const res = await rawRequest("/assets/../../etc/passwd");
      expect(res.statusCode).toEqual(404);
    });

    it("blocks trailing /.. segment", async () => {
      const res = await rawRequest("/assets/..");
      expect(res.statusCode).toEqual(404);
    });

    it("blocks backslash traversal (..\\)", async () => {
      const res = await rawRequest("/..\\etc\\passwd");
      expect(res.statusCode).toEqual(404);
    });

    it("blocks encoded backslash traversal (..%5c)", async () => {
      const res = await rawRequest("/..%5c..%5cetc%5cpasswd");
      expect(res.statusCode).toEqual(404);
    });

    it("blocks double-dot only segment", async () => {
      const res = await rawRequest("/..");
      expect(res.statusCode).toEqual(404);
    });

    it("does not pass double-encoded dot segments as traversal to backend", async () => {
      await rawRequest("/%252e%252e/%252e%252e/etc/passwd");
      // Should not reach backend with %2e%2e (which URL backends resolve as ..)
      expect(serveStaticOptions.getMeta).not.toHaveBeenCalledWith(
        expect.stringContaining("%2e%2e"),
      );
    });

    // --- Allowed paths (must NOT be blocked) ---

    it("allows filenames with consecutive dots (e.g. _...grid)", async () => {
      const res = await request.get("/_...grid_123.js");
      expect(res.status).toEqual(200);
      expect(res.text).toContain("asset:/_...grid_123.js");
    });

    it("allows filenames with double dots (e.g. file..name.js)", async () => {
      const res = await request.get("/file..name.js");
      expect(res.status).toEqual(200);
      expect(res.text).toContain("asset:/file..name.js");
    });

    it("allows dotfiles (e.g. .hidden)", async () => {
      const res = await request.get("/.hidden");
      expect(res.status).toEqual(200);
      expect(res.text).toContain("asset:/.hidden");
    });

    it("allows single dot in path", async () => {
      const res = await request.get("/assets/file.txt");
      expect(res.status).toEqual(200);
    });

    it("allows ... directory name", async () => {
      const res = await request.get("/...test/file.js");
      expect(res.status).toEqual(200);
      expect(res.text).toContain("asset:/...test/file.js");
    });
  });
});
