import { beforeEach, describe, expect, it, vi } from "vitest";

const parseCookieSpy = vi.hoisted(() => vi.fn());
const parseSetCookieSpy = vi.hoisted(() => vi.fn());

vi.mock("cookie-es", async (importOriginal) => {
  const actual = await importOriginal<typeof import("cookie-es")>();
  return {
    ...actual,
    parseCookie: parseCookieSpy.mockImplementation(actual.parseCookie),
    parseSetCookie: parseSetCookieSpy.mockImplementation(actual.parseSetCookie),
  };
});

const { getChunkedCookie, setChunkedCookie } = await import("../../src/utils/cookie.ts");

describe("cookie performance", () => {
  beforeEach(() => {
    parseCookieSpy.mockClear();
    parseSetCookieSpy.mockClear();
  });

  it("parses the request cookie header once when reading chunked cookies", () => {
    const event = {
      req: {
        headers: new Headers({
          cookie: [
            "session=__chunked__3",
            "session.1=alpha",
            "session.2=beta",
            "session.3=gamma",
          ].join("; "),
        }),
      },
    };

    expect(getChunkedCookie(event as any, "session")).toBe("alphabetagamma");
    expect(parseCookieSpy).toHaveBeenCalledTimes(1);
  });

  it("does not reparse existing set-cookie headers when appending unique chunks", () => {
    const event = {
      req: {
        headers: new Headers(),
      },
      res: {
        headers: new Headers(),
      },
    };

    setChunkedCookie(event as any, "session", "abcdefghij", {
      chunkMaxLength: 3,
    });

    expect(event.res.headers.getSetCookie()).toEqual([
      "session=__chunked__4; Path=/",
      "session.1=abc; Path=/",
      "session.2=def; Path=/",
      "session.3=ghi; Path=/",
      "session.4=j; Path=/",
    ]);
    expect(parseSetCookieSpy).toHaveBeenCalledTimes(0);
  });
});
