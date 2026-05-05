import { beforeEach, vi } from "vitest";
import { serveStatic, type ServeStaticOptions } from "../src/index.ts";
import { describeMatrix } from "./_setup.ts";

describeMatrix("serve static", (t, { it, expect }) => {
  beforeEach(() => {
    const serveStaticOptions: ServeStaticOptions = {
      getContents: vi.fn((id) => (id.includes("404") ? undefined : `asset:${id}`)),
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

  it("Prevents path traversal via encoded dot segments", async () => {
    const res = await t.fetch("/%2e%2e/%2e%2e/etc/passwd");
    expect(res.status).toEqual(200);
    const text = await res.text();
    // After resolving dot segments, `/../../../etc/passwd` becomes `/etc/passwd`
    // The id must NOT contain `..` traversal sequences
    expect(text).not.toContain("..");
    expect(text).toMatch(/^asset:\/etc\/passwd/);
  });

  it("blocks path traversal attempts", async () => {
    const blocked = [
      "/../etc/passwd",
      "/%2e%2e/",
      "/%2E%2E/",
      "/assets/../../etc/passwd",
      "/assets/..",
      "/..\\etc\\passwd",
      "/..%5c..%5cetc%5cpasswd",
      "/..",
    ];
    for (const path of blocked) {
      const res = await t.fetch(path);
      const text = await res.text();
      expect(text).not.toContain("..");
    }
  });

  it("does not pass double-encoded dot segments as traversal to backend", async () => {
    const res = await t.fetch("/%252e%252e/%252e%252e/etc/passwd");
    const text = await res.text();
    // After first decode: %2e%2e/%2e%2e/etc/passwd
    // Backend must NOT see %2e%2e which could be resolved as .. by downstream
    expect(text).not.toContain("%2e%2e");
    expect(text).not.toContain("%2E%2E");
  });

  it("allows legitimate paths with dots", async () => {
    const allowed = [
      "/_...grid_123.js",
      "/file..name.js",
      "/.hidden",
      "/assets/file.txt",
      "/...test/file.js",
    ];
    for (const path of allowed) {
      const res = await t.fetch(path);
      expect(res.status).toEqual(200);
      const text = await res.text();
      expect(text).toContain("asset:");
    }
  });
});

describeMatrix("serve static with fallthrough", (t, { it, expect }) => {
  beforeEach(() => {
    const serveStaticOptions = {
      getContents: vi.fn((id) => {
        return id.includes("404") || id.includes("fallthrough") ? undefined : `asset:${id}`;
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

  it("Uses custom getType function", async () => {
    const customOptions: ServeStaticOptions = {
      getContents: vi.fn(() => "content"),
      getMeta: vi.fn(() => ({ size: 10 })),
      getType: vi.fn((ext) => (ext === ".xyz" ? "application/custom" : undefined)),
    };

    t.app.all("/custom/**", (event) => {
      return serveStatic(event, customOptions);
    });

    const res = await t.fetch("/custom/file v2.xyz?query=123");
    expect(res.headers.get("content-type")).toBe("application/custom");
    expect(customOptions.getType).toHaveBeenCalledWith(".xyz");

    const res2 = await t.fetch("/custom/file.txt");
    expect(res2.headers.get("content-type")).toBe("text/plain");

    const res3 = await t.fetch("/custom/file");
    expect(res3.headers.get("content-type")).toBe(
      t.target === "web" ? null : "text/plain; charset=UTF-8",
    );
  });
});
