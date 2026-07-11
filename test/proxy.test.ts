import { readFile } from "node:fs/promises";
import { vi, beforeEach } from "vitest";
import { setCookie } from "../src/index.ts";
import { fetchWithEvent, proxy, proxyRequest } from "../src/utils/proxy.ts";
import { describeMatrix } from "./_setup.ts";

describeMatrix("proxy", (t, { it, expect, describe }) => {
  const spy = vi.spyOn(console, "error");
  describe("", () => {
    describe("proxy()", () => {
      it("works", async () => {
        t.app.all("/hello", () => "hello");
        t.app.all("/", (event) => {
          return proxy(event, "/hello");
        });

        const result = await t.fetch("/");

        expect(await result.text()).toBe("hello");
      });

      it.runIf(t.target === "node")(
        "passes upstream redirects through to the client by default",
        async () => {
          t.app.all("/redirect", (event) => {
            event.res.headers.set("location", "https://example.test/moved");
            return new Response(null, {
              status: 302,
              headers: event.res.headers,
            });
          });
          // Proxy to an absolute URL so the external `fetch()` path is exercised.
          t.app.all("/", (event) => {
            return proxy(event, `${t.url}/redirect`);
          });

          const result = await t.fetch("/", { redirect: "manual" });

          // The 3xx response is passed through verbatim, not followed.
          expect(result.status).toBe(302);
          expect(result.headers.get("location")).toBe("https://example.test/moved");
        },
      );
    });

    describe("proxyRequest()", () => {
      it("can proxy request", async () => {
        t.app.all("/debug", async (event) => {
          const headers = Object.fromEntries(event.req.headers.entries());
          const body = await event.req.text();
          return {
            method: event.req.method,
            headers,
            body,
          };
        });

        t.app.all("/", (event) => {
          return proxyRequest(event, "/debug", {
            headers: [["x-custom1", "overridden"]],
            fetchOptions: {
              headers: new Headers({ "x-custom2": "overridden" }),
            },
          });
        });

        const result = await t
          .fetch("/", {
            method: "POST",
            body: "hello",
            headers: {
              "content-type": "text/custom",
              "X-Custom1": "user",
              "X-Custom2": "user",
              "X-Custom3": "user",
            },
          })
          .then((r) => r.json());

        const { headers, ...data } = result;
        expect(headers["content-type"]).toEqual("text/custom");

        expect(headers["x-custom1"]).toEqual("overridden");
        expect(headers["x-custom2"]).toEqual("overridden");
        expect(headers["x-custom3"]).toEqual("user");

        expect(data).toMatchInlineSnapshot(`
          {
            "body": "hello",
            "method": "POST",
          }
        `);
      });

      it("can proxy query request body", async () => {
        t.app.all("/debug", async (event) => {
          return {
            method: event.req.method,
            body: await event.req.text(),
          };
        });

        t.app.all("/", (event) => {
          return proxyRequest(event, "/debug");
        });

        const result = await t
          .fetch("/", {
            method: "QUERY",
            body: "query body",
            headers: {
              "content-type": "text/plain",
            },
          })
          .then((r) => r.json());

        expect(result).toMatchObject({
          method: "QUERY",
          body: "query body",
        });
      });

      it("forwards the body of a custom method (not just the payload allowlist)", async () => {
        t.app.all("/debug", async (event) => {
          return {
            method: event.req.method,
            body: await event.req.text(),
          };
        });

        t.app.all("/", (event) => {
          return proxyRequest(event, "/debug");
        });

        const result = await t
          .fetch("/", {
            method: "REPORT",
            body: "report body",
            headers: {
              "content-type": "text/plain",
            },
          })
          .then((r) => r.json());

        expect(result).toMatchObject({
          method: "REPORT",
          body: "report body",
        });
      });

      it("sets duplex when a stream body is supplied via fetchOptions on a GET event", async () => {
        t.app.all("/debug", async (event) => {
          return {
            method: event.req.method,
            body: await event.req.text(),
          };
        });

        t.app.all("/", (event) => {
          const body = new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode("override body"));
              controller.close();
            },
          });
          // Incoming event is a GET (no body); the caller supplies a stream body
          // and overrides the method. `duplex` must be derived from this final
          // body or the underlying fetch/Request throws.
          return proxyRequest(event, "/debug", {
            fetchOptions: { method: "POST", body },
          });
        });

        const result = await t.fetch("/", { method: "GET" }).then((r) => r.json());

        expect(result).toMatchObject({
          method: "POST",
          body: "override body",
        });
      });

      it("fetchWithEvent forwards a stream body without throwing on duplex", async () => {
        t.app.all("/debug", async (event) => {
          return {
            method: event.req.method,
            body: await event.req.text(),
          };
        });

        t.app.all("/", async (event) => {
          const body = new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode("stream body"));
              controller.close();
            },
          });
          const res = await fetchWithEvent(event, "/debug", { method: "POST", body });
          return res.json();
        });

        const result = await t.fetch("/", { method: "GET" }).then((r) => r.json());

        expect(result).toMatchObject({
          method: "POST",
          body: "stream body",
        });
      });

      it("does not forward incoming accept-encoding header", async () => {
        t.app.all("/debug", (event) => {
          return { headers: Object.fromEntries(event.req.headers.entries()) };
        });

        t.app.all("/", (event) => {
          return proxyRequest(event, "/debug");
        });

        const result = await t
          .fetch("/", {
            headers: { "accept-encoding": "zstd, br, gzip" },
          })
          .then((r) => r.json());

        expect(result.headers["accept-encoding"]).toBeUndefined();
      });

      it("forwards the incoming accept header to the upstream", async () => {
        t.app.all("/debug", (event) => {
          return { accept: event.req.headers.get("accept") };
        });

        t.app.all("/", (event) => {
          return proxyRequest(event, "/debug");
        });

        const result = await t
          .fetch("/", {
            headers: { accept: "application/json" },
          })
          .then((r) => r.json());

        expect(result.accept).toBe("application/json");
      });

      it("does not forward headers listed in filterHeaders (case-insensitive)", async () => {
        t.app.all("/debug", (event) => {
          return { headers: Object.fromEntries(event.req.headers.entries()) };
        });

        t.app.all("/", (event) => {
          return proxyRequest(event, "/debug", {
            // Mixed-case option must still match the lowercased header name.
            filterHeaders: ["X-Custom"],
          });
        });

        const result = await t
          .fetch("/", {
            headers: { "x-custom": "secret", "x-keep": "kept" },
          })
          .then((r) => r.json());

        expect(result.headers["x-custom"]).toBeUndefined();
        expect(result.headers["x-keep"]).toBe("kept");
      });

      it("strips hop-by-hop headers from the proxied response", async () => {
        t.app.all("/debug", (event) => {
          // Hop-by-hop response headers that must not leak to the client.
          event.res.headers.set("proxy-authenticate", "Basic");
          event.res.headers.set("trailer", "Expires");
          // A normal header that must be preserved.
          event.res.headers.set("x-custom-header", "preserved");
          return "hello";
        });

        t.app.all("/", (event) => {
          return proxyRequest(event, "/debug");
        });

        const res = await t.fetch("/", { method: "GET" });

        expect(res.headers.has("proxy-authenticate")).toBe(false);
        expect(res.headers.has("trailer")).toBe(false);
        expect(res.headers.get("x-custom-header")).toBe("preserved");
        expect(await res.text()).toBe("hello");
      });

      describe("xfwd", () => {
        beforeEach(() => {
          t.app.all("/debug", (event) => {
            return { headers: Object.fromEntries(event.req.headers.entries()) };
          });
        });

        it("adds x-forwarded-* headers when enabled", async () => {
          t.app.all("/", (event) => {
            return proxyRequest(event, "/debug", { xfwd: true });
          });

          const result = await t.fetch("/").then((r) => r.json());
          const headers = result.headers;

          expect(headers["x-forwarded-proto"]).toBe("http");
          expect(headers["x-forwarded-host"]).toBeTruthy();
          expect(headers["x-forwarded-port"]).toBeTruthy();
        });

        it("does not override an existing x-forwarded-for", async () => {
          t.app.all("/", (event) => {
            return proxyRequest(event, "/debug", { xfwd: true });
          });

          const result = await t
            .fetch("/", {
              headers: { "x-forwarded-for": "1.2.3.4" },
            })
            .then((r) => r.json());

          expect(result.headers["x-forwarded-for"]).toBe("1.2.3.4");
        });

        it("does not add x-forwarded-* headers by default", async () => {
          t.app.all("/", (event) => {
            return proxyRequest(event, "/debug");
          });

          const result = await t.fetch("/").then((r) => r.json());
          expect(result.headers["x-forwarded-proto"]).toBeUndefined();
        });
      });

      it("can proxy binary request", async () => {
        t.app.all("/debug", async (event) => {
          const body = await event.req.arrayBuffer();
          return {
            headers: Object.fromEntries(event.req.headers.entries()),
            bytes: body.byteLength,
          };
        });

        t.app.all("/", (event) => {
          event.res.headers.set("x-res-header", "works");
          return proxyRequest(event, "/debug");
        });

        const dummyFile = await readFile(new URL("assets/dummy.pdf", import.meta.url));

        const res = await t.fetch("/", {
          method: "POST",
          body: dummyFile as BufferSource,
          headers: {
            "x-req-header": "works",
          },
        });
        const resBody = await res.json();

        expect(res.headers.get("x-res-header")).toEqual("works");
        expect(resBody.headers["x-req-header"]).toEqual("works");
        expect(resBody.bytes).toEqual(dummyFile.length);
      });

      it("can proxy stream request", async () => {
        t.app.all("/debug", async (event) => {
          return {
            body: await event.req.text(),
            headers: Object.fromEntries(event.req.headers.entries()),
          };
        });

        t.app.all("/", (event) => {
          return proxyRequest(event, "/debug");
        });

        const isNode16 = process.version.startsWith("v16.");
        const body = isNode16
          ? "This is a streamed request."
          : new ReadableStream({
              start(controller) {
                controller.enqueue("This ");
                controller.enqueue("is ");
                controller.enqueue("a ");
                controller.enqueue("streamed ");
                controller.enqueue("request.");
                controller.close();
              },
            }).pipeThrough(new TextEncoderStream());

        const res = await t.fetch("/", {
          method: "POST",
          body,
          // @ts-ignore
          duplex: "half",
          headers: {
            "content-type": "application/octet-stream",
            "x-custom": "hello",
            "content-length": "27",
          },
        });
        expect(await res.json()).toMatchObject({
          body: "This is a streamed request.",
          headers: {
            "content-type": "application/octet-stream",
            "x-custom": "hello",
          },
        });
      });

      it("can proxy json transparently", async () => {
        const message = '{"hello":"world"}';

        t.app.all("/debug", (event) => {
          event.res.headers.set("content-type", "application/json");
          return message;
        });

        t.app.all("/", (event) => {
          return proxyRequest(event, "/debug");
        });

        const res = await t.fetch("/", {
          method: "GET",
        });

        const resText = await res.text();

        expect(resText).toEqual(message);
      });

      it("preserves custom headers from proxied response", async () => {
        t.app.all("/debug", (event) => {
          event.res.headers.set("x-custom-header", "preserved");
          event.res.headers.set("content-type", "text/plain");
          return "hello";
        });

        t.app.all("/", (event) => {
          return proxyRequest(event, "/debug");
        });

        const res = await t.fetch("/", {
          method: "GET",
        });

        // Custom headers should be preserved
        expect(res.headers.get("x-custom-header")).toEqual("preserved");
        // Content should be proxied correctly
        expect(await res.text()).toEqual("hello");
      });

      it.runIf(t.target === "web")(
        "strips transfer-encoding header from proxied response",
        async () => {
          t.app.all("/debug", (event) => {
            // Simulate an upstream that sends transfer-encoding header
            event.res.headers.set("transfer-encoding", "chunked");
            event.res.headers.set("x-custom-header", "preserved");
            return "hello";
          });

          t.app.all("/", (event) => {
            return proxyRequest(event, "/debug");
          });

          const res = await t.fetch("/", {
            method: "GET",
          });

          // transfer-encoding should be stripped by proxy()
          // (only testable in web mode; node's HTTP server re-adds it for streaming)
          expect(res.headers.has("transfer-encoding")).toBe(false);
          // Other headers should be preserved
          expect(res.headers.get("x-custom-header")).toEqual("preserved");
          expect(await res.text()).toEqual("hello");
        },
      );

      it.runIf(t.target === "web")(
        "forwards the client abort signal to the proxied request",
        async () => {
          t.app.all("/debug", (event) => ({ aborted: event.req.signal.aborted }));
          t.app.all("/", (event) => proxyRequest(event, "/debug"));

          const controller = new AbortController();
          controller.abort();

          const res = await t.fetch("/", { signal: controller.signal });
          expect(await res.json()).toMatchObject({ aborted: true });
        },
      );

      it.runIf(t.target === "web")(
        "handles a client abort quietly (499) by default without throwing",
        async () => {
          t.app.all("/", (event) => proxyRequest(event, "https://example.test/"));

          const controller = new AbortController();
          controller.abort();

          const res = await t.fetch("/", { signal: controller.signal });
          // Client-caused abort is not a gateway error: no 502, no thrown error.
          expect(res.status).toBe(499);
        },
      );

      it.runIf(t.target === "web")(
        "propagates the abort error when `propagateAbortError` is enabled",
        async () => {
          let caught: unknown;
          t.app.all("/", async (event) => {
            try {
              return await proxyRequest(event, "https://example.test/", {
                propagateAbortError: true,
              });
            } catch (error) {
              caught = error;
              return "caught";
            }
          });

          const controller = new AbortController();
          controller.abort();

          const res = await t.fetch("/", { signal: controller.signal });
          expect(await res.text()).toBe("caught");
          expect((caught as Error)?.name).toBe("AbortError");
        },
      );

      it.runIf(t.target === "web")(
        "propagates the abort error from a caller-supplied `fetchOptions.signal`",
        async () => {
          // The client signal is never aborted here; only the caller's own
          // signal is. The abort must still propagate when opted in.
          let caught: unknown;
          t.app.all("/", async (event) => {
            const controller = new AbortController();
            controller.abort();
            try {
              return await proxyRequest(event, "https://example.test/", {
                propagateAbortError: true,
                fetchOptions: { signal: controller.signal },
              });
            } catch (error) {
              caught = error;
              return "caught";
            }
          });

          const res = await t.fetch("/");
          expect(await res.text()).toBe("caught");
          expect((caught as Error)?.name).toBe("AbortError");
          expect(res.status).toBe(200);
        },
      );

      it.runIf(t.target === "web")(
        "forwards the client abort even when a custom `fetchOptions.signal` is set",
        async () => {
          // The caller supplies its own (never-aborted) signal. The client's
          // abort must still be forwarded and handled quietly (499) rather than
          // silently dropped by the spread over `fetchOptions`.
          t.app.all("/", (event) =>
            proxyRequest(event, "https://example.test/", {
              fetchOptions: { signal: new AbortController().signal },
            }),
          );

          const controller = new AbortController();
          controller.abort();

          const res = await t.fetch("/", { signal: controller.signal });
          expect(res.status).toBe(499);
        },
      );

      it.runIf(t.target === "web")(
        "does not turn a mid-stream client abort into a gateway error",
        async () => {
          // Upstream returns a body stream that errors with an AbortError once
          // the client is gone (simulating a mid-stream disconnect). The body is
          // streamed through natively: the handler must still return the upstream
          // response (not a 502), and the abort is left to the stream consumer
          // rather than being turned into a gateway error.
          const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(() => {
            const body = new ReadableStream<Uint8Array>({
              pull(controller) {
                const error = new Error("The operation was aborted.");
                error.name = "AbortError";
                controller.error(error);
              },
            });
            return Promise.resolve(new Response(body, { status: 200 }));
          });

          try {
            t.app.all("/", (event) => proxyRequest(event, "https://upstream.test/"));

            const controller = new AbortController();
            controller.abort();

            const res = await t.fetch("/", { signal: controller.signal });
            // Not a 502: the handler returned the upstream response normally.
            expect(res.status).toBe(200);
            // The abort surfaces to the body consumer, not swallowed silently.
            await expect(res.text()).rejects.toThrow();
          } finally {
            fetchMock.mockRestore();
          }
        },
      );

      it.runIf(t.target === "web")(
        "responds with 504 when the upstream exceeds the timeout",
        async () => {
          // Upstream never resolves until its request signal aborts. The
          // composed `AbortSignal.timeout` fires with a `TimeoutError`, which the
          // proxy maps to `504` (not the `502` generic gateway error).
          const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation((_input, init) => {
            const signal = (init as RequestInit | undefined)?.signal ?? undefined;
            return new Promise<Response>((_resolve, reject) => {
              signal?.addEventListener("abort", () => reject(signal.reason));
            });
          });

          try {
            t.app.all("/", (event) =>
              proxyRequest(event, "https://upstream.test/", { timeout: 50 }),
            );

            const res = await t.fetch("/");
            expect(res.status).toBe(504);
          } finally {
            fetchMock.mockRestore();
          }
        },
      );

      it("succeeds within a generous timeout", async () => {
        t.app.all("/fast", () => "fast");
        t.app.all("/", (event) => proxy(event, "/fast", { timeout: 1000 }));

        const res = await t.fetch("/");
        expect(res.status).toBe(200);
        expect(await res.text()).toBe("fast");
      });

      describe("location rewrite", () => {
        const mockUpstream = (headers: Record<string, string>) =>
          vi
            .spyOn(globalThis, "fetch")
            .mockImplementation(() =>
              Promise.resolve(new Response(null, { status: 302, headers })),
            );

        it.runIf(t.target === "web")(
          "rewrites a location pointing at the target to the proxy origin",
          async () => {
            const fetchMock = mockUpstream({ location: "https://upstream.test/foo/bar?q=1" });
            try {
              let origin = "";
              t.app.all("/", (event) => {
                origin = event.url.origin;
                return proxyRequest(event, "https://upstream.test/test");
              });

              const res = await t.fetch("/", { redirect: "manual" });
              expect(res.status).toBe(302);
              expect(res.headers.get("location")).toBe(`${origin}/foo/bar?q=1`);
            } finally {
              fetchMock.mockRestore();
            }
          },
        );

        it.runIf(t.target === "web")(
          "rewrites a refresh header pointing at the target",
          async () => {
            const fetchMock = mockUpstream({ refresh: "5; url=https://upstream.test/foo" });
            try {
              let origin = "";
              t.app.all("/", (event) => {
                origin = event.url.origin;
                return proxyRequest(event, "https://upstream.test/test");
              });

              const res = await t.fetch("/", { redirect: "manual" });
              expect(res.headers.get("refresh")).toBe(`5; url=${origin}/foo`);
            } finally {
              fetchMock.mockRestore();
            }
          },
        );

        it.runIf(t.target === "web")(
          "leaves third-party and relative locations untouched",
          async () => {
            t.app.all("/", (event) => proxyRequest(event, "https://upstream.test/test"));

            for (const location of ["https://other.test/moved", "/foo/bar"]) {
              const fetchMock = mockUpstream({ location });
              try {
                const res = await t.fetch("/", { redirect: "manual" });
                expect(res.headers.get("location")).toBe(location);
              } finally {
                fetchMock.mockRestore();
              }
            }
          },
        );

        it.runIf(t.target === "web")(
          "forwards the location verbatim with locationRewrite: false",
          async () => {
            const fetchMock = mockUpstream({ location: "https://upstream.test/foo" });
            try {
              t.app.all("/", (event) =>
                proxyRequest(event, "https://upstream.test/test", { locationRewrite: false }),
              );

              const res = await t.fetch("/", { redirect: "manual" });
              expect(res.headers.get("location")).toBe("https://upstream.test/foo");
            } finally {
              fetchMock.mockRestore();
            }
          },
        );
      });

      it(
        "can handle failed proxy requests gracefully",
        async () => {
          spy.mockReset();
          t.app.all("/", (event) => {
            return proxyRequest(
              event,
              "https://this-url-does-not-exist.absudiasdjadioasjdoiasd.test",
            );
          });

          await t.fetch("/", {
            method: "GET",
          });

          expect(spy).not.toHaveBeenCalled();
        },
        60 * 1000,
      );
    });

    describe("multipleCookies", () => {
      it("can split multiple cookies", async () => {
        t.app.all("/setcookies", (event) => {
          setCookie(event, "user", "alice", {
            expires: new Date("Thu, 01 Jun 2023 10:00:00 GMT"),
            httpOnly: true,
          });
          setCookie(event, "role", "guest");
          return {};
        });

        t.app.all("/", (event) => {
          return proxy(event, "/setcookies");
        });

        const result = await t.fetch("/");
        expect(result.headers.getSetCookie()).toEqual([
          "user=alice; Path=/; Expires=Thu, 01 Jun 2023 10:00:00 GMT; HttpOnly",
          "role=guest; Path=/",
        ]);
      });
    });

    describe("cookieDomainRewrite", () => {
      beforeEach(() => {
        t.app.all("/debug", (event) => {
          event.res.headers.set(
            "set-cookie",
            "foo=219ffwef9w0f; Domain=somecompany.co.uk; Path=/; Expires=Wed, 30 Aug 2022 00:00:00 GMT",
          );
          return {};
        });
      });

      it("can rewrite cookie domain by string", async () => {
        t.app.all("/", (event) => {
          return proxyRequest(event, "/debug", {
            cookieDomainRewrite: "new.domain",
          });
        });

        const result = await t.fetch("/");

        expect(result.headers.getSetCookie()[0]).toEqual(
          "foo=219ffwef9w0f; Domain=new.domain; Path=/; Expires=Wed, 30 Aug 2022 00:00:00 GMT",
        );
      });

      it("can rewrite cookie domain by mapper object", async () => {
        t.app.all("/", (event) => {
          return proxyRequest(event, "/debug", {
            cookieDomainRewrite: {
              "somecompany.co.uk": "new.domain",
            },
          });
        });

        const result = await t.fetch("/");

        expect(result.headers.getSetCookie()[0]).toEqual(
          "foo=219ffwef9w0f; Domain=new.domain; Path=/; Expires=Wed, 30 Aug 2022 00:00:00 GMT",
        );
      });

      it("can rewrite domains of multiple cookies", async () => {
        t.app.all("/multiple/debug", (event) => {
          event.res.headers.append(
            "set-cookie",
            "foo=219ffwef9w0f; Domain=somecompany.co.uk; Path=/; Expires=Wed, 30 Aug 2022 00:00:00 GMT",
          );
          event.res.headers.append(
            "set-cookie",
            "bar=38afes7a8; Domain=somecompany.co.uk; Path=/; Expires=Wed, 30 Aug 2022 00:00:00 GMT",
          );
          return {};
        });

        t.app.all("/", (event) => {
          return proxyRequest(event, "/multiple/debug", {
            cookieDomainRewrite: {
              "somecompany.co.uk": "new.domain",
            },
          });
        });

        const result = await t.fetch("/");

        expect(result.headers.getSetCookie()).toEqual([
          "foo=219ffwef9w0f; Domain=new.domain; Path=/; Expires=Wed, 30 Aug 2022 00:00:00 GMT",
          "bar=38afes7a8; Domain=new.domain; Path=/; Expires=Wed, 30 Aug 2022 00:00:00 GMT",
        ]);
      });

      it("can remove cookie domain", async () => {
        t.app.all("/", (event) => {
          return proxyRequest(event, "/debug", {
            cookieDomainRewrite: {
              "somecompany.co.uk": "",
            },
          });
        });

        const result = await t.fetch("/");

        expect(result.headers.getSetCookie()[0]).toEqual(
          "foo=219ffwef9w0f; Path=/; Expires=Wed, 30 Aug 2022 00:00:00 GMT",
        );
      });
    });

    describe("cookiePathRewrite", () => {
      beforeEach(() => {
        t.app.all("/debug", (event) => {
          event.res.headers.set(
            "set-cookie",
            "foo=219ffwef9w0f; Domain=somecompany.co.uk; Path=/; Expires=Wed, 30 Aug 2022 00:00:00 GMT",
          );
          return {};
        });
      });

      it("can rewrite cookie path by string", async () => {
        t.app.all("/", (event) => {
          return proxyRequest(event, "/debug", {
            cookiePathRewrite: "/api",
          });
        });

        const result = await t.fetch("/");

        expect(result.headers.getSetCookie()[0]).toEqual(
          "foo=219ffwef9w0f; Domain=somecompany.co.uk; Path=/api; Expires=Wed, 30 Aug 2022 00:00:00 GMT",
        );
      });

      it("can rewrite cookie path by mapper object", async () => {
        t.app.all("/", (event) => {
          return proxyRequest(event, "/debug", {
            cookiePathRewrite: {
              "/": "/api",
            },
          });
        });

        const result = await t.fetch("/");

        expect(result.headers.getSetCookie()[0]).toEqual(
          "foo=219ffwef9w0f; Domain=somecompany.co.uk; Path=/api; Expires=Wed, 30 Aug 2022 00:00:00 GMT",
        );
      });

      it("can rewrite paths of multiple cookies", async () => {
        t.app.all("/multiple/debug", (event) => {
          event.res.headers.append(
            "set-cookie",
            "foo=219ffwef9w0f; Domain=somecompany.co.uk; Path=/; Expires=Wed, 30 Aug 2022 00:00:00 GMT",
          );
          event.res.headers.append(
            "set-cookie",
            "bar=38afes7a8; Domain=somecompany.co.uk; Path=/; Expires=Wed, 30 Aug 2022 00:00:00 GMT",
          );
          return {};
        });

        t.app.all("/", (event) => {
          return proxyRequest(event, "/multiple/debug", {
            cookiePathRewrite: {
              "/": "/api",
            },
          });
        });

        const result = await t.fetch("/");

        expect(result.headers.getSetCookie()).toEqual([
          "foo=219ffwef9w0f; Domain=somecompany.co.uk; Path=/api; Expires=Wed, 30 Aug 2022 00:00:00 GMT",
          "bar=38afes7a8; Domain=somecompany.co.uk; Path=/api; Expires=Wed, 30 Aug 2022 00:00:00 GMT",
        ]);
      });

      it("can remove cookie path", async () => {
        t.app.all("/", (event) => {
          return proxyRequest(event, "/debug", {
            cookiePathRewrite: {
              "/": "",
            },
          });
        });

        const result = await t.fetch("/");

        expect(result.headers.getSetCookie()[0]).toEqual(
          "foo=219ffwef9w0f; Domain=somecompany.co.uk; Expires=Wed, 30 Aug 2022 00:00:00 GMT",
        );
      });
    });

    describe("onResponse", () => {
      beforeEach(() => {
        t.app.all("/debug", () => {
          return {
            foo: "bar",
          };
        });
      });

      it("allows modifying response event", async () => {
        t.app.all("/", (event) => {
          return proxyRequest(event, "/debug", {
            onResponse(event) {
              event.res.headers.set("x-custom", "hello");
            },
          });
        });

        const result = await t.fetch("/");

        expect(result.headers.get("x-custom")).toEqual("hello");
      });

      it("allows modifying response event async", async () => {
        t.app.all("/", (event) => {
          return proxyRequest(event, "/debug", {
            onResponse(_event) {
              return new Promise((resolve) => {
                resolve(event.res.headers.set("x-custom", "hello"));
              });
            },
          });
        });

        const result = await t.fetch("/");

        expect(result.headers.get("x-custom")).toEqual("hello");
      });

      it("allows to get the actual response", async () => {
        let headers;

        t.app.all("/", (event) => {
          return proxyRequest(event, "/debug", {
            onResponse(_event, response) {
              headers = Object.fromEntries(response.headers.entries());
            },
          });
        });

        await t.fetch("/");

        expect(headers?.["content-type"]).toEqual("application/json;charset=UTF-8");
      });
    });
  });
});
