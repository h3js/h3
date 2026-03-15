import { describe, it, expect } from "vitest";
import { H3, getPayload } from "../../src/index.ts";
import { describeMatrix } from "../_setup.ts";

describeMatrix("getPayload", (t, { it, expect }) => {
  it("returns query params for GET requests", async () => {
    t.app.get("/search", async (event) => {
      return getPayload(event);
    });
    const res = await t.fetch("/search?q=hello&page=1");
    expect(await res.json()).toMatchObject({ q: "hello", page: "1" });
  });

  it("returns body for POST requests", async () => {
    t.app.post("/users", async (event) => {
      return getPayload(event);
    });
    const res = await t.fetch("/users", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Alice" }),
    });
    expect(await res.json()).toMatchObject({ name: "Alice" });
  });

  it("merges route params with query for GET", async () => {
    t.app.get("/search/:category", async (event) => {
      return getPayload(event);
    });
    const res = await t.fetch("/search/books?q=h3");
    const data = await res.json();
    expect(data.category).toBe("books");
    expect(data.q).toBe("h3");
  });

  it("merges route params with body for POST", async () => {
    t.app.post("/users/:id", async (event) => {
      return getPayload(event);
    });
    const res = await t.fetch("/users/123", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Bob" }),
    });
    const data = await res.json();
    expect(data.id).toBe("123");
    expect(data.name).toBe("Bob");
  });

  it("body overrides route params on conflict", async () => {
    t.app.put("/items/:id", async (event) => {
      return getPayload(event);
    });
    const res = await t.fetch("/items/old", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "new" }),
    });
    expect((await res.json()).id).toBe("new");
  });
});
