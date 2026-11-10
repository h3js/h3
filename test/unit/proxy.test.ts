import { describe, it, expect, vi } from "vitest";
import { H3Event } from "../../src/event.ts";
import {
  abortable,
  applyXForwardedHeaders,
  connectionTokens,
  framingHeaders,
  ignoredHeaders,
  ignoredResponseHeaders,
  mergeHeaders,
  rewriteCookieProperty,
  rewriteLocationHeaders,
} from "../../src/utils/internal/proxy.ts";

function testEvent(url: string, ip?: string): H3Event {
  const req = new Request(url);
  if (ip !== undefined) {
    (req as { ip?: string }).ip = ip;
  }
  return new H3Event(req);
}

describe("proxy internal header sets", () => {
  it("does not strip the incoming accept header but keeps accept-encoding", () => {
    expect(ignoredHeaders.has("accept")).toBe(false);
    expect(ignoredHeaders.has("accept-encoding")).toBe(true);
  });

  it("keeps framing headers a strict subset of the ignored request headers", () => {
    for (const key of framingHeaders) {
      expect(ignoredHeaders.has(key)).toBe(true);
    }
    // `host`, `accept-encoding` and `expect` are soft drops, not framing
    // headers — `forwardHeaders` may override them.
    expect(framingHeaders.has("host")).toBe(false);
    expect(framingHeaders.has("accept-encoding")).toBe(false);
    expect(framingHeaders.has("expect")).toBe(false);
  });

  it("strips hop-by-hop and length/encoding response headers", () => {
    for (const key of [
      "content-encoding",
      "content-length",
      "transfer-encoding",
      "connection",
      "keep-alive",
      "proxy-authenticate",
      "proxy-connection",
      "upgrade",
      "trailer",
      "te",
    ]) {
      expect(ignoredResponseHeaders.has(key)).toBe(true);
    }
  });

  it("drops hop-by-hop request credentials/controls by default", () => {
    expect(ignoredHeaders.has("proxy-authorization")).toBe(true);
    expect(ignoredHeaders.has("proxy-connection")).toBe(true);
  });
});

describe("rewriteCookieProperty", () => {
  it("applies own exact and wildcard mappings", () => {
    expect(
      rewriteCookieProperty(
        "foo=bar; Domain=old.example",
        { "old.example": "new.example" },
        "domain",
      ),
    ).toBe("foo=bar; Domain=new.example");
    expect(
      rewriteCookieProperty("foo=bar; Domain=any.example", { "*": "new.example" }, "domain"),
    ).toBe("foo=bar; Domain=new.example");
  });

  it("ignores inherited (prototype-polluted) map properties", () => {
    // Simulate prototype pollution without mutating the global prototype: the
    // mappings live on `map`'s prototype, so they are inherited, not own.
    const map = Object.create({ "old.example": "evil.example", "*": "evil.example" });
    const cookie = "foo=bar; Domain=old.example; Path=/";
    expect(rewriteCookieProperty(cookie, map, "domain")).toBe(cookie);
  });
});

describe("connectionTokens", () => {
  it("parses nominated field names into a lowercased set", () => {
    expect(connectionTokens("keep-alive, Upgrade")).toEqual(new Set(["keep-alive", "upgrade"]));
  });

  it("trims padding and drops empty segments", () => {
    expect(connectionTokens(" close ,, content-length ")).toEqual(
      new Set(["close", "content-length"]),
    );
  });

  it("returns an empty set for null or empty input", () => {
    expect(connectionTokens(null)).toEqual(new Set());
    expect(connectionTokens("")).toEqual(new Set());
  });
});

