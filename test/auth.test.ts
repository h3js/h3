import { basicAuth } from "../src/index.ts";
import { describeMatrix } from "./_setup.ts";

describeMatrix("auth", (t, { it, expect }) => {
  const auth = basicAuth({ username: "test", password: "123!" });

  it("responds 401 for a missing authorization header", async () => {
    t.app.get("/test", () => "Hello, world!", { middleware: [auth] });
    const result = await t.fetch("/test", {
      method: "GET",
    });
    expect(result.statusText).toBe("Authentication required");
    expect(result.status).toBe(401);
  });

  it("responds 401 for an incorrect authorization header", async () => {
    t.app.get("/test", () => "Hello, world!", { middleware: [auth] });
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
    t.app.get("/test", () => "Hello, world!", { middleware: [auth] });
    const result = await t.fetch("/test", {
      method: "GET",
      headers: {
        Authorization: `Basic ${Buffer.from("test:123!").toString("base64")}`,
      },
    });

    expect(await result.text()).toBe("Hello, world!");
    expect(result.status).toBe(200);
  });

  it("handles password containing colons", async () => {
    const authWithColon = basicAuth({
      username: "admin",
      password: "pass:word:with:colons",
    });
    t.app.get("/colon-test", () => "Success!", { middleware: [authWithColon] });

    const result = await t.fetch("/colon-test", {
      method: "GET",
      headers: {
        Authorization: `Basic ${Buffer.from("admin:pass:word:with:colons").toString("base64")}`,
      },
    });

    expect(await result.text()).toBe("Success!");
    expect(result.status).toBe(200);
  });

  it("rejects wrong password when password contains colons", async () => {
    const authWithColon = basicAuth({
      username: "admin",
      password: "pass:word:with:colons",
    });
    t.app.get("/colon-reject", () => "Success!", {
      middleware: [authWithColon],
    });

    const result = await t.fetch("/colon-reject", {
      method: "GET",
      headers: {
        Authorization: `Basic ${Buffer.from("admin:pass:word").toString("base64")}`,
      },
    });

    expect(result.status).toBe(401);
  });

  it("responds 401 for invalid base64", async () => {
    t.app.get("/invalid-base64", () => "Hello, world!", { middleware: [auth] });
    const result = await t.fetch("/invalid-base64", {
      method: "GET",
      headers: {
        Authorization: "Basic !!!invalid-base64!!!",
      },
    });

    expect(result.status).toBe(401);
  });

  it("responds 401 when base64 value has no colon separator", async () => {
    t.app.get("/no-colon", () => "Hello, world!", { middleware: [auth] });
    const result = await t.fetch("/no-colon", {
      method: "GET",
      headers: {
        Authorization: `Basic ${Buffer.from("usernameonly").toString("base64")}`,
      },
    });

    expect(result.status).toBe(401);
  });

  it("responds 401 when username is empty", async () => {
    t.app.get("/empty-username", () => "Hello, world!", { middleware: [auth] });
    const result = await t.fetch("/empty-username", {
      method: "GET",
      headers: {
        Authorization: `Basic ${Buffer.from(":password").toString("base64")}`,
      },
    });

    expect(result.status).toBe(401);
  });

  it("responds 401 when password is empty", async () => {
    t.app.get("/empty-password", () => "Hello, world!", { middleware: [auth] });
    const result = await t.fetch("/empty-password", {
      method: "GET",
      headers: {
        Authorization: `Basic ${Buffer.from("username:").toString("base64")}`,
      },
    });

    expect(result.status).toBe(401);
  });

  it("responds 401 when both username and password are empty", async () => {
    t.app.get("/empty-both", () => "Hello, world!", { middleware: [auth] });
    const result = await t.fetch("/empty-both", {
      method: "GET",
      headers: {
        Authorization: `Basic ${Buffer.from(":").toString("base64")}`,
      },
    });

    expect(result.status).toBe(401);
  });

  it("responds 401 when auth type is not Basic", async () => {
    t.app.get("/wrong-type", () => "Hello, world!", { middleware: [auth] });
    const result = await t.fetch("/wrong-type", {
      method: "GET",
      headers: {
        Authorization: "Bearer some-token",
      },
    });

    expect(result.status).toBe(401);
  });

  it("responds 401 when auth header has no credentials part", async () => {
    t.app.get("/no-credentials", () => "Hello, world!", {
      middleware: [auth],
    });
    const result = await t.fetch("/no-credentials", {
      method: "GET",
      headers: {
        Authorization: "Basic",
      },
    });

    expect(result.status).toBe(401);
  });

  it("responds 401 when auth header is empty", async () => {
    t.app.get("/empty-header", () => "Hello, world!", { middleware: [auth] });
    const result = await t.fetch("/empty-header", {
      method: "GET",
      headers: {
        Authorization: "",
      },
    });

    expect(result.status).toBe(401);
  });

  it("supports custom validate function", async () => {
    const customAuth = basicAuth({
      validate: (username, password) => {
        return username === "custom" && password === "secret";
      },
    });
    t.app.get("/custom-validate", () => "Custom validated!", {
      middleware: [customAuth],
    });

    const result = await t.fetch("/custom-validate", {
      method: "GET",
      headers: {
        Authorization: `Basic ${Buffer.from("custom:secret").toString("base64")}`,
      },
    });

    expect(await result.text()).toBe("Custom validated!");
    expect(result.status).toBe(200);
  });

  it("rejects invalid credentials with custom validate function", async () => {
    const customAuth = basicAuth({
      validate: (username, password) => {
        return username === "custom" && password === "secret";
      },
    });
    t.app.get("/custom-validate-reject", () => "Custom validated!", {
      middleware: [customAuth],
    });

    const result = await t.fetch("/custom-validate-reject", {
      method: "GET",
      headers: {
        Authorization: `Basic ${Buffer.from("custom:wrong").toString("base64")}`,
      },
    });

    expect(result.status).toBe(401);
  });

  it("supports async custom validate function", async () => {
    const asyncAuth = basicAuth({
      validate: async (username, password) => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return username === "async" && password === "pass";
      },
    });
    t.app.get("/async-validate", () => "Async validated!", {
      middleware: [asyncAuth],
    });

    const result = await t.fetch("/async-validate", {
      method: "GET",
      headers: {
        Authorization: `Basic ${Buffer.from("async:pass").toString("base64")}`,
      },
    });

    expect(await result.text()).toBe("Async validated!");
    expect(result.status).toBe(200);
  });

  it("throws error when neither password nor validate is provided", async () => {
    const invalidAuth = basicAuth({} as any);
    t.app.get("/no-auth-config", () => "Should not reach!", {
      middleware: [invalidAuth],
    });

    const result = await t.fetch("/no-auth-config", {
      method: "GET",
      headers: {
        Authorization: `Basic ${Buffer.from("user:pass").toString("base64")}`,
      },
    });

    expect(result.status).toBe(500);
  });
});
