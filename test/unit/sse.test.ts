import { describe, it, expect, vi } from "vitest";
import { getEventListeners } from "node:events";
import {
  EventStream,
  formatEventStreamComment,
  formatEventStreamMessage,
  formatEventStreamMessages,
} from "../../src/utils/internal/event-stream.ts";
import { mockEvent } from "../../src/index.ts";

describe("sse (unit)", () => {
  it("properly formats sse comments", () => {
    const result = formatEventStreamComment("hello world");
    expect(result).toEqual(`: hello world\n\n`);
  });

  it("properly formats sse messages", () => {
    const result = formatEventStreamMessage({ data: "hello world" });
    expect(result).toEqual(`data: hello world\n\n`);
    const result2 = formatEventStreamMessage({
      id: "1",
      event: "custom-event",
      retry: 10,
      data: "hello world",
    });
    expect(result2).toEqual(`id: 1\nevent: custom-event\nretry: 10\ndata: hello world\n\n`);
  });

  it("properly formats multiple sse messages", () => {
    const result = formatEventStreamMessages([
      {
        data: "hello world",
      },

      { id: "1", data: "hello world 2" },
    ]);
    expect(result).toEqual(`data: hello world\n\nid: 1\ndata: hello world 2\n\n`);
  });

  it("sanitizes newlines in event field to prevent SSE injection", () => {
    const result = formatEventStreamMessage({
      event: "message\nevent: admin\ndata: INJECTED",
      data: "legit",
    });
    expect(result).toEqual(`event: messageevent: admindata: INJECTED\ndata: legit\n\n`);
    // Newlines stripped — no separate "event: admin" line that could be parsed as a new field
    expect(result.split("\n").filter((l) => l.startsWith("event:")).length).toBe(1);
  });

  it("sanitizes newlines in id field to prevent SSE injection", () => {
    const result = formatEventStreamMessage({
      id: "1\ndata: INJECTED",
      data: "legit",
    });
    expect(result).toEqual(`id: 1data: INJECTED\ndata: legit\n\n`);
  });

  it("strips null characters from id and event fields", () => {
    const result = formatEventStreamMessage({
      id: "1\u0000",
      event: "msg\u0000",
      data: "legit",
    });
    // Per the SSE spec, clients ignore an id containing U+0000
    expect(result).toEqual(`id: 1\nevent: msg\ndata: legit\n\n`);
  });

  it("splits multi-line data into separate data fields", () => {
    const result = formatEventStreamMessage({
      data: "line1\nline2\nline3",
    });
    expect(result).toEqual(`data: line1\ndata: line2\ndata: line3\n\n`);
  });

  it("prevents data field injection of new events", () => {
    const result = formatEventStreamMessage({
      data: "hi\n\nevent: system\ndata: INJECTED",
    });
    // Each line becomes a separate data: field, no event injection possible
    expect(result).toBe(`data: hi\ndata: \ndata: event: system\ndata: data: INJECTED\n\n`);
  });

  it("sanitizes newlines in comments", () => {
    const result = formatEventStreamComment("hello\ndata: INJECTED");
    expect(result).toEqual(`: hello\n: data: INJECTED\n\n`);
  });

  it("sanitizes carriage returns in data to prevent SSE injection", () => {
    const result = formatEventStreamMessage({
      data: "legit\revent: evil",
    });
    // \r must be treated as a line break, so "event: evil" becomes a data: line
    expect(result).toBe(`data: legit\ndata: event: evil\n\n`);
  });

  it("sanitizes \\r\\n in data field", () => {
    const result = formatEventStreamMessage({
      data: "line1\r\nline2\rline3\nline4",
    });
    expect(result).toBe(`data: line1\ndata: line2\ndata: line3\ndata: line4\n\n`);
  });

  it("prevents event splitting via \\r\\r in data", () => {
    const result = formatEventStreamMessage({
      data: "first\r\rdata: injected",
    });
    // \r\r should produce an empty line between, not a message boundary
    expect(result).toBe(`data: first\ndata: \ndata: data: injected\n\n`);
  });

  it("sanitizes carriage returns in comments to prevent injection", () => {
    const result = formatEventStreamComment("x\rdata: injected");
    expect(result).toBe(`: x\n: data: injected\n\n`);
  });

  describe("EventStream", () => {
    it("onClosed does not cause unhandled rejection when callback throws", async () => {
      const event = mockEvent("/");
      const stream = new EventStream(event);

      const unhandled = vi.fn();
      process.on("unhandledRejection", unhandled);

      stream.onClosed(() => {
        throw new Error("callback error");
      });

      await stream.close();
      // Give microtasks time to settle
      await new Promise((r) => setTimeout(r, 10));

      process.off("unhandledRejection", unhandled);
      expect(unhandled).not.toHaveBeenCalled();
    });

    it("does not emit unhandled rejection when readable side is canceled", async () => {
      const event = mockEvent("/");
      const stream = new EventStream(event);

      const unhandled = vi.fn();
      process.on("unhandledRejection", unhandled);

      const readable = (await stream.send()) as ReadableStream<Uint8Array>;
      const reader = readable.getReader();
      await reader.cancel(new Error("resource closed"));

      // Give microtasks time to settle
      await new Promise((r) => setTimeout(r, 10));

      process.off("unhandledRejection", unhandled);
      expect(unhandled).not.toHaveBeenCalled();
    });

    it("fires onClosed when the readable side is canceled", async () => {
      const event = mockEvent("/");
      const stream = new EventStream(event);

      const onClosed = vi.fn();
      stream.onClosed(onClosed);

      const readable = (await stream.send()) as ReadableStream<Uint8Array>;
      await readable.getReader().cancel(new Error("client gone"));
      await new Promise((r) => setTimeout(r, 10));

      expect(onClosed).toHaveBeenCalledTimes(1);
    });

    it("fires onClosed exactly once across cancel and explicit close", async () => {
      const event = mockEvent("/");
      const stream = new EventStream(event);

      const onClosed = vi.fn();
      stream.onClosed(onClosed);

      const readable = (await stream.send()) as ReadableStream<Uint8Array>;
      await readable.getReader().cancel(new Error("client gone"));
      await stream.close();
      await stream.close();
      await new Promise((r) => setTimeout(r, 10));

      expect(onClosed).toHaveBeenCalledTimes(1);
    });

    it("closes the stream when the request signal aborts", async () => {
      const ctrl = new AbortController();
      const event = mockEvent("/", { signal: ctrl.signal });
      const stream = new EventStream(event);

      const onClosed = vi.fn();
      stream.onClosed(onClosed);

      ctrl.abort();
      await new Promise((r) => setTimeout(r, 10));

      expect(onClosed).toHaveBeenCalledTimes(1);
      // Writes after an autoclose are dropped rather than throwing.
      await stream.push("after");
    });

    it("does not autoclose on signal abort when autoclose is disabled", async () => {
      const ctrl = new AbortController();
      const event = mockEvent("/", { signal: ctrl.signal });
      const stream = new EventStream(event, { autoclose: false });

      const onClosed = vi.fn();
      stream.onClosed(onClosed);

      ctrl.abort();
      await new Promise((r) => setTimeout(r, 10));

      expect(onClosed).not.toHaveBeenCalled();
    });

    it("closes immediately when the request signal is already aborted", async () => {
      const event = mockEvent("/", { signal: AbortSignal.abort() });
      const stream = new EventStream(event);

      const onClosed = vi.fn();
      stream.onClosed(onClosed);
      await new Promise((r) => setTimeout(r, 10));

      expect(onClosed).toHaveBeenCalledTimes(1);
    });

    it("removes the abort listener once closed", async () => {
      const ctrl = new AbortController();
      const event = mockEvent("/", { signal: ctrl.signal });
      // Note: `req.signal` is the Request's own signal following `ctrl`, not
      // `ctrl.signal` itself — that is what the stream subscribes to.
      const signal = event.req.signal;
      const baseline = getEventListeners(signal, "abort").length;

      const stream = new EventStream(event);
      expect(getEventListeners(signal, "abort").length).toBe(baseline + 1);

      await stream.close();
      expect(getEventListeners(signal, "abort").length).toBe(baseline);
    });

    it("does not emit unhandled rejection when an async onClosed callback rejects", async () => {
      const event = mockEvent("/");
      const stream = new EventStream(event);

      const unhandled = vi.fn();
      process.on("unhandledRejection", unhandled);

      stream.onClosed(async () => {
        throw new Error("async callback error");
      });

      await stream.close();
      await new Promise((r) => setTimeout(r, 10));

      process.off("unhandledRejection", unhandled);
      expect(unhandled).not.toHaveBeenCalled();
    });

    it("push stops retrying after write failure", async () => {
      const event = mockEvent("/");
      const stream = new EventStream(event);

      // Close the writer to force write failures
      await stream.close();

      // First push after close should not throw
      await stream.push("msg1");
      // Second push should also silently skip (not retry on broken stream)
      await stream.push("msg2");
    });

    it("pushComment stops retrying after write failure", async () => {
      const event = mockEvent("/");
      const stream = new EventStream(event);

      await stream.close();

      await stream.pushComment("comment1");
      await stream.pushComment("comment2");
    });

    it("marks writer as closed on push write failure", async () => {
      const event = mockEvent("/");
      const stream = new EventStream(event);

      const writeSpy = vi.fn().mockRejectedValue(new Error("write failed"));
      (stream as any)._writer.write = writeSpy;
      (stream as any)._writerIsClosed = false;

      await stream.push("test");
      expect((stream as any)._writerIsClosed).toBe(true);

      writeSpy.mockClear();
      await stream.push("test2");
      expect(writeSpy).not.toHaveBeenCalled();
    });

    it("marks writer as closed on pushComment write failure", async () => {
      const event = mockEvent("/");
      const stream = new EventStream(event);

      const writeSpy = vi.fn().mockRejectedValue(new Error("write failed"));
      (stream as any)._writer.write = writeSpy;
      (stream as any)._writerIsClosed = false;

      await stream.pushComment("test");
      expect((stream as any)._writerIsClosed).toBe(true);

      writeSpy.mockClear();
      await stream.pushComment("test2");
      expect(writeSpy).not.toHaveBeenCalled();
    });

    it("marks writer as closed on batch push write failure", async () => {
      const event = mockEvent("/");
      const stream = new EventStream(event);

      const writeSpy = vi.fn().mockRejectedValue(new Error("write failed"));
      (stream as any)._writer.write = writeSpy;
      (stream as any)._writerIsClosed = false;

      await stream.push([{ data: "msg1" }, { data: "msg2" }]);
      expect((stream as any)._writerIsClosed).toBe(true);

      writeSpy.mockClear();
      await stream.push([{ data: "msg3" }]);
      expect(writeSpy).not.toHaveBeenCalled();
    });

    it("flush does not drop data buffered while its write is in flight", async () => {
      const event = mockEvent("/");
      const stream = new EventStream(event);

      const writes: string[] = [];
      let resolveWrite!: () => void;
      (stream as any)._writer.write = vi.fn((chunk: Uint8Array) => {
        writes.push(new TextDecoder().decode(chunk));
        return new Promise<void>((r) => {
          resolveWrite = r;
        });
      });

      stream.pause();
      await stream.push("first");
      const resumed = stream.resume(); // flush starts write("first"), still pending
      stream.pause();
      await stream.push("second"); // buffered while the flush write is in flight
      resolveWrite();
      await resumed;

      const flushed = stream.flush();
      resolveWrite();
      await flushed;

      const sent = writes.join("");
      expect(sent).toContain("data: second");
      expect(sent.match(/data: first/g)).toHaveLength(1);
    });

    it("marks writer as closed on flush write failure", async () => {
      const event = mockEvent("/");
      const stream = new EventStream(event);

      // Pause and buffer data so flush has something to write
      stream.pause();
      await stream.push("buffered");

      const writeSpy = vi.fn().mockRejectedValue(new Error("write failed"));
      (stream as any)._writer.write = writeSpy;
      (stream as any)._writerIsClosed = false;

      await stream.flush();
      expect((stream as any)._writerIsClosed).toBe(true);

      // Subsequent writes should be skipped
      writeSpy.mockClear();
      await stream.push("after-flush");
      expect(writeSpy).not.toHaveBeenCalled();
    });
  });
});
