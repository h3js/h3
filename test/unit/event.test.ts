import { describe, it, expect } from "vitest";
import { FastURL } from "srvx";
import { H3Event } from "../../src/event.ts";
import { decodePathname } from "../../src/utils/internal/path.ts";

describe("H3Event URL normalization", () => {
  it("reuses the runtime-provided _url object in place", () => {
    const req = new Request("http://localhost/h%65llo");
    (req as any)._url = new FastURL("http://localhost/h%65llo");
    const event = new H3Event(req);
    expect(event.url).toBe((req as any)._url);
    expect(event.url.pathname).toBe("/hello");
  });

  it("does not double-decode when two events share one _url", () => {
    const href = "http://localhost/a%2541-%41";
    const req = new Request(href);
    (req as any)._url = new FastURL(href);
    const first = new H3Event(req);
    expect(first.url.pathname).toBe("/a%2541-A");
    const second = new H3Event(req);
    expect(second.url).toBe(first.url);
    expect(second.url.pathname).toBe("/a%2541-A");
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
