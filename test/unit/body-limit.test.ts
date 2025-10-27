import { expect, it, describe } from "vitest";
import { mockEvent, assertBodySize, HTTPError } from "../../src/index.ts";

describe("body limit (unit)", () => {
  const streamBytesFrom = (it: Iterable<any, any>) =>
    new ReadableStream({
      start(c) {
        for (const part of it) c.enqueue(part);
        c.close();
      },
    }).pipeThrough(new TextEncoderStream());

  describe("assertBodySize", () => {
    it("buffered body", async () => {
      const BODY = "a small request body";

      const eventMock = mockEvent("/", {
        method: "POST",
        body: BODY,
      });

      await expect(
        assertBodySize(eventMock, BODY.length),
      ).resolves.toBeUndefined();
      await expect(
        assertBodySize(eventMock, BODY.length + 10),
      ).resolves.toBeUndefined();
      await expect(assertBodySize(eventMock, BODY.length - 2)).rejects.toThrow(
        HTTPError,
      );
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

      await expect(assertBodySize(eventMock, 100)).resolves.toBeUndefined();
      await expect(assertBodySize(eventMock, 10)).rejects.toThrow(HTTPError);
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
        headers: { "transfer-encoding": "chunked" },
      });

      await expect(assertBodySize(eventMock, 100)).resolves.toBeUndefined();
      await expect(assertBodySize(eventMock, 10)).rejects.toThrow(HTTPError);
    });

    it("both content length and transfer encoding", async () => {
      const eventMock = mockEvent("/", {
        method: "POST",
        body: "test",
        headers: { "transfer-encoding": "chunked", "content-length": "4" },
      });
      await expect(assertBodySize(eventMock, 10)).rejects.toThrow(HTTPError);
      await expect(assertBodySize(eventMock, 100)).rejects.toThrow(HTTPError);
    });
  });
});
