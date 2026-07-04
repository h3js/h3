import { describe, it, expect } from "vitest";
import { FastURL } from "srvx";
import { H3Event } from "../../src/event.ts";
import { decodePathname } from "../../src/utils/internal/path.ts";

describe("H3Event URL normalization", () => {
  it("reuses the runtime-provided _url when no decoding is needed", () => {
    const req = new Request("http://localhost/hello");
    (req as any)._url = new FastURL("http://localhost/hello");
    const event = new H3Event(req);
    expect(event.url).toBe((req as any)._url);
  });

  it("reuses the runtime-provided _url when decoding is an identity (reserved chars)", () => {
    const req = new Request("http://localhost/a%2Fb");
    (req as any)._url = new FastURL("http://localhost/a%2Fb");
    const event = new H3Event(req);
    expect(event.url).toBe((req as any)._url);
    expect(event.url.pathname).toBe("/a%2Fb");
  });

  it("clones instead of mutating the runtime-provided _url when decoding", () => {
    const req = new Request("http://localhost/h%65llo?q=%41");
    (req as any)._url = new FastURL("http://localhost/h%65llo?q=%41");
    const event = new H3Event(req);
    expect(event.url.pathname).toBe("/hello");
    expect(event.url.search).toBe("?q=%41");
    expect(event.url).not.toBe((req as any)._url);
    // The shared parsed URL keeps the original wire encoding (#1432)
    expect(((req as any)._url as URL).pathname).toBe("/h%65llo");
  });

  it("does not double-decode when two events share one _url", () => {
    const href = "http://localhost/a%2541-%41";
    const req = new Request(href);
    (req as any)._url = new FastURL(href);
    const first = new H3Event(req);
    expect(first.url.pathname).toBe("/a%2541-A");
    const second = new H3Event(req);
    expect(second.url.pathname).toBe("/a%2541-A");
    expect(((req as any)._url as URL).pathname).toBe("/a%2541-%41");
  });
});

describe("decodePathname", () => {
  it("is idempotent", () => {
    for (const input of [
      "/a%41b",
      "/a%2541", // encoded % must stay encoded, never becoming decodable
      "/%2525",
      "/a%2Fb", // reserved chars stay encoded
      "/caf%C3%A9",
      "/plain",
    ]) {
      const once = decodePathname(input);
      expect(decodePathname(once)).toBe(once);
    }
  });
});
