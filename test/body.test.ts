import { Server } from "node:http";
import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import getPort from "get-port";
import { Client } from "undici";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  createApp,
  toNodeListener,
  App,
  readRawBody,
  readBody,
  eventHandler,
  readMultipartFormData,
} from "../src";

describe("body", () => {
  let app: App;
  let server: Server;
  let client: Client;

  beforeEach(async () => {
    app = createApp({ debug: true });
    server = new Server(toNodeListener(app));
    const port = await getPort();
    server.listen(port);
    client = new Client(`http://localhost:${port}`);
  });

  afterEach(() => {
    client.close();
    server.close();
  });

  describe("readRawBody", () => {
    it("can handle raw string", async () => {
      app.use(
        "/",
        eventHandler(async (request) => {
          const body = await readRawBody(request);
          expect(body).toEqual('{"bool":true,"name":"string","number":1}');
          return "200";
        }),
      );
      const result = await client.request({
        path: "/api/test",
        method: "POST",
        body: JSON.stringify({
          bool: true,
          name: "string",
          number: 1,
        }),
      });

      expect(await result.body.text()).toBe("200");
    });

    it("can handle chunked string", async () => {
      const requestJsonUrl = new URL("assets/sample.json", import.meta.url);
      app.use(
        "/",
        eventHandler(async (request) => {
          const body = await readRawBody(request);
          const json = (await readFile(requestJsonUrl)).toString("utf8");

          expect(body).toEqual(json);
          return "200";
        }),
      );
      const result = await client.request({
        path: "/api/test",
        method: "POST",
        body: createReadStream(requestJsonUrl),
      });

      expect(await result.body.text()).toBe("200");
    });

    it("returns undefined if body is not present", async () => {
      let _body: string | undefined = "initial";
      app.use(
        "/",
        eventHandler(async (request) => {
          _body = await readRawBody(request);
          return "200";
        }),
      );
      const result = await client.request({
        path: "/api/test",
        method: "POST",
      });

      expect(_body).toBeUndefined();
      expect(await result.body.text()).toBe("200");
    });

    it("handles case-insensitive Transfer-Encoding: chunked header (CVE)", async () => {
      // Test that Transfer-Encoding header check is case-insensitive per RFC 7230
      // This prevents HTTP Request Smuggling via TE.TE desynchronization attacks

      const testCases = [
        { encoding: "ChunKed", expected: '{"test":"data"}' },
        { encoding: "CHUNKED", expected: '{"test":"data"}' },
        { encoding: "Chunked", expected: '{"test":"data"}' },
      ];

      for (const testCase of testCases) {
        // Simulate a raw HTTP request with mixed-case Transfer-Encoding
        const mockReq = {
          method: "POST",
          headers: { "transfer-encoding": testCase.encoding },
          on(event: string, handler: (chunk?: Buffer) => void) {
            if (event === "data") {
              // Simulate chunked data arrival
              handler(Buffer.from(testCase.expected));
            } else if (event === "end") {
              handler();
            }
            return this;
          },
        };

        const mockEvent = { method: "POST", node: { req: mockReq } };

        const result = await readRawBody(mockEvent as any);

        // Should properly read the body regardless of Transfer-Encoding case
        // If the check is case-sensitive, this will fail and return undefined
        expect(result).toEqual(testCase.expected);
      }
    });

    it("returns an empty string if body is empty", async () => {
      let _body: string | undefined = "initial";
      app.use(
        "/",
        eventHandler(async (request) => {
          _body = await readRawBody(request);
          return "200";
        }),
      );
      const result = await client.request({
        path: "/api/test",
        method: "POST",
        body: '""',
      });

      expect(_body).toBe('""');
      expect(await result.body.text()).toBe("200");
    });

    it("returns an empty object string if body is empty object", async () => {
      let _body: string | undefined = "initial";
      app.use(
        "/",
        eventHandler(async (request) => {
          _body = await readRawBody(request);
          return "200";
        }),
      );
      const result = await client.request({
        path: "/api/test",
        method: "POST",
        body: "{}",
      });

      expect(_body).toBe("{}");
      expect(await result.body.text()).toBe("200");
    });
  });

  describe("readBody", () => {
    it("can parse json payload", async () => {
      app.use(
        "/",
        eventHandler(async (request) => {
          const body = await readBody(request);
          expect(body).toMatchObject({
            bool: true,
            name: "string",
            number: 1,
          });
          return "200";
        }),
      );
      const result = await client.request({
        path: "/api/test",
        method: "POST",
        body: JSON.stringify({
          bool: true,
          name: "string",
          number: 1,
        }),
      });

      expect(await result.body.text()).toBe("200");
    });

    it("handles non-present body", async () => {
      let _body: string | undefined;
      app.use(
        "/",
        eventHandler(async (request) => {
          _body = await readBody(request);
          return "200";
        }),
      );
      const result = await client.request({
        path: "/api/test",
        method: "POST",
      });
      expect(_body).toBeUndefined();
      expect(await result.body.text()).toBe("200");
    });

    it("handles empty body", async () => {
      let _body: string | undefined = "initial";
      app.use(
        "/",
        eventHandler(async (request) => {
          _body = await readBody(request);
          return "200";
        }),
      );
      const result = await client.request({
        path: "/api/test",
        method: "POST",
        headers: {
          "Content-Type": "text/plain",
        },
        body: '""',
      });
      expect(_body).toStrictEqual('""');
      expect(await result.body.text()).toBe("200");
    });

    it("handles empty object as body", async () => {
      let _body: string | undefined = "initial";
      app.use(
        "/",
        eventHandler(async (request) => {
          _body = await readBody(request);
          return "200";
        }),
      );
      const result = await client.request({
        path: "/api/test",
        method: "POST",
        body: "{}",
      });
      expect(_body).toStrictEqual({});
      expect(await result.body.text()).toBe("200");
    });

    it("parse the form encoded into an object", async () => {
      app.use(
        "/",
        eventHandler(async (request) => {
          const body = await readBody(request);
          expect(body).toMatchObject({
            field: "value",
            another: "true",
            number: ["20", "30", "40"],
          });
          return "200";
        }),
      );
      const result = await client.request({
        path: "/api/test",
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        },
        body: "field=value&another=true&number=20&number=30&number=40",
      });

      expect(await result.body.text()).toBe("200");
    });

    it("handle readBody with buffer type (unenv)", async () => {
      app.use(
        "/",
        eventHandler(async (event) => {
          // Emulate unenv
          // @ts-ignore
          event.node.req.body = Buffer.from("test");

          const body = await readBody(event);
          expect(body).toMatchObject("test");

          return "200";
        }),
      );
      const result = await client.request({
        path: "/api/test",
        method: "POST",
      });

      expect(await result.body.text()).toBe("200");
    });

    it("handle readBody with Object type (unenv)", async () => {
      app.use(
        "/",
        eventHandler(async (event) => {
          // Emulate unenv
          // @ts-ignore
          event.node.req.body = { test: 1 };

          const body = await readBody(event);
          expect(body).toMatchObject({ test: 1 });

          return "200";
        }),
      );
      const result = await client.request({
        path: "/api/test",
        method: "POST",
      });

      expect(await result.body.text()).toBe("200");
    });

    it("handle readRawBody with array buffer type (unenv)", async () => {
      app.use(
        "/",
        eventHandler(async (event) => {
          // Emulate unenv
          // @ts-ignore
          event.node.req.body = new Uint8Array([1, 2, 3]);
          const body = await readRawBody(event, false);
          expect(body).toBeInstanceOf(Buffer);
          expect(body).toMatchObject(Buffer.from([1, 2, 3]));
          return "200";
        }),
      );
      const result = await client.request({
        path: "/api/test",
        method: "POST",
      });
      expect(await result.body.text()).toBe("200");
    });

    it("parses multipart form data", async () => {
      app.use(
        "/",
        eventHandler(async (request) => {
          const parts = (await readMultipartFormData(request)) || [];
          return parts.map((part) => ({
            ...part,
            data: part.data.toString("utf8"),
          }));
        }),
      );
      const result = await client.request({
        path: "/api/test",
        method: "POST",
        headers: {
          "content-type":
            "multipart/form-data; boundary=---------------------------12537827810750053901680552518",
        },
        body: '-----------------------------12537827810750053901680552518\r\nContent-Disposition: form-data; name="baz"\r\n\r\nother\r\n-----------------------------12537827810750053901680552518\r\nContent-Disposition: form-data; name="号楼电表数据模版.xlsx"\r\n\r\nsomething\r\n-----------------------------12537827810750053901680552518--\r\n',
      });

      expect(await result.body.json()).toMatchInlineSnapshot(`
        [
          {
            "data": "other",
            "name": "baz",
          },
          {
            "data": "something",
            "name": "号楼电表数据模版.xlsx",
          },
        ]
      `);
    });

    it("returns undefined if body is not present with text/plain", async () => {
      let _body: string | undefined;
      app.use(
        "/",
        eventHandler(async (request) => {
          _body = await readBody(request);
          return "200";
        }),
      );
      const result = await client.request({
        path: "/api/test",
        method: "POST",
        headers: {
          "Content-Type": "text/plain",
        },
      });

      expect(_body).toBeUndefined();
      expect(await result.body.text()).toBe("200");
    });

    it("returns undefined if body is not present with json", async () => {
      let _body: string | undefined;
      app.use(
        "/",
        eventHandler(async (request) => {
          _body = await readBody(request);
          return "200";
        }),
      );
      const result = await client.request({
        path: "/api/test",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      });

      expect(_body).toBeUndefined();
      expect(await result.body.text()).toBe("200");
    });

    it("returns the string if content type is text/*", async () => {
      let _body: string | undefined;
      app.use(
        "/",
        eventHandler(async (request) => {
          _body = await readBody(request);
          return "200";
        }),
      );
      const result = await client.request({
        path: "/api/test",
        method: "POST",
        headers: {
          "Content-Type": "text/*",
        },
        body: '{ "hello": true }',
      });

      expect(_body).toBe('{ "hello": true }');
      expect(await result.body.text()).toBe("200");
    });

    it("returns string as is if cannot parse with unknown content type", async () => {
      app.use(
        "/",
        eventHandler(async (request) => {
          const _body = await readBody(request);
          return _body;
        }),
      );
      const result = await client.request({
        path: "/api/test",
        method: "POST",
        headers: {
          "Content-Type": "application/foobar",
        },
        body: "{ test: 123 }",
      });

      expect(result.statusCode).toBe(200);
      expect(await result.body.text()).toBe("{ test: 123 }");
    });

    it("fails if json is invalid", async () => {
      app.use(
        "/",
        eventHandler(async (request) => {
          const _body = await readBody(request);
          return _body;
        }),
      );
      const result = await client.request({
        path: "/api/test",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: '{ "hello": true',
      });
      const resultJson = (await result.body.json()) as any;

      expect(result.statusCode).toBe(400);
      expect(resultJson.statusMessage).toBe("Bad Request");
      expect(resultJson.stack[0]).toBe("Error: Invalid JSON body");
    });
  });
});