describe("applyXForwardedHeaders", () => {
  it("appends this hop's peer to an inbound x-forwarded-for chain", () => {
    const headers = applyXForwardedHeaders(
      { "x-forwarded-for": "10.0.0.1, 192.0.2.9" },
      testEvent("http://localhost:3000/", "203.0.113.7"),
    );
    // The inbound value is kept for the audit trail but the real peer is
    // appended, so a spoofed chain can never mask it.
    expect(headers.get("x-forwarded-for")).toBe("10.0.0.1, 192.0.2.9, 203.0.113.7");
  });

  it("seeds the chain with the peer when no inbound value exists", () => {
    const headers = applyXForwardedHeaders({}, testEvent("http://localhost:3000/", "203.0.113.7"));
    expect(headers.get("x-forwarded-for")).toBe("203.0.113.7");
  });

  it("keeps the inbound chain when no peer address is known", () => {
    const headers = applyXForwardedHeaders(
      { "x-forwarded-for": "192.0.2.9" },
      testEvent("http://localhost:3000/"),
    );
    expect(headers.get("x-forwarded-for")).toBe("192.0.2.9");
  });

  it("overwrites spoofed inbound x-forwarded-proto/host/port with this hop's values", () => {
    const headers = applyXForwardedHeaders(
      {
        "x-forwarded-proto": "https",
        "x-forwarded-host": "evil.example",
        "x-forwarded-port": "8443",
      },
      testEvent("http://localhost:3000/", "203.0.113.7"),
    );
    expect(headers.get("x-forwarded-proto")).toBe("http");
    expect(headers.get("x-forwarded-host")).toBe("localhost:3000");
    expect(headers.get("x-forwarded-port")).toBe("3000");
  });

  it("defaults the forwarded port to 443 for https and 80 for http", () => {
    const https = applyXForwardedHeaders({}, testEvent("https://example.com/", "203.0.113.7"));
    expect(https.get("x-forwarded-port")).toBe("443");
    const http = applyXForwardedHeaders({}, testEvent("http://example.com/", "203.0.113.7"));
    expect(http.get("x-forwarded-port")).toBe("80");
  });

  it("applies in place onto a Headers instance, keeping unrelated headers", () => {
    const input = new Headers({ "x-custom": "kept" });
    const headers = applyXForwardedHeaders(input, testEvent("http://localhost:3000/"));
    expect(headers).toBe(input);
    expect(headers.get("x-custom")).toBe("kept");
  });
});

describe("rewriteLocationHeaders", () => {
  const targetOrigin = "https://api.example.com";
  const requestOrigin = "https://proxy.example.com";

  it("rewrites a target-origin location, keeping path, search and hash", () => {
    const headers = new Headers({ location: "https://api.example.com/login?next=/#top" });
    rewriteLocationHeaders(headers, true, targetOrigin, requestOrigin);
    expect(headers.get("location")).toBe("https://proxy.example.com/login?next=/#top");
  });

  it("leaves third-party and relative locations untouched", () => {
    for (const location of ["https://other.example.com/x", "/relative", "../rel"]) {
      const headers = new Headers({ location });
      rewriteLocationHeaders(headers, true, targetOrigin, requestOrigin);
      expect(headers.get("location")).toBe(location);
    }
  });

  it("resolves a protocol-relative location against the target origin", () => {
    const headers = new Headers({ location: "//api.example.com/deep?x=1" });
    rewriteLocationHeaders(headers, true, targetOrigin, requestOrigin);
    expect(headers.get("location")).toBe("https://proxy.example.com/deep?x=1");
  });

  it("does not rewrite when the target equals the request origin or is unknown", () => {
    const sameOrigin = new Headers({ location: `${targetOrigin}/x` });
    rewriteLocationHeaders(sameOrigin, true, targetOrigin, targetOrigin);
    expect(sameOrigin.get("location")).toBe(`${targetOrigin}/x`);

    const noTarget = new Headers({ location: `${targetOrigin}/x` });
    rewriteLocationHeaders(noTarget, true, undefined, requestOrigin);
    expect(noTarget.get("location")).toBe(`${targetOrigin}/x`);
  });

  it("rewrites the URL inside refresh headers, quoted or not", () => {
    const unquoted = new Headers({ refresh: "5; url=https://api.example.com/go" });
    rewriteLocationHeaders(unquoted, true, targetOrigin, requestOrigin);
    expect(unquoted.get("refresh")).toBe("5; url=https://proxy.example.com/go");

    const quoted = new Headers({ refresh: '0; url="https://api.example.com/go"' });
    rewriteLocationHeaders(quoted, true, targetOrigin, requestOrigin);
    expect(quoted.get("refresh")).toBe('0; url="https://proxy.example.com/go"');
  });

  it("leaves a refresh header without a url directive untouched", () => {
    const headers = new Headers({ refresh: "5" });
    rewriteLocationHeaders(headers, true, targetOrigin, requestOrigin);
    expect(headers.get("refresh")).toBe("5");
  });

  it("maps the first matching location prefix when rewrite is a record", () => {
    const map = { "https://api.example.com/assets/": "/static/" };
    const rewritten = new Headers({ location: "https://api.example.com/assets/app.js" });
    rewriteLocationHeaders(rewritten, map, undefined, requestOrigin);
    expect(rewritten.get("location")).toBe("/static/app.js");

    const unmatched = new Headers({ location: "https://api.example.com/other" });
    rewriteLocationHeaders(unmatched, map, undefined, requestOrigin);
    expect(unmatched.get("location")).toBe("https://api.example.com/other");
  });

  it("ignores inherited (prototype-polluted) rewrite prefixes", () => {
    const map = Object.create({ "https://api.example.com/": "https://evil.example/" });
    const headers = new Headers({ location: "https://api.example.com/x" });
    rewriteLocationHeaders(headers, map, undefined, requestOrigin);
    expect(headers.get("location")).toBe("https://api.example.com/x");
  });
});

