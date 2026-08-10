import { describe, it, expect } from "vitest";
import { FastURL } from "srvx";
import { H3Event } from "../../src/event.ts";
import { getRequestIP } from "../../src/utils/request.ts";
import {
  canonicalPathname,
  isMalformedPathname,
  isNonCanonicalPathname,
} from "../../src/utils/internal/path.ts";

describe("H3Event URL", () => {
  it("reuses the runtime-provided _url", () => {
    const req = new Request("http://localhost/hello");
    (req as any)._url = new FastURL("http://localhost/hello");
    const event = new H3Event(req);
    expect(event.url).toBe((req as any)._url);
  });

  // Nothing but an unreserved escape is canonicalized, so for these the URL
  // shared with the runtime is neither mutated nor cloned (#1432).
  for (const pathname of ["/a%2Fb", "/a%5Cb", "/caf%c3%a9", "/a%20b", "/a%09b"]) {
    it(`keeps ${pathname} in its wire form, reusing _url`, () => {
      const href = `http://localhost${pathname}?q=%41`;
      const req = new Request(href);
      (req as any)._url = new FastURL(href);
      const event = new H3Event(req);
      expect(event.url).toBe((req as any)._url);
      expect(event.url.pathname).toBe(pathname);
      expect(event.url.search).toBe("?q=%41");
    });
  }

  // A non-canonical pathname is decoded into a *clone*: the shared parsed URL
  // and `req.url` must keep the original wire encoding (#1432).
  for (const [pathname, canonical] of [
    ["/h%65llo", "/hello"],
    ["/a%2541-%41", "/a%2541-A"],
    ["/%7Euser", "/~user"],
  ]) {
    it(`canonicalizes ${pathname} without touching _url`, () => {
      const href = `http://localhost${pathname}?q=%41`;
      const req = new Request(href);
      (req as any)._url = new FastURL(href);
      const event = new H3Event(req);
      expect(event.url).not.toBe((req as any)._url);
      expect(event.url.pathname).toBe(canonical);
      expect(event.url.search).toBe("?q=%41");
      expect(((req as any)._url as URL).pathname).toBe(pathname);
      expect(new URL(req.url).pathname).toBe(pathname);
    });
  }

  it("does not double-decode when two events share one _url", () => {
    const href = "http://localhost/a%2541-%41";
    const req = new Request(href);
    (req as any)._url = new FastURL(href);
    expect(new H3Event(req).url.pathname).toBe("/a%2541-A");
    expect(new H3Event(req).url.pathname).toBe("/a%2541-A");
    expect(((req as any)._url as URL).pathname).toBe("/a%2541-%41");
  });

  it("keeps the raw pathname when the encoding is malformed", () => {
    const req = new Request("http://localhost/%61dmin%ZZ");
    const event = new H3Event(req);
    expect(event.url.pathname).toBe("/%61dmin%ZZ");
  });
});

describe("H3Event context reference", () => {
  it("shares one reference with req.context when neither is provided", () => {
    const req = new Request("http://localhost/");
    const event = new H3Event(req as any);
    expect(event.context).toBe(event.req.context);
  });

  it("shares one reference with req.context when an explicit context is passed", () => {
    const req = new Request("http://localhost/");
    const context = {} as any;
    const event = new H3Event(req as any, context);
    expect(event.context).toBe(context);
    expect(event.req.context).toBe(context);
  });

  it("reuses a pre-populated req.context", () => {
    const req = new Request("http://localhost/") as any;
    req.context = { clientAddress: "1.1.1.1" };
    const event = new H3Event(req);
    expect(event.context).toBe(req.context);
    expect(event.context.clientAddress).toBe("1.1.1.1");
  });

  it("getRequestIP observes clientAddress written to event.context", () => {
    const req = new Request("http://localhost/");
    const event = new H3Event(req as any);
    event.context.clientAddress = "9.9.9.9";
    expect(getRequestIP(event)).toBe("9.9.9.9");
  });
});

describe("canonicalPathname", () => {
  it("decodes unreserved escapes", () => {
    expect(canonicalPathname("/api/%61dmin")).toBe("/api/admin");
    expect(canonicalPathname("/a%2Eb")).toBe("/a.b");
    expect(canonicalPathname("/%7Euser/%2Dx/%5Fy/%30")).toBe("/~user/-x/_y/0");
  });

  // Dot segments are resolved by the URL parser (every `%2e` spelling, per the
  // WHATWG "double-dot path segment" check) before a pathname reaches h3, and
  // decoding an unreserved escape adds no separator that could reveal a new one.
  it("relies on the URL parser having resolved dot segments", () => {
    for (const spelling of ["/a/%2e%2e/b", "/a/%2E%2E/b", "/a/.%2e/b", "/a/../b"]) {
      expect(new URL(spelling, "http://h").pathname).toBe("/b");
    }
    expect(canonicalPathname("/a/%2e%2ex/b")).toBe("/a/..x/b"); // not a dot segment
  });

  it("leaves every other escape byte-for-byte", () => {
    for (const input of [
      "/a%2Fb", // separators stay encoded: a `:param` must not gain a boundary
      "/a%5Cb",
      "/a%2541", // `%25` is not unreserved, so this never becomes decodable
      "/caf%c3%a9", // non-ASCII, including its hex case
      "/a%20b",
      "/a%09b", // decoding this would let the URL parser delete the character
      "/a%3Ab",
    ]) {
      expect(canonicalPathname(input)).toBe(input);
      expect(isNonCanonicalPathname(input)).toBe(false);
    }
  });

  it("is idempotent, so a redirect to it cannot loop", () => {
    for (const input of ["/api/%61dmin", "/a/%2e%2e/b", "/a%2541", "/caf%C3%A9", "/plain"]) {
      const once = canonicalPathname(input);
      expect(canonicalPathname(once)).toBe(once);
      expect(isNonCanonicalPathname(once)).toBe(false);
    }
  });

  it("flags exactly the pathnames it would change", () => {
    for (const input of ["/api/%61dmin", "/a%2Eb", "/a%2Fb", "/a%20b", "/plain", "/a%2541"]) {
      expect(isNonCanonicalPathname(input)).toBe(canonicalPathname(input) !== input);
    }
  });
});

describe("isMalformedPathname", () => {
  it("detects truncated, non-hex and invalid-UTF-8 escapes", () => {
    for (const input of ["/foo%", "/%ZZ", "/bar%2", "/%", "/%80", "/%C3%28"]) {
      expect(isMalformedPathname(input)).toBe(true);
    }
    for (const input of ["/plain", "/a%20b", "/caf%C3%A9", "/a%2541", "/a%2Fb"]) {
      expect(isMalformedPathname(input)).toBe(false);
    }
  });
});
