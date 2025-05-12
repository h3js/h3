import { defineEventHandler, withBasicAuth } from "../src";
import { describeMatrix } from "./_setup";

describeMatrix("auth", (t, { it, expect }) => {
  it("responds 401 for a missing authorization header", async () => {
    t.app.use(
      "/test",
      withBasicAuth(
        { username: "test", password: "123!" },
        defineEventHandler(async () => {
          return "Hello, world!";
        }),
      ),
    );
    const result = await t.fetch("/test", {
      method: "GET",
    });

    expect(await result.text()).toBe("Authentication required");
    expect(result.status).toBe(401);
  });

  it("responds 401 for an incorrect authorization header", async () => {
    t.app.use(
      "/test",
      withBasicAuth(
        { username: "test", password: "123!" },
        defineEventHandler(async () => {
          return "Hello, world!";
        }),
      ),
    );
    const result = await t.fetch("/test", {
      method: "GET",
      headers: {
        Authorization: `Basic ${Buffer.from("test:wrongpass").toString("base64")}`,
      },
    });

    expect(await result.text()).toBe("Authentication required");
    expect(result.status).toBe(401);
  });

  it("responds 200 for a correct authorization header", async () => {
    t.app.use(
      "/test",
      withBasicAuth(
        "test:123!",
        defineEventHandler(async () => {
          return "Hello, world!";
        }),
      ),
    );
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
