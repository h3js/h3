import { describe, expect, it } from "vitest";
import { requestWithURL, requestWithBaseURL, toRequest } from "../../src/utils/request.ts";
import { getRequestProtocol } from "../../src/index.ts";
import type { ServerRequest } from "srvx";

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

  it("does not leak Object.prototype through the memo cache", () => {
    const proxied = requestWithURL(original, "http://example.com/path");
    expect(proxied.constructor).toBe(original.constructor);
    expect(proxied.constructor.name).toBe("Request");
    expect((proxied as any).__proto__).toBe(Object.getPrototypeOf(original));
  });

  it("does not memoize bodyUsed", async () => {
    const req = new Request("http://example.com/base/path", { method: "POST", body: "hello" });
    const proxied = requestWithURL(req, "http://example.com/path");
    expect(proxied.bodyUsed).toBe(false);
    await proxied.text();
    expect(proxied.bodyUsed).toBe(true);
  });

  it("invalidates the memo cache on write", () => {
    const req = new Request("http://example.com/base/path");
    const proxied = requestWithURL(req, "http://example.com/path");
    expect(proxied.context).toBeUndefined();
    proxied.context = { foo: "bar" };
    expect(proxied.context).toEqual({ foo: "bar" });
    expect((req as ServerRequest).context).toEqual({ foo: "bar" });
    // the url override survives writes to other props
    expect(proxied.url).toBe("http://example.com/path");
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

describe("toRequest", () => {
  it("uses a plain host header for the synthesized authority", () => {
    const req = toRequest("/api/data", { headers: { host: "example.com:3000" } });
    const url = new URL(req.url);
    expect(url.host).toBe("example.com:3000");
    expect(url.pathname).toBe("/api/data");
  });

  it("defaults to localhost without a host header", () => {
    expect(new URL(toRequest("/api/data").url).host).toBe("localhost");
  });

  it("keeps a host header from injecting a path", () => {
    for (const host of ["x/../admin", String.raw`x\..\admin`, "x?y", "x#y"]) {
      const url = new URL(toRequest("/api/data", { headers: { host } }).url);
      expect(url.pathname).toBe("/api/data");
      expect(url.host).toBe("localhost");
    }
  });

  it("keeps a host header from hijacking the authority with userinfo", () => {
    const url = new URL(toRequest("/api/data", { headers: { host: "evil.com@internal" } }).url);
    expect(url.host).toBe("localhost");
    expect(url.username).toBe("");
  });

  it("ignores x-forwarded-proto", () => {
    const req = toRequest("/api/data", {
      headers: { host: "example.com", "x-forwarded-proto": "https" },
    });
    expect(new URL(req.url).protocol).toBe("http:");
  });

  it("keeps a protocol-relative path out of the authority", () => {
    const url = new URL(toRequest("//evil.com/api", { headers: { host: "example.com" } }).url);
    expect(url.host).toBe("example.com");
    expect(url.pathname).toBe("//evil.com/api");
  });
});
