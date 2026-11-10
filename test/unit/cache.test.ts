import { describe, expect, it } from "vitest";
import { H3Event, handleCacheHeaders } from "../../src/index.ts";

describe("handleCacheHeaders", () => {
  for (const method of ["OPTIONS", "TRACE", "CONNECT"]) {
    for (const override of [false, true]) {
      it(`ignores conditional headers for ${method} (override: ${override})`, () => {
        const req = new Request("http://localhost/", {
          headers: override
            ? {}
            : {
                "if-none-match": '"v1"',
                "if-modified-since": "Fri, 01 Jan 2021 00:00:00 GMT",
              },
        });
        Object.defineProperty(req, "method", { value: method });
        const event = new H3Event(req);
        event.res.status = 202;
        const stop = handleCacheHeaders(event, {
          etag: '"v1"',
          modifiedTime: new Date("2021-01-01"),
          ifNoneMatch: override ? '"v1"' : undefined,
          ifModifiedSince: override ? "Fri, 01 Jan 2021 00:00:00 GMT" : undefined,
        });
        expect(stop).toBe(false);
        expect(event.res.status).toBe(202);
        expect(event.res.headers.get("etag")).toBe('"v1"');
        expect(event.res.headers.get("last-modified")).toBe("Fri, 01 Jan 2021 00:00:00 GMT");
        expect(event.res.headers.get("cache-control")).toBe("public");
      });
    }
  }
});
