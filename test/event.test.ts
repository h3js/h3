import { vi } from "vitest";
import { mockEvent, readBody } from "../src/index.ts";
import { describeMatrix } from "./_setup.ts";

describeMatrix("event", (t, { it, expect }) => {
  it("can read the method", async () => {
    t.app.all("/*", (event) => {
      expect(event.req.method).toBe(event.req.method);
      expect(event.req.method).toBe("POST");
      return "200";
    });
    const result = await t.fetch("/hello", { method: "POST" });
    expect(await result.text()).toBe("200");
  });

  it("can read the headers", async () => {
    t.app.all("/*", (event) => {
      return {
        headers: [...event.req.headers.entries()],
      };
    });
    const result = await t.fetch("/hello", {
      method: "POST",
      headers: {
        "X-Test": "works",
        Cookie: "a; b",
      },
    });
    const { headers } = JSON.parse(await result.text()) as {
      headers: [string, string][];
    };
    expect(headers.find(([key]) => key === "x-test")?.[1]).toBe("works");
    expect(headers.find(([key]) => key === "cookie")?.[1]).toBe("a; b");
  });

  it("can get request url", async () => {
    t.app.all("/*", (event) => event.url.toString());
    const result = await t.fetch("http://test.com/hello");
    expect(await result.text()).toMatch(
      t.target === "node"
        ? /^http:\/\/localhost:\d+\/hello$/ // undici limitation for forwarded host
        : "http://test.com/hello",
    );
  });

  it("can read request body", async () => {
    t.app.all("/*", async (event) => {
      let bytes = 0;
      // @ts-expect-error iterator
      for await (const chunk of event.req.body!) {
        bytes += chunk.length;
      }
      return {
        bytes,
      };
    });

    const result = await t.fetch("/hello", {
      method: "POST",
      body: new Uint8Array([1, 2, 3]),
    });

    expect(await result.json()).toMatchObject({ bytes: 3 });
  });

  it("can convert to a web request", async () => {
    t.app.all("/", async (event) => {
      expect(event.req.method).toBe("POST");
      expect(event.req.headers.get("x-test")).toBe("123");
      expect(await readBody(event)).toMatchObject({ hello: "world" });
      return "200";
    });
    const result = await t.fetch("/", {
      method: "POST",
      headers: {
        "x-test": "123",
        "content-type": "application/json",
      },
      body: JSON.stringify({ hello: "world" }),
    });

    expect(await result.text()).toBe("200");
  });

  it("can read path with URL", async () => {
    t.app.all("/", (event) => {
      expect(event.path).toBe("/?url=https://example.com");
      return "200";
    });

    const result = await t.fetch("/?url=https://example.com");

    expect(await result.text()).toBe("200");
  });

  it("event.waitUntil", () => {
    const event = mockEvent("/");
    event.req.waitUntil = vi.fn();
    event.waitUntil(Promise.resolve("done"));
    expect(event.req.waitUntil).toHaveBeenCalledWith(Promise.resolve("done"));
  });
});
