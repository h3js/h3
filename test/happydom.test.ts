import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

describe("happydom", () => {
  // Lazy import after setting up globals to apply happydom polyfills
  let h3: typeof import("../src/index.ts");

  beforeAll(async () => {
    await GlobalRegistrator.register({
      url: "http://localhost:3000",
      width: 1920,
      height: 1080,
    });
  });

  afterAll(async () => {
    await GlobalRegistrator.unregister();
  });

  test("import h3", async () => {
    h3 = await import("../src/index.ts");
  });

  test("render works", async () => {
    const app = new h3.H3();
    app.post("/", async (event) => {
      return new Response(event.req.body, {
        headers: event.req.headers,
      });
    });

    const req = new Request("http://localhost:3000/", {
      method: "POST",
      body: JSON.stringify({ hello: "world" }),
      headers: {
        "Content-Type": "application/json",
      },
    });
    const res = await app.fetch(req);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/json");
    const json = await res.json();
    expect(json).toEqual({ hello: "world" });
  });
});
