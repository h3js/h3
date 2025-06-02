import { readFile } from "node:fs/promises";
import { vi, beforeEach } from "vitest";
import { setCookie } from "../src/index.ts";
import { proxy, proxyRequest } from "../src/utils/proxy.ts";
import { describeMatrix } from "./_setup.ts";

describeMatrix("proxy", (t, { it, expect, describe }) => {
  const spy = vi.spyOn(console, "error");
  // TODO: For web support, we need reacursive fetch (without server and url)
  describe.skipIf(t.target === "web")("", () => {
    describe("proxy()", () => {
      it("works", async () => {
        t.app.all("/hello", () => "hello");
        t.app.all("/", (event) => {
          return proxy(event, t.url + "/hello", { fetch });
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
          return proxyRequest(event, t.url + "/debug", {
            fetch,
            headers: [["x-custom1", "overridden"]],
            fetchOptions: {
              headers: new Headers({ "x-custom2": "overridden" }),
            },
          });
        });

        const result = await t
          .fetch(t.url + "/", {
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
          return proxyRequest(event, t.url + "/debug", { fetch });
        });

        const dummyFile = await readFile(
          new URL("assets/dummy.pdf", import.meta.url),
        );

        const res = await t.fetch(t.url + "/", {
          method: "POST",
          body: dummyFile,
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
          return proxyRequest(event, t.url + "/debug", { fetch });
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

        const res = await t.fetch(t.url + "/", {
          method: "POST",
          body,
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
          return proxyRequest(event, t.url + "/debug", { fetch });
        });

        const res = await t.fetch(t.url + "/", {
          method: "GET",
        });

        const resText = await res.text();

        expect(resText).toEqual(message);
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

          await t.fetch(`${t.url}/`, {
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
          return proxy(event, t.url + "/setcookies", { fetch });
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
          return proxyRequest(event, t.url + "/debug", {
            fetch,
            cookieDomainRewrite: "new.domain",
          });
        });

        const result = await t.fetch(t.url + "/");

        expect(result.headers.getSetCookie()[0]).toEqual(
          "foo=219ffwef9w0f; Domain=new.domain; Path=/; Expires=Wed, 30 Aug 2022 00:00:00 GMT",
        );
      });

      it("can rewrite cookie domain by mapper object", async () => {
        t.app.all("/", (event) => {
          return proxyRequest(event, t.url + "/debug", {
            fetch,
            cookieDomainRewrite: {
              "somecompany.co.uk": "new.domain",
            },
          });
        });

        const result = await t.fetch(t.url + "/");

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
          return proxyRequest(event, t.url + "/multiple/debug", {
            fetch,
            cookieDomainRewrite: {
              "somecompany.co.uk": "new.domain",
            },
          });
        });

        const result = await t.fetch(t.url + "/");

        expect(result.headers.getSetCookie()).toEqual([
          "foo=219ffwef9w0f; Domain=new.domain; Path=/; Expires=Wed, 30 Aug 2022 00:00:00 GMT",
          "bar=38afes7a8; Domain=new.domain; Path=/; Expires=Wed, 30 Aug 2022 00:00:00 GMT",
        ]);
      });

      it("can remove cookie domain", async () => {
        t.app.all("/", (event) => {
          return proxyRequest(event, t.url + "/debug", {
            fetch,
            cookieDomainRewrite: {
              "somecompany.co.uk": "",
            },
          });
        });

        const result = await t.fetch(t.url + "/");

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
          return proxyRequest(event, t.url + "/debug", {
            fetch,
            cookiePathRewrite: "/api",
          });
        });

        const result = await t.fetch(t.url + "/");

        expect(result.headers.getSetCookie()[0]).toEqual(
          "foo=219ffwef9w0f; Domain=somecompany.co.uk; Path=/api; Expires=Wed, 30 Aug 2022 00:00:00 GMT",
        );
      });

      it("can rewrite cookie path by mapper object", async () => {
        t.app.all("/", (event) => {
          return proxyRequest(event, t.url + "/debug", {
            fetch,
            cookiePathRewrite: {
              "/": "/api",
            },
          });
        });

        const result = await t.fetch(t.url + "/");

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
          return proxyRequest(event, t.url + "/multiple/debug", {
            fetch,
            cookiePathRewrite: {
              "/": "/api",
            },
          });
        });

        const result = await t.fetch(t.url + "/");

        expect(result.headers.getSetCookie()).toEqual([
          "foo=219ffwef9w0f; Domain=somecompany.co.uk; Path=/api; Expires=Wed, 30 Aug 2022 00:00:00 GMT",
          "bar=38afes7a8; Domain=somecompany.co.uk; Path=/api; Expires=Wed, 30 Aug 2022 00:00:00 GMT",
        ]);
      });

      it("can remove cookie path", async () => {
        t.app.all("/", (event) => {
          return proxyRequest(event, t.url + "/debug", {
            fetch,
            cookiePathRewrite: {
              "/": "",
            },
          });
        });

        const result = await t.fetch(t.url + "/");

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
          return proxyRequest(event, t.url + "/debug", {
            fetch,
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
          return proxyRequest(event, t.url + "/debug", {
            fetch,
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
          return proxyRequest(event, t.url + "/debug", {
            fetch,
            onResponse(_event, response) {
              headers = Object.fromEntries(response.headers.entries());
            },
          });
        });

        await t.fetch("/");

        expect(headers?.["content-type"]).toEqual(
          "application/json;charset=UTF-8",
        );
      });
    });
  });
});
