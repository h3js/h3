import { Readable as NodeReadable } from "node:stream";
import { describeMatrix } from "./_setup.ts";

describeMatrix(
  "stream",
  (ctx, { it, expect }) => {
    // --- Response stream: Node.js Readable ---

    it("node response stream: client abort propagates to source stream", async () => {
      const { promise: destroyed, resolve: onDestroyed } = Promise.withResolvers<boolean>();

      ctx.app.get("/stream", () => {
        return new NodeReadable({
          read() {
            this.push(Buffer.from("x".repeat(1024)));
          },
          destroy(err, cb) {
            onDestroyed(true);
            cb(err);
          },
        });
      });

      const controller = new AbortController();
      const res = await ctx.fetch("/stream", { signal: controller.signal });

      // Read a bit then abort
      const reader = res.body!.getReader();
      await reader.read();
      controller.abort();
      reader.cancel().catch(() => {});

      const wasDestroyed = await Promise.race([
        destroyed,
        new Promise<boolean>((r) => setTimeout(() => r(false), 500)),
      ]);

      expect(wasDestroyed).toBe(true);
    });

    it("node response stream: source error terminates response without crashing", async () => {
      let chunkCount = 0;

      ctx.app.get("/stream", () => {
        const stream = new NodeReadable({
          read() {
            chunkCount++;
            if (chunkCount <= 2) {
              this.push(Buffer.from("x".repeat(1024)));
            } else {
              process.nextTick(() => this.destroy(new Error("read error")));
            }
          },
        });
        // Attach error listener to prevent uncaught exception from crashing the test runner
        stream.on("error", () => {});
        return stream;
      });

      const res = await ctx.fetch("/stream");

      // The response should complete (possibly truncated) rather than hanging forever
      const result = await Promise.race([
        res.text().then(
          () => "completed",
          () => "errored",
        ),
        new Promise<string>((r) => setTimeout(() => r("hung"), 3000)),
      ]);

      // BUG: currently the response hangs because the stream error is not propagated
      // to close the HTTP response. Expected: "completed" or "errored", got: "hung"
      expect(result).not.toBe("hung");
    });

    // --- Response stream: Web ReadableStream ---

    it("web response stream: client abort propagates to cancel", async () => {
      const { promise: cancelled, resolve: onCancelled } = Promise.withResolvers<boolean>();

      ctx.app.get("/stream", () => {
        return new ReadableStream({
          pull(controller) {
            controller.enqueue(new TextEncoder().encode("x".repeat(1024)));
          },
          cancel() {
            onCancelled(true);
          },
        });
      });

      const controller = new AbortController();
      const res = await ctx.fetch("/stream", { signal: controller.signal });

      const reader = res.body!.getReader();
      await reader.read();
      controller.abort();
      reader.cancel().catch(() => {});

      const wasCancelled = await Promise.race([
        cancelled,
        new Promise<boolean>((r) => setTimeout(() => r(false), 500)),
      ]);

      expect(wasCancelled).toBe(true);
    });

    it("web response stream: source error terminates response gracefully", async () => {
      let chunkCount = 0;

      ctx.app.get("/stream", () => {
        return new ReadableStream({
          pull(controller) {
            chunkCount++;
            if (chunkCount <= 2) {
              controller.enqueue(new TextEncoder().encode("x".repeat(1024)));
            } else {
              controller.error(new Error("read error"));
            }
          },
        });
      });

      // The fetch should either get a truncated response or an error,
      // but should NOT crash the server process
      const result = await ctx
        .fetch("/stream")
        .then((res) => res.text())
        .then(
          () => "completed",
          () => "errored",
        );

      expect(["completed", "errored"]).toContain(result);
    });
  },
  { allowUnhandledErrors: true },
);