describe("abortable", () => {
  it("rejects with the signal reason without starting the task when already aborted", async () => {
    const reason = new Error("aborted before start");
    const controller = new AbortController();
    controller.abort(reason);
    const run = vi.fn();
    await expect(abortable(run, controller.signal)).rejects.toThrow(reason);
    expect(run).not.toHaveBeenCalled();
  });

  it("resolves with the task result and stays settled after a later abort", async () => {
    const controller = new AbortController();
    const promise = abortable(() => "ok", controller.signal);
    await expect(promise).resolves.toBe("ok");
    // The settle handler removes the abort listener, so an abort after the
    // outcome is known cannot flip it.
    controller.abort(new Error("too late"));
    await expect(promise).resolves.toBe("ok");
  });

  it("rejects with the signal reason when aborted while the task is pending", async () => {
    const controller = new AbortController();
    const reason = new Error("disconnected");
    const promise = abortable(() => new Promise<string>(() => {}), controller.signal);
    controller.abort(reason);
    await expect(promise).rejects.toThrow(reason);
  });

  it("propagates task errors", async () => {
    await expect(
      abortable(() => {
        throw new Error("task failed");
      }, new AbortController().signal),
    ).rejects.toThrow("task failed");
  });
});

describe("mergeHeaders", () => {
  it("returns the defaults as-is when every input is undefined", () => {
    const defaults = { "x-default": "1" };
    expect(mergeHeaders(defaults, undefined, undefined)).toBe(defaults);
  });

  it("accepts records, Headers instances and entry arrays", () => {
    const headers = new Headers(
      mergeHeaders(
        { "x-default": "1" },
        new Headers({ "from-headers": "1" }),
        [["from-array", "1"]],
        { "from-record": "1" },
      ),
    );
    expect(headers.get("x-default")).toBe("1");
    expect(headers.get("from-headers")).toBe("1");
    expect(headers.get("from-array")).toBe("1");
    expect(headers.get("from-record")).toBe("1");
  });

  it("skips undefined values from entry inputs", () => {
    const headers = new Headers(mergeHeaders({ "x-kept": "1" }, [["x-skipped", undefined]] as any));
    expect(headers.get("x-kept")).toBe("1");
    expect(headers.has("x-skipped")).toBe(false);
  });

  it("lets later inputs override earlier ones and the defaults", () => {
    const headers = new Headers(
      mergeHeaders(
        { "x-over": "default" },
        { "x-over": "first" },
        new Headers({ "x-over": "second" }),
      ),
    );
    expect(headers.get("x-over")).toBe("second");
  });
});
