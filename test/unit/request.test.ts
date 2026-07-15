import { describe, expect, it } from "vitest";
import { requestWithURL, requestWithBaseURL } from "../../src/utils/request.ts";
import { getRequestProtocol } from "../../src/index.ts";

// Minimal fake HTTPEvent for unit-testing getRequestProtocol without a live server
function makeEvent(headers: Record<string, string>, url = "http://localhost/test") {
  const req = new Request(url, { headers });
  return { req } as any;
}

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

  it("shadows the runtime-parsed _url of the source request", () => {
    const target = new Request("http://example.com/base/path");
    (target as any)._url = new URL("http://example.com/base/path");
    const proxied = requestWithURL(target, "http://example.com/path");
    expect((proxied as any)._url).toBeUndefined();
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

  it("collapses leading slashes after stripping base", () => {
    // Otherwise `/base//evil.com` strips to `//evil.com`, a protocol-relative
    // pathname a downstream redirect could turn into a `//host` open redirect.
    const req = new Request("http://example.com/base//evil.com");
    const proxied = requestWithBaseURL(req, "/base");
    expect(new URL(proxied.url).pathname).toBe("/evil.com");
  });

  it("leaves pathname untouched when base does not match", () => {
    const req = new Request("http://example.com/other/path");
    const proxied = requestWithBaseURL(req, "/base");
    expect(new URL(proxied.url).pathname).toBe("/other/path");
  });
});

describe("getRequestProtocol", () => {
  it("ignores x-forwarded-proto by default (spoofed https)", () => {
    const event = makeEvent({ "x-forwarded-proto": "https" }, "http://localhost/test");
    expect(getRequestProtocol(event)).toBe("http");
  });

  it("returns https for plain x-forwarded-proto: https when enabled", () => {
    const event = makeEvent({ "x-forwarded-proto": "https" });
    expect(getRequestProtocol(event, { xForwardedProto: true })).toBe("https");
  });

  it("returns http for plain x-forwarded-proto: http when enabled", () => {
    const event = makeEvent({ "x-forwarded-proto": "http" });
    expect(getRequestProtocol(event, { xForwardedProto: true })).toBe("http");
  });

  it("returns first entry of comma-list x-forwarded-proto (https,http) when enabled", () => {
    const event = makeEvent({ "x-forwarded-proto": "https,http" });
    expect(getRequestProtocol(event, { xForwardedProto: true })).toBe("https");
  });

  it("returns first entry of comma-list x-forwarded-proto with spaces (https, http) when enabled", () => {
    const event = makeEvent({ "x-forwarded-proto": "https, http" });
    expect(getRequestProtocol(event, { xForwardedProto: true })).toBe("https");
  });

  it("ignores x-forwarded-proto when xForwardedProto is false", () => {
    const event = makeEvent({ "x-forwarded-proto": "https" }, "http://localhost/test");
    expect(getRequestProtocol(event, { xForwardedProto: false })).toBe("http");
  });
});
