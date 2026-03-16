import { describe, expect, it } from "vitest";
import { requestWithURL, requestWithBaseURL } from "../../src/utils/request.ts";

describe("requestWithURL", () => {
  const original = new Request("http://example.com/base/path", {
    method: "POST",
    headers: { "x-test": "value" },
    body: "hello",
  });

  it("overrides url", () => {
    const proxied = requestWithURL(original, "http://example.com/path");
    expect(proxied.url).toBe("http://example.com/path");
  });

  it("preserves original url on source request", () => {
    requestWithURL(original, "http://example.com/path");
    expect(original.url).toBe("http://example.com/base/path");
  });

  it("preserves method", () => {
    const proxied = requestWithURL(original, "http://example.com/path");
    expect(proxied.method).toBe("POST");
  });

  it("preserves headers", () => {
    const proxied = requestWithURL(original, "http://example.com/path");
    expect(proxied.headers.get("x-test")).toBe("value");
  });

  it("is instanceof Request", () => {
    const proxied = requestWithURL(original, "http://example.com/path");
    expect(proxied instanceof Request).toBe(true);
  });

  it("clone() works and keeps overridden url", () => {
    const proxied = requestWithURL(original, "http://example.com/path");
    const cloned = proxied.clone();
    expect(cloned.url).toBe("http://example.com/base/path");
    expect(cloned.method).toBe("POST");
  });
});

describe("requestWithBaseURL", () => {
  const original = new Request("http://example.com/base/path?q=1", {
    method: "POST",
    headers: { "x-test": "value" },
    body: "hello",
  });

  it("strips base from pathname", () => {
    const proxied = requestWithBaseURL(original, "/base");
    expect(proxied.url).toBe("http://example.com/path?q=1");
  });

  it("returns / when pathname equals base", () => {
    const req = new Request("http://example.com/base");
    const proxied = requestWithBaseURL(req, "/base");
    expect(new URL(proxied.url).pathname).toBe("/");
  });

  it("preserves query string", () => {
    const proxied = requestWithBaseURL(original, "/base");
    expect(new URL(proxied.url).search).toBe("?q=1");
  });

  it("preserves method and headers", () => {
    const proxied = requestWithBaseURL(original, "/base");
    expect(proxied.method).toBe("POST");
    expect(proxied.headers.get("x-test")).toBe("value");
  });

  it("is instanceof Request", () => {
    const proxied = requestWithBaseURL(original, "/base");
    expect(proxied instanceof Request).toBe(true);
  });
});
