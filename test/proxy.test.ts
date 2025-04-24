import { Server } from "node:http";
import { readFile } from "node:fs/promises";
import supertest, { SuperTest, Test } from "supertest";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { fetch } from "node-fetch-native";
import {
  createApp,
  toNodeListener,
  App,
  eventHandler,
  getHeaders,
  setHeader,
  readRawBody,
  setCookie,
  setResponseHeader,
} from "../src";
import { sendProxy, proxyRequest } from "../src/utils/proxy";

const spy = vi.spyOn(console, "error");

describe("proxy", () => {
  let app: App;
  let request: SuperTest<Test>;

  let server: Server;
  let url: string;

  beforeEach(async () => {
    app = createApp({ debug: false });
    request = supertest(toNodeListener(app));
    server = new Server(
      {
        keepAlive: false,
        keepAliveTimeout: 1,
      },
      toNodeListener(app),
    );
    server.on("error", (error) => {
      console.log("[server error]", error);
    });
    await new Promise((resolve) => {
      server.listen(0, () => resolve(undefined));
    });
    url = "http://localhost:" + (server.address() as any).port;
  });

  afterEach(async () => {
    await new Promise((resolve) => {
      server.close(() => resolve(undefined));
    });
  });

  describe("sendProxy", () => {
    it("works", async () => {
      app.use(
        "/hello",
        eventHandler(() => "hello"),
      );
      app.use(
        "/",
        eventHandler((event) => {
          return sendProxy(event, url + "/hello", { fetch });
        }),
      );

      const result = await request.get("/");

      expect(result.text).toBe("hello");
    });
  });

  describe("proxyRequest", () => {
    it("can proxy request", async () => {
      app.use(
        "/debug",
        eventHandler(async (event) => {
          const headers = getHeaders(event);
          delete headers.host;
          let body;
          try {
            body = await readRawBody(event);
          } catch {
            // Ignore
          }
          return {
            method: event.method,
            headers,
            body,
          };
        }),
      );

      app.use(
        "/",
        eventHandler((event) => {
          return proxyRequest(event, url + "/debug", {
            fetch,
            headers: [["x-custom1", "overridden"]],
            fetchOptions: {
              headers: new Headers({ "x-custom2": "overridden" }),
            },
          });
        }),
      );

      const result = await fetch(url + "/", {
        method: "POST",
        body: "hello",
        headers: {
          "content-type": "text/custom",
          "X-Custom1": "user",
          "X-Custom2": "user",
          "X-Custom3": "user",
        },
      }).then((r) => r.json());

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
      app.use(
        "/debug",
        eventHandler(async (event) => {
          const body = await readRawBody(event, false);
          return {
            headers: getHeaders(event),
            bytes: body!.length,
          };
        }),
      );

      app.use(
        "/",
        eventHandler((event) => {
          setResponseHeader(event, "x-res-header", "works");
          return proxyRequest(event, url + "/debug", { fetch });
        }),
      );

      const dummyFile = await readFile(
        new URL("assets/dummy.pdf", import.meta.url),
      );

      const res = await fetch(url + "/", {
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
      app.use(
        "/debug",
        eventHandler(async (event) => {
          return {
            body: await readRawBody(event),
            headers: getHeaders(event),
          };
        }),
      );

      app.use(
        "/",
        eventHandler((event) => {
          return proxyRequest(event, url + "/debug", { fetch });
        }),
      );

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

      const res = await fetch(url + "/", {
        method: "POST",
        // @ts-ignore
        duplex: "half",
        body,
        headers: {
          "content-type": "application/octet-stream",
          "x-custom": "hello",
          "content-length": "27",
        },
      });
      const resBody = await res.json();

      expect(resBody.headers["content-type"]).toEqual(
        "application/octet-stream",
      );
      expect(resBody.headers["x-custom"]).toEqual("hello");
      expect(resBody.body).toMatchInlineSnapshot(
        '"This is a streamed request."',
      );
    });

    it("can proxy json transparently", async () => {
      const message = '{"hello":"world"}';

      app.use(
        "/debug",
        eventHandler((event) => {
          setHeader(event, "content-type", "application/json");
          return message;
        }),
      );

      app.use(
        "/",
        eventHandler((event) => {
          return proxyRequest(event, url + "/debug", { fetch });
        }),
      );

      const res = await fetch(url + "/", {
        method: "GET",
      });

      const resText = await res.text();

      expect(resText).toEqual(message);
    });

    it(
      "can handle failed proxy requests gracefully",
      async () => {
        spy.mockReset();
        app.use(
          "/",
          eventHandler((event) => {
            return proxyRequest(
              event,
              "https://this-url-does-not-exist.absudiasdjadioasjdoiasd.test",
            );
          }),
        );

        await fetch(`${url}/`, {
          method: "GET",
        });

        expect(spy).not.toHaveBeenCalled();
      },
      60 * 1000,
    );
  });

  describe("multipleCookies", () => {
    it("can split multiple cookies", async () => {
      app.use(
        "/setcookies",
        eventHandler((event) => {
          setCookie(event, "user", "alice", {
            expires: new Date("Thu, 01 Jun 2023 10:00:00 GMT"),
            httpOnly: true,
          });
          setCookie(event, "role", "guest");
          return {};
        }),
      );

      app.use(
        "/",
        eventHandler((event) => {
          return sendProxy(event, url + "/setcookies", { fetch });
        }),
      );

      const result = await request.get("/");
      const cookies = result.header["set-cookie"];
      expect(cookies).toEqual([
        "user=alice; Path=/; Expires=Thu, 01 Jun 2023 10:00:00 GMT; HttpOnly",
        "role=guest; Path=/",
      ]);
    });
  });

  describe("cookieDomainRewrite", () => {
    beforeEach(() => {
      app.use(
        "/debug",
        eventHandler((event) => {
          setHeader(
            event,
            "set-cookie",
            "foo=219ffwef9w0f; Domain=somecompany.co.uk; Path=/; Expires=Wed, 30 Aug 2022 00:00:00 GMT",
          );
          return {};
        }),
      );
    });

    it("can rewrite cookie domain by string", async () => {
      app.use(
        "/",
        eventHandler((event) => {
          return proxyRequest(event, url + "/debug", {
            fetch,
            cookieDomainRewrite: "new.domain",
          });
        }),
      );

      const result = await fetch(url + "/");

      expect(result.headers.get("set-cookie")).toEqual(
        "foo=219ffwef9w0f; Domain=new.domain; Path=/; Expires=Wed, 30 Aug 2022 00:00:00 GMT",
      );
    });

    it("can rewrite cookie domain by mapper object", async () => {
      app.use(
        "/",
        eventHandler((event) => {
          return proxyRequest(event, url + "/debug", {
            fetch,
            cookieDomainRewrite: {
              "somecompany.co.uk": "new.domain",
            },
          });
        }),
      );

      const result = await fetch(url + "/");

      expect(result.headers.get("set-cookie")).toEqual(
        "foo=219ffwef9w0f; Domain=new.domain; Path=/; Expires=Wed, 30 Aug 2022 00:00:00 GMT",
      );
    });

    it("can rewrite domains of multiple cookies", async () => {
      app.use(
        "/multiple/debug",
        eventHandler((event) => {
          setHeader(event, "set-cookie", [
            "foo=219ffwef9w0f; Domain=somecompany.co.uk; Path=/; Expires=Wed, 30 Aug 2022 00:00:00 GMT",
            "bar=38afes7a8; Domain=somecompany.co.uk; Path=/; Expires=Wed, 30 Aug 2022 00:00:00 GMT",
          ]);
          return {};
        }),
      );

      app.use(
        "/",
        eventHandler((event) => {
          return proxyRequest(event, url + "/multiple/debug", {
            fetch,
            cookieDomainRewrite: {
              "somecompany.co.uk": "new.domain",
            },
          });
        }),
      );

      const result = await fetch(url + "/");

      expect(result.headers.get("set-cookie")).toEqual(
        "foo=219ffwef9w0f; Domain=new.domain; Path=/; Expires=Wed, 30 Aug 2022 00:00:00 GMT, bar=38afes7a8; Domain=new.domain; Path=/; Expires=Wed, 30 Aug 2022 00:00:00 GMT",
      );
    });

    it("can remove cookie domain", async () => {
      app.use(
        "/",
        eventHandler((event) => {
          return proxyRequest(event, url + "/debug", {
            fetch,
            cookieDomainRewrite: {
              "somecompany.co.uk": "",
            },
          });
        }),
      );

      const result = await fetch(url + "/");

      expect(result.headers.get("set-cookie")).toEqual(
        "foo=219ffwef9w0f; Path=/; Expires=Wed, 30 Aug 2022 00:00:00 GMT",
      );
    });
  });

  describe("cookiePathRewrite", () => {
    beforeEach(() => {
      app.use(
        "/debug",
        eventHandler((event) => {
          setHeader(
            event,
            "set-cookie",
            "foo=219ffwef9w0f; Domain=somecompany.co.uk; Path=/; Expires=Wed, 30 Aug 2022 00:00:00 GMT",
          );
          return {};
        }),
      );
    });

    it("can rewrite cookie path by string", async () => {
      app.use(
        "/",
        eventHandler((event) => {
          return proxyRequest(event, url + "/debug", {
            fetch,
            cookiePathRewrite: "/api",
          });
        }),
      );

      const result = await fetch(url + "/");

      expect(result.headers.get("set-cookie")).toEqual(
        "foo=219ffwef9w0f; Domain=somecompany.co.uk; Path=/api; Expires=Wed, 30 Aug 2022 00:00:00 GMT",
      );
    });

    it("can rewrite cookie path by mapper object", async () => {
      app.use(
        "/",
        eventHandler((event) => {
          return proxyRequest(event, url + "/debug", {
            fetch,
            cookiePathRewrite: {
              "/": "/api",
            },
          });
        }),
      );

      const result = await fetch(url + "/");

      expect(result.headers.get("set-cookie")).toEqual(
        "foo=219ffwef9w0f; Domain=somecompany.co.uk; Path=/api; Expires=Wed, 30 Aug 2022 00:00:00 GMT",
      );
    });

    it("can rewrite paths of multiple cookies", async () => {
      app.use(
        "/multiple/debug",
        eventHandler((event) => {
          setHeader(event, "set-cookie", [
            "foo=219ffwef9w0f; Domain=somecompany.co.uk; Path=/; Expires=Wed, 30 Aug 2022 00:00:00 GMT",
            "bar=38afes7a8; Domain=somecompany.co.uk; Path=/; Expires=Wed, 30 Aug 2022 00:00:00 GMT",
          ]);
          return {};
        }),
      );

      app.use(
        "/",
        eventHandler((event) => {
          return proxyRequest(event, url + "/multiple/debug", {
            fetch,
            cookiePathRewrite: {
              "/": "/api",
            },
          });
        }),
      );

      const result = await fetch(url + "/");

      expect(result.headers.get("set-cookie")).toEqual(
        "foo=219ffwef9w0f; Domain=somecompany.co.uk; Path=/api; Expires=Wed, 30 Aug 2022 00:00:00 GMT, bar=38afes7a8; Domain=somecompany.co.uk; Path=/api; Expires=Wed, 30 Aug 2022 00:00:00 GMT",
      );
    });

    it("can remove cookie path", async () => {
      app.use(
        "/",
        eventHandler((event) => {
          return proxyRequest(event, url + "/debug", {
            fetch,
            cookiePathRewrite: {
              "/": "",
            },
          });
        }),
      );

      const result = await fetch(url + "/");

      expect(result.headers.get("set-cookie")).toEqual(
        "foo=219ffwef9w0f; Domain=somecompany.co.uk; Expires=Wed, 30 Aug 2022 00:00:00 GMT",
      );
    });
  });

  describe("onResponse", () => {
    beforeEach(() => {
      app.use(
        "/debug",
        eventHandler(() => {
          return {
            foo: "bar",
          };
        }),
      );
    });

    it("allows modifying response event", async () => {
      app.use(
        "/",
        eventHandler((event) => {
          return proxyRequest(event, url + "/debug", {
            fetch,
            onResponse(_event) {
              setHeader(_event, "x-custom", "hello");
            },
          });
        }),
      );

      const result = await request.get("/");

      expect(result.header["x-custom"]).toEqual("hello");
    });

    it("allows modifying response event async", async () => {
      app.use(
        "/",
        eventHandler((event) => {
          return proxyRequest(event, url + "/debug", {
            fetch,
            onResponse(_event) {
              return new Promise((resolve) => {
                resolve(setHeader(_event, "x-custom", "hello"));
              });
            },
          });
        }),
      );

      const result = await request.get("/");

      expect(result.header["x-custom"]).toEqual("hello");
    });

    it("allows to get the actual response", async () => {
      let headers;

      app.use(
        "/",
        eventHandler((event) => {
          return proxyRequest(event, url + "/debug", {
            fetch,
            onResponse(_event, response) {
              headers = Object.fromEntries(response.headers.entries());
            },
          });
        }),
      );

      await request.get("/");

      expect(headers["content-type"]).toEqual("application/json");
    });
  });
});
