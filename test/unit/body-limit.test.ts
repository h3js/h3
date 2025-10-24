import { expect, it, describe } from "vitest";
import { mockEvent, isBodySizeWithin } from "../../src/index.ts";

describe("body limit (unit)", () => {
  const streamBytesFrom = (it: Iterable<any, any>) =>
    new ReadableStream({
      start(c) {
        for (const part of it) c.enqueue(part);
        c.close();
      },
    }).pipeThrough(new TextEncoderStream());

  describe("isBodySizeWithin", () => {
    it("buffered body", async () => {
      const BODY = "a small request body";

      const eventMock = mockEvent("/", {
        method: "POST",
        body: BODY,
      });

      expect(await isBodySizeWithin(BODY.length, eventMock)).toBe(true);
      expect(await isBodySizeWithin(BODY.length + 10, eventMock)).toBe(true);
      expect(await isBodySizeWithin(BODY.length - 2, eventMock)).toBe(false);
    });

    it("streaming body", async () => {
      const BODY_PARTS = [
        "parts",
        "of",
        "the",
        "body",
        "that",
        "are",
        "streamed",
        "in",
      ];

      const eventMock = mockEvent("/", {
        method: "POST",
        body: streamBytesFrom(BODY_PARTS),
      });

      expect(await isBodySizeWithin(100, eventMock)).toBe(true);
      expect(await isBodySizeWithin(10, eventMock)).toBe(false);
    });

    it("streaming body with content-length header", async () => {
      const BODY_PARTS = [
        "parts",
        "of",
        "the",
        "body",
        "that",
        "are",
        "streamed",
        "in",
      ];

      const eventMock = mockEvent("/", {
        method: "POST",
        body: streamBytesFrom(BODY_PARTS),
        headers: {
          // Should ignore content-length
          "content-length": "7",
          "transfer-encoding": "chunked",
        },
      });

      expect(await isBodySizeWithin(100, eventMock)).toBe(true);
      expect(await isBodySizeWithin(10, eventMock)).toBe(false);
    });
  });
});
