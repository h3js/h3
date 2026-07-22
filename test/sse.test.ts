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

  it("calls onClosed when the client disconnects", async () => {
    let closed = false;
    const onClosed = new Promise<void>((resolve) => {
      t.app.get("/sse-disconnect", (event) => {
        const eventStream = createEventStream(event);
        const interval = setInterval(() => eventStream.push("tick"), 5);
        eventStream.onClosed(() => {
          closed = true;
          clearInterval(interval);
          resolve();
        });
        return eventStream.send();
      });
    });

    const res = await t.fetch("/sse-disconnect");
    const reader = res.body!.getReader();
    await reader.read();
    expect(closed).toBe(false);
    await reader.cancel();

    await Promise.race([
      onClosed,
      new Promise((_, reject) => setTimeout(() => reject(new Error("onClosed never fired")), 2000)),
    ]);
    expect(closed).toBe(true);
  });

  it("does not leak rejections from async onClosed callbacks", async () => {
    let secondRan = false;
    const done = new Promise<void>((resolve) => {
      t.app.get("/sse-throwing-onClosed", (event) => {
        const eventStream = createEventStream(event);
        eventStream.onClosed(async () => {
          throw new Error("cleanup failed");
        });
        eventStream.onClosed(() => {
          secondRan = true;
          resolve();
        });
        setTimeout(() => eventStream.close());
        return eventStream.send();
      });
    });

    const res = await t.fetch("/sse-throwing-onClosed");
    await res.text();
    await done;
    // A rejected async callback must not take down the process,
    // nor prevent later callbacks from running.
    expect(secondRan).toBe(true);
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

  it("flushes data buffered while paused on close", async () => {
    t.app.get("/sse-paused-close", (event) => {
      const eventStream = createEventStream(event);
      setTimeout(async () => {
        await eventStream.push("sent");
        eventStream.pause();
        await eventStream.push("buffered");
        // Closing while paused must not drop the queued message.
        await eventStream.close();
      });
      return eventStream.send();
    });

    const res = await t.fetch("/sse-paused-close");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("data: sent\n\ndata: buffered\n\n");
  });

  it("closes a stream that is created but never sent", async () => {
    let closed = false;
    t.app.get("/sse-unsent", (event) => {
      const eventStream = createEventStream(event);
      eventStream.onClosed(() => {
        closed = true;
      });
      return "regular response";
    });
    const res = await t.fetch("/sse-unsent");
    expect(await res.text()).toBe("regular response");
    await waitFor(() => closed);
  });

  it("autocloses the stream on client disconnect", async () => {
    let stream: ReturnType<typeof createEventStream>;
    t.app.get("/sse-autoclose-disconnect", (event) => {
      stream = createEventStream(event);
      stream.push("hello");
      return stream.send();
    });
    const res = await t.fetch("/sse-autoclose-disconnect");
    const reader = res.body!.getReader();
    await reader.read();
    await reader.cancel();
    await waitFor(() => (stream as any)._disposed === true);
  });
});

async function waitFor(condition: () => boolean, timeout = 1000): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeout) {
      throw new Error("waitFor: condition not met in time");
    }
    await new Promise((r) => setTimeout(r, 5));
  }
}
