import { beforeEach, vi } from "vitest";
import { serveStatic, type ServeStaticOptions } from "../src/index.ts";
import { describeMatrix } from "./_setup.ts";

describeMatrix("serve static", (t, { it, expect }) => {
  beforeEach(() => {
    const serveStaticOptions: ServeStaticOptions = {
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
      headers: {
        "cache-control": "public, max-age=86400",
      },
    };

    t.app.all("/**", (event) => {
      return serveStatic(event, serveStaticOptions);
    });
  });

  const expectedHeaders = {
    "content-type": "text/plain",
    etag: "w/123",
    "content-encoding": "utf8",
    "last-modified": new Date(1_700_000_000_000).toUTCString(),
    vary: "accept-encoding",
    "cache-control": "public, max-age=86400",
  };

  it("Can serve asset (GET)", async () => {
    const res = await t.fetch("/test.png", {
      headers: {
        "if-none-match": "w/456",
        "if-modified-since": new Date(1_700_000_000_000 - 1).toUTCString(),
        "accept-encoding": "gzip, br",
      },
    });

    expect(res.status).toEqual(200);
    expect(await res.text()).toBe("asset:/test.png.gz");
    expect(Object.fromEntries(res.headers)).toMatchObject(expectedHeaders);
    expect(res.headers.get("content-length")).toBe("18");
  });

  it("Can serve asset (HEAD)", async () => {
    const headRes = await t.fetch("/test.png", {
      method: "HEAD",
      headers: {
        "if-none-match": "w/456",
        "if-modified-since": new Date(1_700_000_000_000 - 1).toUTCString(),
        "accept-encoding": "gzip, br",
      },
    });

    expect(headRes.status).toEqual(200);
    expect(await headRes.text()).toBe("");
    expect(Object.fromEntries(headRes.headers)).toMatchObject(expectedHeaders);
    expect(headRes.headers.get("content-length")).toBe("18");
  });

  it("Handles cache (if-none-match)", async () => {
    const res = await t.fetch("/test.png", {
      headers: { "if-none-match": "w/123" },
    });
    expect(res.headers.get("etag")).toBe(expectedHeaders.etag);
    expect(res.status).toEqual(304);
    expect(await res.text()).toBe("");
  });

  it("Handles cache (if-modified-since)", async () => {
    const res = await t.fetch("/test.png", {
      headers: {
        "if-modified-since": new Date(1_700_000_000_001).toUTCString(),
      },
    });
    expect(res.status).toEqual(304);
    expect(await res.text()).toBe("");
  });

  it("Returns 404 if not found", async () => {
    const res = await t.fetch("/404/test.png");
    expect(res.status).toEqual(404);

    const headRes = await t.fetch("/404/test.png", { method: "HEAD" });
    expect(headRes.status).toEqual(404);
  });

  it("Returns 405 if other methods used", async () => {
    const res = await t.fetch("/test.png", { method: "POST" });
    expect(res.status).toEqual(405);
  });
});

