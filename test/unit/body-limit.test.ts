import { expect, it, describe } from "vitest";
import { mockEvent, assertBodySize, HTTPError } from "../../src/index.ts";

describe("body limit (unit)", () => {
  const streamBytesFrom = (parts: Iterable<string>) =>
    new ReadableStream<string>({
      start(c) {
        for (const part of parts) c.enqueue(part);
        c.close();
      },
    }).pipeThrough(new TextEncoderStream());

  const readBody = (event: ReturnType<typeof mockEvent>) => event.req.text();

  // Capture a promise's rejection value (the body can only be read once).
  const rejectionOf = (promise: Promise<unknown>) =>
    promise.then(
      () => {
        throw new Error("expected the body read to reject");
      },
      (error) => error,
    );

  const expectTooLarge = async (promise: Promise<unknown>) => {
    const error = await rejectionOf(promise);
    expect(error).toBeInstanceOf(HTTPError);
    expect((error as HTTPError).status).toBe(413);
  };

  describe("assertBodySize", () => {
    it("no-ops when the request has no body", () => {
      const event = mockEvent("/", { method: "GET" });
      expect(() => assertBodySize(event, 1)).not.toThrow();
    });

    it("fails fast on an honest oversized content-length", () => {
      const BODY = "a small request body";
      const event = mockEvent("/", {
        method: "POST",
        body: BODY,
        headers: { "content-length": String(BODY.length) },
      });

      try {
        assertBodySize(event, BODY.length - 2);
        expect.unreachable("should throw before the handler runs");
      } catch (error) {
        expect(error).toBeInstanceOf(HTTPError);
        expect((error as HTTPError).status).toBe(413);
      }
      // The body stream is untouched by the fail-fast path.
      expect(event.req.bodyUsed).toBe(false);
    });

    it("allows a body within the limit and keeps it readable", async () => {
      const BODY = "a small request body";
      const event = mockEvent("/", { method: "POST", body: BODY });

      expect(() => assertBodySize(event, BODY.length)).not.toThrow();
      expect(() => assertBodySize(event, BODY.length + 10)).not.toThrow();
      await expect(readBody(event)).resolves.toBe(BODY);
    });

    it("works for non-POST methods carrying a body (QUERY)", async () => {
      const BODY = "a query request body";

      const within = mockEvent("/", { method: "QUERY", body: BODY });
      expect(() => assertBodySize(within, BODY.length)).not.toThrow();
      await expect(readBody(within)).resolves.toBe(BODY);

      const over = mockEvent("/", { method: "QUERY", body: BODY });
      expect(() => assertBodySize(over, BODY.length - 2)).not.toThrow();
      await expectTooLarge(readBody(over));
    });

    it("enforces the limit mid-stream for chunked bodies (no content-length)", async () => {
      const PARTS = ["parts", "of", "the", "body", "that", "are", "streamed", "in"];

      const within = mockEvent("/", { method: "POST", body: streamBytesFrom(PARTS) });
      expect(within.req.headers.get("content-length")).toBeNull();
      // Enforcement is deferred to consumption: no synchronous throw.
      expect(() => assertBodySize(within, 100)).not.toThrow();
      await expect(readBody(within)).resolves.toBe(PARTS.join(""));

      const over = mockEvent("/", { method: "POST", body: streamBytesFrom(PARTS) });
      expect(() => assertBodySize(over, 10)).not.toThrow();
      await expectTooLarge(readBody(over));
    });

    it("enforces the limit for bodies with a transfer-encoding header", async () => {
      const PARTS = ["parts", "of", "the", "body", "that", "are", "streamed", "in"];
      const over = mockEvent("/", {
        method: "POST",
        body: streamBytesFrom(PARTS),
        headers: { "transfer-encoding": "chunked" },
      });

      expect(() => assertBodySize(over, 10)).not.toThrow();
      await expectTooLarge(readBody(over));
    });

    it("catches a lying-small content-length once the real bytes flow", async () => {
      const LARGE_BODY = "A".repeat(1024); // 1KB actual body
      const event = mockEvent("/", {
        method: "POST",
        body: LARGE_BODY,
        headers: { "content-length": "10" }, // lie: claim 10 bytes
      });

      // 10 <= limit, so the fail-fast path is skipped; the real size is verified
      // as the body is read.
      expect(() => assertBodySize(event, 100)).not.toThrow();
      await expectTooLarge(readBody(event));
    });

    it("rejects content-length + transfer-encoding (smuggling) with 400", () => {
      const makeEvent = () =>
        mockEvent("/", {
          method: "POST",
          body: "test",
          headers: { "transfer-encoding": "chunked", "content-length": "4" },
        });

      for (const limit of [10, 100]) {
        try {
          assertBodySize(makeEvent(), limit);
          expect.unreachable("smuggling request must be rejected");
        } catch (error) {
          expect(error).toBeInstanceOf(HTTPError);
          expect((error as HTTPError).status).toBe(400);
        }
      }
    });
  });
});
