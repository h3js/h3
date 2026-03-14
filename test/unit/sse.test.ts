import { describe, it, expect, vi } from "vitest";
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

    it("marks writer as closed on push write failure (L89 _sendEvent)", async () => {
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

    it("marks writer as closed on pushComment write failure (L74)", async () => {
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

    it("marks writer as closed on batch push write failure (L110 _sendEvents)", async () => {
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
  });
});
