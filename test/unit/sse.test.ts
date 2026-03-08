import { describe, it, expect } from "vitest";
import {
  formatEventStreamComment,
  formatEventStreamMessage,
  formatEventStreamMessages,
} from "../../src/utils/internal/event-stream.ts";

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
});
