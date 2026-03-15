import { describe, it, expect } from "vitest";
import { H3, HTTPError, createTestClient, readBody } from "../../src/index.ts";

describe("createTestClient", () => {
  it("makes GET requests and parses JSON", async () => {
    const app = new H3().get("/users", () => [{ id: 1, name: "Alice" }]);
    const client = createTestClient(app);

    const data = await client.get("/users");
    expect(data).toEqual([{ id: 1, name: "Alice" }]);
  });

  it("makes POST requests with JSON body", async () => {
    const app = new H3().post("/users", async (event) => {
      const body = await readBody<{ name: string }>(event);
      return { created: true, name: body?.name };
    });
    const client = createTestClient(app);

    const data = await client.post("/users", {
      body: { name: "Bob" },
    });
    expect(data).toEqual({ created: true, name: "Bob" });
  });

  it("supports PUT, PATCH, DELETE methods", async () => {
    const app = new H3()
      .put("/item", () => "put")
      .patch("/item", () => "patch")
      .delete("/item", () => "deleted");
    const client = createTestClient(app);

    expect(await client.put("/item")).toBe("put");
    expect(await client.patch("/item")).toBe("patch");
    expect(await client.delete("/item")).toBe("deleted");
  });

  it("passes query parameters", async () => {
    const app = new H3().get("/search", (event) => ({
      q: event.url.searchParams.get("q"),
    }));
    const client = createTestClient(app);

    const data = await client.get("/search", { query: { q: "hello" } });
    expect(data).toEqual({ q: "hello" });
  });

  it("passes custom headers", async () => {
    const app = new H3().get("/auth", (event) => ({
      token: event.req.headers.get("authorization"),
    }));
    const client = createTestClient(app);

    const data = await client.get("/auth", {
      headers: { authorization: "Bearer abc" },
    });
    expect(data).toEqual({ token: "Bearer abc" });
  });

  it("returns raw Response via request()", async () => {
    const app = new H3().get("/raw", () => "hello");
    const client = createTestClient(app);

    const res = await client.request("/raw");
    expect(res).toBeInstanceOf(Response);
    expect(await res.text()).toBe("hello");
  });

  it("throws on non-ok responses", async () => {
    const app = new H3({
      onError: () => {},
    }).get("/fail", () => {
      throw new HTTPError({ status: 400, statusText: "Bad Request" });
    });
    const client = createTestClient(app);

    await expect(client.get("/fail")).rejects.toThrow();
  });

  it("returns text for non-JSON responses", async () => {
    const app = new H3().get("/text", () => "plain text");
    const client = createTestClient(app);

    const data = await client.get("/text");
    expect(data).toBe("plain text");
  });

  it("handles FormData body without JSON serialization", async () => {
    const app = new H3().post("/upload", async (event) => {
      const form = await event.req.formData();
      return { field: form.get("name") };
    });
    const client = createTestClient(app);

    const form = new FormData();
    form.set("name", "test");
    const data = await client.post("/upload", { body: form });
    expect(data).toEqual({ field: "test" });
  });

  it("$fetch with custom method", async () => {
    const app = new H3().on("OPTIONS", "/cors", () => "ok");
    const client = createTestClient(app);

    const data = await client.$fetch("/cors", { method: "OPTIONS" });
    expect(data).toBe("ok");
  });
});
