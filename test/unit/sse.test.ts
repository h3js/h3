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
});
