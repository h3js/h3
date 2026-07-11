import { readFile } from "node:fs/promises";
import { vi, beforeEach } from "vitest";
import { setCookie } from "../src/index.ts";
import { proxy, proxyRequest } from "../src/utils/proxy.ts";
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

        it("appends the client ip to an existing x-forwarded-for", async () => {
          t.app.all("/", (event) => {
            return proxyRequest(event, "/debug", { xfwd: true });
          });

          const result = await t
            .fetch("/", {
              headers: { "x-forwarded-for": "1.2.3.4" },
            })
            .then((r) => r.json());

          // The original value is preserved and possibly extended with the
          // client ip (which may be undefined in web mode, `::1`/`127.0.0.1`
          // in node mode), so assert the prefix rather than an exact match.
          expect(result.headers["x-forwarded-for"]).toMatch(/^1\.2\.3\.4/);
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
