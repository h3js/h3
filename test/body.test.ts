import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { readBody } from "../src/index.ts";
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
    expect(resultJson.stack[0]).toBe("Error: Invalid JSON body");
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
  });
});
