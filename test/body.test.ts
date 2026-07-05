import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { readBody, readMultipartFormData } from "../src/index.ts";
import { describeMatrix } from "./_setup.ts";

describeMatrix("body", (t, { it, expect, describe }) => {
  it("can read simple string", async () => {
    t.app.all("/api/test", async (event) => {
      const body = await event.req.text();
      expect(body).toEqual('{"bool":true,"name":"string","number":1}');
      return "200";
    });
    const result = await t.fetch("/api/test", {
      method: "POST",
      body: JSON.stringify({
        bool: true,
        name: "string",
        number: 1,
      }),
    });

    expect(await result.text()).toBe("200");
  });

  it("can read chunked string", async () => {
    const requestJsonUrl = new URL("assets/sample.json", import.meta.url);
    t.app.all("/api/test", async (event) => {
      const body = await event.req.text();
      const json = (await readFile(requestJsonUrl)).toString("utf8");

      expect(body).toEqual(json);
      return "200";
    });

    const nodeStream = createReadStream(requestJsonUrl);
    const result = await t.fetch("/api/test", {
      method: "POST",
      // @ts-expect-error
      duplex: "half",
      body: new ReadableStream({
        start(controller) {
          nodeStream.on("data", (chunk) => {
            controller.enqueue(chunk);
          });
          nodeStream.on("end", () => {
            controller.close();
          });
        },
      }),
    });

    expect(await result.text()).toBe("200");
  });

  it("returns empty string if body is not present", async () => {
    let _body: string | undefined = "initial";
    t.app.all("/api/test", async (event) => {
      _body = await event.req.text();
      return "200";
    });
    const res = await t.fetch("/api/test", {
      method: "POST",
    });

    expect(_body).toBe("");
    expect(await res.text()).toBe("200");
  });

  it("returns an empty string if body is string", async () => {
    let _body: string | undefined = "initial";
    t.app.all("/api/test", async (event) => {
      _body = await readBody(event);
      return "200";
    });
    const result = await t.fetch("/api/test", {
      method: "POST",
      body: '""',
    });

    expect(_body).toBe("");
    expect(await result.text()).toBe("200");
  });

  it("returns an empty object string if body is empty object", async () => {
    let _body: string | undefined = "initial";
    t.app.all("/api/test", async (event) => {
      _body = await readBody(event);
      return "200";
    });
    const result = await t.fetch("/api/test", {
      method: "POST",
      body: "{}",
    });

    expect(_body).toMatchObject({});
    expect(Object.keys(_body).length).toBe(0);
    expect(await result.text()).toBe("200");
  });

  it("can parse json payload", async () => {
    t.app.all("/api/test", async (event) => {
      const body = await readBody(event);
      expect(body).toMatchObject({
        bool: true,
        name: "string",
        number: 1,
      });
      return "200";
    });
    const result = await t.fetch("/api/test", {
      method: "POST",
      body: JSON.stringify({
        bool: true,
        name: "string",
        number: 1,
      }),
    });

    expect(await result.text()).toBe("200");
  });

  it("handles non-present body", async () => {
    let _body: string | undefined;
    t.app.all("/api/test", async (event) => {
      _body = await readBody(event);
      return "200";
    });
    const result = await t.fetch("/api/test", {
      method: "POST",
    });
    expect(_body).toBeUndefined();
    expect(await result.text()).toBe("200");
  });

  it("handles empty string body", async () => {
    let _body: string | undefined = "initial";
    t.app.all("/api/test", async (event) => {
      _body = await readBody(event);
      return "200";
    });
    const result = await t.fetch("/api/test", {
      method: "POST",
      headers: {
        "Content-Type": "text/plain",
      },
      body: '""',
    });
    expect(_body).toStrictEqual("");
    expect(await result.text()).toBe("200");
  });

  it("handles empty object as body", async () => {
    let _body: string | undefined = "initial";
    t.app.all("/api/test", async (event) => {
      _body = await readBody(event);
      return "200";
    });
    const result = await t.fetch("/api/test", {
      method: "POST",
      body: "{}",
    });
    expect(_body).toMatchObject({});
    expect(Object.keys(_body).length).toBe(0);
    expect(await result.text()).toBe("200");
  });

  it("parse the form encoded into an object", async () => {
    t.app.all("/api/test", async (event) => {
      const body = await readBody(event);
      expect(body).toMatchObject({
        field: "value",
        another: "true",
        number: ["20", "30", "40"],
      });
      return "200";
    });
    const result = await t.fetch("/api/test", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      },
      body: "field=value&another=true&number=20&number=30&number=40",
    });

    expect(await result.text()).toBe("200");
  });

  it("parses multipart form data", async () => {
    t.app.all("/api/test", async (event) => {
      const formData = await event.req.formData();
      return [...formData.entries()].map(([name, value]) => ({
        name,
        data: value,
      }));
    });

    const formData = new FormData();
    formData.append("baz", "other");
    formData.append("号楼电表数据模版.xlsx", "something");

    const result = await t.fetch("/api/test", {
      method: "POST",
      headers: {
        "content-type":
          "multipart/form-data; boundary=---------------------------12537827810750053901680552518",
      },
      body: '-----------------------------12537827810750053901680552518\r\nContent-Disposition: form-data; name="baz"\r\n\r\nother\r\n-----------------------------12537827810750053901680552518\r\nContent-Disposition: form-data; name="号楼电表数据模版.xlsx"\r\n\r\nsomething\r\n-----------------------------12537827810750053901680552518--\r\n',
    });

    expect(await result.json()).toMatchObject([
      {
        data: "other",
        name: "baz",
      },
      {
        data: "something",
        name: "号楼电表数据模版.xlsx",
      },
    ]);
  });

  describe("readBody with multipart/form-data", () => {
    // Reusable multipart payload with a repeated `number` field.
    const multipart = {
      headers: {
        "content-type":
          "multipart/form-data; boundary=---------------------------12537827810750053901680552518",
      },
      body: '-----------------------------12537827810750053901680552518\r\nContent-Disposition: form-data; name="field"\r\n\r\nvalue\r\n-----------------------------12537827810750053901680552518\r\nContent-Disposition: form-data; name="number"\r\n\r\n20\r\n-----------------------------12537827810750053901680552518\r\nContent-Disposition: form-data; name="number"\r\n\r\n30\r\n-----------------------------12537827810750053901680552518--\r\n',
    };

    it("parses form data into an object when opted in via type: formData", async () => {
      let _body: any;
      t.app.all("/api/test", async (event) => {
        _body = await readBody(event, { type: "formData" });
        return "200";
      });
      const result = await t.fetch("/api/test", { method: "POST", ...multipart });
      // Repeated keys are preserved as an array, not collapsed to the last value.
      expect(_body).toMatchObject({ field: "value", number: ["20", "30"] });
      expect(await result.text()).toBe("200");
    });

    it("does NOT auto-parse multipart without an explicit opt-in", async () => {
      // Without `type: "formData"` a multipart body falls through to the JSON
      // parser and is rejected — parsing form data is never header-driven.
      t.app.all("/api/test", async (event) => {
        await readBody(event);
        return "200";
      });
      const result = await t.fetch("/api/test", { method: "POST", ...multipart });
      expect(result.status).toBe(400);
    });

    it("throws a 400 on a malformed multipart body", async () => {
      t.app.all("/api/test", async (event) => {
        await readBody(event, { type: "formData" });
        return "200";
      });
      const result = await t.fetch("/api/test", {
        method: "POST",
        headers: {
          "content-type": "multipart/form-data; boundary=----broken",
        },
        // Body does not match the declared boundary → formData() throws.
        body: "not a valid multipart body",
      });
      expect(result.status).toBe(400);
    });
  });

  describe("readBody with an explicit type", () => {
    it("type: text returns the raw string, ignoring the content-type", async () => {
      let _body: any;
      t.app.all("/api/test", async (event) => {
        _body = await readBody(event, { type: "text" });
        return "200";
      });
      // JSON content-type, but `type: text` forces the raw string.
      await t.fetch("/api/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: '{ "hello": true }',
      });
      expect(_body).toBe('{ "hello": true }');
    });

    it("type: text returns an empty string for an empty body", async () => {
      let _body: any = "unset";
      t.app.all("/api/test", async (event) => {
        _body = await readBody(event, { type: "text" });
        return "200";
      });
      await t.fetch("/api/test", { method: "POST" });
      expect(_body).toBe("");
    });

    it("type: urlencoded parses regardless of the content-type", async () => {
      let _body: any;
      t.app.all("/api/test", async (event) => {
        _body = await readBody(event, { type: "urlencoded" });
        return "200";
      });
      // No urlencoded content-type, but `type: urlencoded` forces the parser.
      await t.fetch("/api/test", {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body: "field=value&number=20&number=30",
      });
      expect(_body).toMatchObject({ field: "value", number: ["20", "30"] });
    });

    it("type: json parses even when the content-type is urlencoded", async () => {
      let _body: any;
      t.app.all("/api/test", async (event) => {
        _body = await readBody(event, { type: "json" });
        return "200";
      });
      // urlencoded content-type is ignored in favor of the forced JSON parser.
      await t.fetch("/api/test", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: '{ "hello": true }',
      });
      expect(_body).toMatchObject({ hello: true });
    });

    it("type: json throws a 400 on an invalid JSON body", async () => {
      t.app.all("/api/test", async (event) => {
        await readBody(event, { type: "json" });
        return "200";
      });
      const result = await t.fetch("/api/test", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "field=value",
      });
      expect(result.status).toBe(400);
    });
  });

  it("returns empty string if body is not present with text/plain", async () => {
    let _body: string | undefined;
    t.app.all("/api/test", async (event) => {
      _body = await event.req.text();
      return "200";
    });
    const result = await t.fetch("/api/test", {
      method: "POST",
      headers: {
        "Content-Type": "text/plain",
      },
    });

    expect(_body).toBe("");
    expect(await result.text()).toBe("200");
  });

  it("returns undefined if body is not present with json", async () => {
    let _body: string | undefined;
    t.app.all("/api/test", async (event) => {
      _body = await readBody(event);
      return "200";
    });
    const result = await t.fetch("/api/test", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
    });

    expect(_body).toBeUndefined();
    expect(await result.text()).toBe("200");
  });

  it("returns the string if content type is text/*", async () => {
    let _body: string | undefined;
    t.app.all("/api/test", async (event) => {
      _body = await event.req.text();
      return "200";
    });
    const result = await t.fetch("/api/test", {
      method: "POST",
      headers: {
        "Content-Type": "text/*",
      },
      body: '{ "hello": true }',
    });

    expect(_body).toBe('{ "hello": true }');
    expect(await result.text()).toBe("200");
  });

  it("returns string as is if cannot parse with unknown content type", async () => {
    t.app.all("/api/test", async (event) => {
      const _body = await event.req.text();
      return _body;
    });
    const result = await t.fetch("/api/test", {
      method: "POST",
      headers: {
        "Content-Type": "application/foobar",
      },
      body: "{ test: 123 }",
    });

    expect(result.status).toBe(200);
    expect(await result.text()).toBe("{ test: 123 }");
  });

  it("fails if json is invalid", async () => {
    t.app.all("/api/test", async (event) => {
      const _body = await readBody(event);
      return _body;
    });
    const result = await t.fetch("/api/test", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: '{ "hello": true',
    });
    const resultJson = (await result.json()) as any;

    expect(result.status).toBe(400);
    expect(resultJson.statusText).toBe("Bad Request");
    expect(resultJson.stack[0]).toBe("HTTPError: Invalid JSON body");
  });

  describe("readFormDataBody", () => {
    it("can handle form as FormData in event handler", async () => {
      t.app.all("/api/*", async (event) => {
        const formData = await event.req.formData();
        const user = formData!.get("user");
        expect(formData instanceof FormData).toBe(true);
        expect(user).toBe("john");
        return { user };
      });

      const result = await t.fetch("/api/test", {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded; charset=utf-8",
        },
        body: "user=john",
      });

      expect(result.status).toBe(200);
      expect(await result.json()).toMatchObject({ user: "john" });
    });

    it("parses multipart form data", async () => {
      t.app.all("/api/*", async (event) => {
        const multipartFormData = await readMultipartFormData(event);

        expect(multipartFormData[0].name).toBe("baz");
        expect(multipartFormData[0].data instanceof Uint8Array).toBe(true);
        expect(new TextDecoder().decode(multipartFormData[0].data)).toBe("other");

        expect(multipartFormData[1].name).toBe("号楼电表数据模版.xlsx");
        expect(multipartFormData[1].data instanceof Uint8Array).toBe(true);
        expect(new TextDecoder().decode(multipartFormData[1].data)).toBe("something");

        return multipartFormData.map((part) => ({
          ...part,
          data: new TextDecoder().decode(part.data),
        }));
      });

      const result = await t.fetch("/api/test", {
        method: "POST",
        headers: {
          "content-type":
            "multipart/form-data; boundary=---------------------------12537827810750053901680552518",
        },
        body: '-----------------------------12537827810750053901680552518\r\nContent-Disposition: form-data; name="baz"\r\n\r\nother\r\n-----------------------------12537827810750053901680552518\r\nContent-Disposition: form-data; name="号楼电表数据模版.xlsx"\r\n\r\nsomething\r\n-----------------------------12537827810750053901680552518--\r\n',
      });

      expect(result.status).toBe(200);
      expect(await result.json()).toMatchInlineSnapshot(`
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
  });
});