describeMatrix("serve static with fallthrough", (t, { it, expect }) => {
  beforeEach(() => {
    const serveStaticOptions = {
      getContents: vi.fn((id) => {
        return id.includes("404") || id.includes("fallthrough")
          ? undefined
          : `asset:${id}`;
      }),
      getMeta: vi.fn((id) =>
        id.includes("404") || id.includes("fallthrough")
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
      fallthrough: true,
    } satisfies ServeStaticOptions;

    t.app.use((event) => {
      return serveStatic(event, serveStaticOptions);
    });

    t.app.use((event) => {
      if (event.path.includes("404")) {
        event.res.status = 404;
      }
      return { fallthroughTest: "passing" };
    });
  });

  const expectedHeaders = {
    "content-type": "text/plain",
    etag: "w/123",
    "content-encoding": "utf8",
    "last-modified": new Date(1_700_000_000_000).toUTCString(),
    vary: "accept-encoding",
  };

  it("Can serve asset (GET)", async () => {
    const res = await t.fetch("/test.png", {
      headers: {
        "if-none-match": "w/456",
        "if-modified-since": new Date(1_700_000_000_000 - 1).toUTCString(),
        "accept-encoding": "gzip, br",
      },
    });

    expect(res.status).toEqual(200);
    expect(await res.text()).toBe("asset:/test.png.gz");
    expect(Object.fromEntries(res.headers)).toMatchObject(expectedHeaders);
    expect(res.headers.get("content-length")).toBe("18");
  });

  it("Can serve asset (HEAD)", async () => {
    const headRes = await t.fetch("/test.png", {
      method: "HEAD",
      headers: {
        "if-none-match": "w/456",
        "if-modified-since": new Date(1_700_000_000_000 - 1).toUTCString(),
        "accept-encoding": "gzip, br",
      },
    });

    expect(headRes.status).toEqual(200);
    expect(await headRes.text()).toBe("");
    expect(Object.fromEntries(headRes.headers)).toMatchObject(expectedHeaders);
    expect(headRes.headers.get("content-length")).toBe("18");
  });

  it("Handles cache (if-none-match)", async () => {
    const res = await t.fetch("/test.png", {
      headers: { "if-none-match": "w/123" },
    });
    expect(res.headers.get("etag")).toBe(expectedHeaders.etag);
    expect(res.status).toEqual(304);
    expect(await res.text()).toBe("");
  });

  it("Handles cache (if-modified-since)", async () => {
    const res = await t.fetch("/test.png", {
      headers: {
        "if-modified-since": new Date(1_700_000_000_001).toUTCString(),
      },
    });
    expect(res.status).toEqual(304);
    expect(await res.text()).toBe("");
  });

  it("Returns 404 if not found", async () => {
    const res = await t.fetch("/404/test.png");
    expect(res.status).toEqual(404);

    const headRes = await t.fetch("/404/test.png", { method: "HEAD" });
    expect(headRes.status).toEqual(404);
  });

  it("Falls through to the next handler", async () => {
    const res = await t.fetch("/fallthrough/test.png");
    expect(res.status).toEqual(200);
    expect(await res.json()).toEqual({ fallthroughTest: "passing" });
  });
});

describeMatrix("serve static MIME types", (t, { it, expect }) => {
  beforeEach(() => {
    const serveStaticOptions: ServeStaticOptions = {
      getContents: vi.fn((id) => `content for ${id}`),
      getMeta: vi.fn((id) => ({
        size: 10,
        path: id,
      })),
    };

    t.app.all("/**", (event) => {
      return serveStatic(event, serveStaticOptions);
    });
  });

  it("Sets correct MIME type for CSS", async () => {
    const res = await t.fetch("/styles.css");
    expect(res.headers.get("content-type")).toBe("text/css");
  });

  it("Sets correct MIME type for JavaScript", async () => {
    const res = await t.fetch("/script.js");
    expect(res.headers.get("content-type")).toBe("text/javascript");
  });

  it("Sets correct MIME type for images", async () => {
    const res = await t.fetch("/image.png");
    expect(res.headers.get("content-type")).toBe("image/png");
  });

  it("Uses custom getMimeType function", async () => {
    const customOptions: ServeStaticOptions = {
      getContents: vi.fn(() => "content"),
      getMeta: vi.fn(() => ({ size: 10 })),
      getMimeType: vi.fn(() => "application/custom"),
    };

    t.app.all("/custom/**", (event) => {
      return serveStatic(event, customOptions);
    });

    const res = await t.fetch("/custom/file.xyz");
    expect(res.headers.get("content-type")).toBe("application/custom");
  });

  it("Does not set content-type for unknown", async () => {
    const res = await t.fetch("/unknown.xyz");
    expect(res.headers.get("content-type")).toBeNull();
  });
});
