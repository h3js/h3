import { basicAuth } from "../src/index.ts";
import { describeMatrix } from "./_setup.ts";

describeMatrix("auth", (t, { it, expect }) => {
  const auth = basicAuth({ username: "test", password: "123!" });

  it("responds 401 for a missing authorization header", async () => {
    t.app.get("/test", () => "Hello, world!", [auth]);
    const result = await t.fetch("/test", {
      method: "GET",
    });
    expect(result.statusText).toBe("Authentication required");
    expect(result.status).toBe(401);
  });

  it("responds 401 for an incorrect authorization header", async () => {
    t.app.get("/test", () => "Hello, world!", [auth]);
    const result = await t.fetch("/test", {
      method: "GET",
      headers: {
        Authorization: `Basic ${Buffer.from("test:wrongpass").toString("base64")}`,
      },
    });

    expect(result.statusText).toBe("Authentication required");
    expect(result.status).toBe(401);
  });

  it("responds 200 for a correct authorization header", async () => {
    t.app.get("/test", () => "Hello, world!", [auth]);
    const result = await t.fetch("/test", {
      method: "GET",
      headers: {
        Authorization: `Basic ${Buffer.from("test:123!").toString("base64")}`,
      },
    });

    expect(await result.text()).toBe("Hello, world!");
    expect(result.status).toBe(200);
  });
});
