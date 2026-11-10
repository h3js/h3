import { brotliCompressSync, deflateSync, gzipSync } from "node:zlib";
import { vi } from "vitest";
import { proxyRequest } from "../src/utils/proxy.ts";
import { describeMatrix } from "./_setup.ts";

describeMatrix("proxy response content-length", (t, { it, expect }) => {
  // Exercise internal sub-requests in web mode and native fetch over HTTP in node mode.
  const upstream = () => (t.target === "node" ? `${t.url}/upstream` : "/upstream");

  for (const status of [200, 206]) {
    it(`preserves content-length for an unencoded ${status} response`, async () => {
      const body = new Uint8Array([0, 255]);
      t.app.all(
        "/upstream",
        () =>
          new Response(body, {
            status,
            headers: {
              "content-type": "video/mp4",
              "content-length": "2",
              "accept-ranges": "bytes",
              ...(status === 206 ? { "content-range": "bytes 0-1/100" } : {}),
            },
          }),
      );
      t.app.all("/", (event) => proxyRequest(event, upstream()));

      const res = await t.fetch("/", {
        headers: status === 206 ? { range: "bytes=0-1" } : {},
      });
      expect(res.status).toBe(status);
      expect(res.headers.get("content-length")).toBe("2");
      expect(res.headers.get("accept-ranges")).toBe("bytes");
      expect(res.headers.get("content-range")).toBe(status === 206 ? "bytes 0-1/100" : null);
      expect(new Uint8Array(await res.arrayBuffer())).toEqual(body);
    });
  }

  it("preserves content-length with identity encoding", async () => {
    t.app.all(
      "/upstream",
      () =>
        new Response("hello", {
          headers: { "content-length": "5", "content-encoding": "Identity" },
        }),
    );
    t.app.all("/", (event) => proxyRequest(event, upstream()));

    const res = await t.fetch("/");
    expect(res.headers.get("content-length")).toBe("5");
    expect(res.headers.has("content-encoding")).toBe(false);
    expect(await res.text()).toBe("hello");
  });

  it("preserves the representation length for HEAD", async () => {
    t.app.all("/upstream", () => new Response(null, { headers: { "content-length": "100" } }));
    t.app.all("/", (event) => proxyRequest(event, upstream()));

    const res = await t.fetch("/", { method: "HEAD" });
    expect(res.headers.get("content-length")).toBe("100");
    expect(await res.text()).toBe("");
  });

  it("does not send a HEAD representation length for a downstream GET", async () => {
    t.app.all("/upstream", (event) => {
      expect(event.req.method).toBe("HEAD");
      return new Response(null, { headers: { "content-length": "5" } });
    });
    t.app.all("/", (event) =>
      proxyRequest(event, upstream(), { fetchOptions: { method: "HEAD" } }),
    );

    const res = await t.fetch("/");
    expect(res.status).toBe(200);
    expect(res.headers.has("content-length")).toBe(false);
    expect(await res.text()).toBe("");
  });

  it("preserves the representation length for 304", async () => {
    t.app.all(
      "/upstream",
      () => new Response(null, { status: 304, headers: { "content-length": "100" } }),
    );
    t.app.all("/", (event) => proxyRequest(event, upstream()));

    const res = await t.fetch("/");
    expect(res.status).toBe(304);
    expect(res.headers.get("content-length")).toBe("100");
    expect(await res.text()).toBe("");
  });

  for (const [method, length] of [
    ["GET", "0"],
    ["HEAD", "5"],
  ] as const) {
    it(`strips content-length from a 204 response to ${method}`, async () => {
      t.app.all(
        "/upstream",
        () =>
          new Response(null, {
            status: 204,
            headers: { "content-length": length },
          }),
      );
      t.app.all("/", (event) => proxyRequest(event, upstream()));

      const res = await t.fetch("/", { method });
      expect(res.status).toBe(204);
      expect(res.headers.has("content-length")).toBe(false);
      expect(await res.text()).toBe("");
    });
  }

  it("drops content-length when transfer-encoding is present", async () => {
    t.app.all(
      "/upstream",
      () =>
        new Response("hello", {
          headers: { "transfer-encoding": "chunked", "content-length": "100" },
        }),
    );
    // Internal targets bypass the HTTP parser that rejects conflicting headers.
    t.app.all("/", (event) => proxyRequest(event, "/upstream"));

    const res = await t.fetch("/");
    expect(res.headers.has("content-length")).toBe(false);
    expect(await res.text()).toBe("hello");
  });

  for (const [encoding, compress] of [
    ["gzip", gzipSync],
    ["deflate", deflateSync],
    ["br", brotliCompressSync],
  ] as const) {
    it.runIf(t.target === "node")(
      `drops the stale length after fetch decompresses ${encoding}`,
      async () => {
        const body = "hello from the compressed upstream".repeat(10);
        const compressed = compress(body);
        t.app.all(
          "/upstream",
          () =>
            new Response(new Uint8Array(compressed), {
              headers: {
                "content-encoding": encoding,
                "content-length": String(compressed.byteLength),
              },
            }),
        );
        t.app.all("/", (event) => proxyRequest(event, upstream()));

        const res = await t.fetch("/");
        expect(res.headers.has("content-encoding")).toBe(false);
        expect(res.headers.has("content-length")).toBe(false);
        expect(await res.text()).toBe(body);
      },
    );
  }

  it("still strips content-length nominated by Connection", async () => {
    t.app.all(
      "/upstream",
      () =>
        new Response("hello", {
          headers: { connection: "Content-Length", "content-length": "5" },
        }),
    );
    t.app.all("/", (event) => proxyRequest(event, upstream()));

    const res = await t.fetch("/");
    expect(res.headers.has("content-length")).toBe(false);
    expect(await res.text()).toBe("hello");
  });

  it.runIf(t.target === "web")(
    "does not trust content-length on a CORS-filtered response",
    async () => {
      // Browser fetch exposes Content-Length but can hide Content-Encoding after decoding.
      const response = new Response("decoded body", { headers: { "content-length": "32" } });
      Object.defineProperty(response, "type", { value: "cors" });
      const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(response);
      try {
        t.app.all("/", (event) => proxyRequest(event, "https://upstream.test/"));
        const res = await t.fetch("/");
        expect(res.headers.has("content-length")).toBe(false);
        expect(await res.text()).toBe("decoded body");
      } finally {
        fetchMock.mockRestore();
      }
    },
  );
});
