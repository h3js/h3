import { beforeEach } from "vitest";
import { createEventStream } from "../src/index.ts";

import { describeMatrix } from "./_setup.ts";

describeMatrix("sse", (t, { it, expect }) => {
  beforeEach(() => {
    t.app.get("/sse", (event) => {
      const includeMeta = event.url.searchParams.get("includeMeta") === "true";
      const sendComment = event.url.searchParams.get("sendComment") === "true";
      const eventStream = createEventStream(event);
      let counter = 0;
      const clear = setInterval(() => {
        if (counter++ === 3) {
          clearInterval(clear);
          eventStream.close();
          return;
        }
        if (sendComment) {
          eventStream.pushComment("hello world");
        } else if (includeMeta) {
          eventStream.push({
            id: String(counter),
            event: "custom-event",
            data: "hello world",
          });
        } else {
          eventStream.push("hello world");
        }
      });
      return eventStream.send();
    });
  });

  it("streams events", async () => {
    const res = await t.fetch("/sse");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/event-stream");
    const messages = (await res.text()).split("\n\n").filter(Boolean);
    expect(messages.length).toBe(3);
  });

  it("streams events", async () => {
    const res = await t.fetch("/sse?includeMeta=true");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/event-stream");
    const messages = (await res.text()).split("\n\n").filter(Boolean);
    expect(messages.length).toBe(3);
  });

  it("streams comment events", async () => {
    const res = await t.fetch("/sse?sendComment=true");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/event-stream");
    const messages = (await res.text()).split("\n\n").filter(Boolean);
    expect(messages.length).toBe(3);
    const expected = Array.from({ length: 3 }).fill(": hello world");
    expect(messages).toEqual(expected);
  });

  it("ignores pushes after close", async () => {
    t.app.get("/sse-after-close", async (event) => {
      const eventStream = createEventStream(event);
      setTimeout(async () => {
        await eventStream.push("before close");
        await eventStream.close();
        await eventStream.push("after close");
        await eventStream.pushComment("after close");
      });
      return eventStream.send();
    });

    const res = await t.fetch("/sse-after-close");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("data: before close\n\n");
  });

  it("runs onClosed cleanup when the client disconnects", async () => {
    let cleanedUp = false;
    let ticksAtDisconnect = 0;
    let ticks = 0;

    t.app.get("/sse-disconnect", (event) => {
      const eventStream = createEventStream(event);
      const timer = setInterval(() => {
        ticks++;
        eventStream.push("tick");
      }, 5);
      // The cleanup idiom documented on `createEventStream`.
      eventStream.onClosed(() => {
        cleanedUp = true;
        clearInterval(timer);
      });
      return eventStream.send();
    });

    const ctrl = new AbortController();
    const res = await t.fetch("/sse-disconnect", { signal: ctrl.signal });
    // Read one chunk, then hang up mid-stream.
    const reader = res.body!.getReader();
    await reader.read();
    await reader.cancel();
    ctrl.abort();

    await new Promise((r) => setTimeout(r, 50));
    expect(cleanedUp).toBe(true);

    // The interval must be stopped, not merely have its writes dropped.
    ticksAtDisconnect = ticks;
    await new Promise((r) => setTimeout(r, 50));
    expect(ticks).toBe(ticksAtDisconnect);
  });
});
