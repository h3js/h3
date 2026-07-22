import { z } from "zod/v4";
import {
  assertBodySize,
  bodyLimit,
  defineJsonRpcHandler,
  defineValidatedHandler,
  readBody,
} from "../src/index.ts";
import { describeMatrix } from "./_setup.ts";

describeMatrix("body limit", (t, { it, expect }) => {
  it("allows a body within the limit", async () => {
    t.app.post("/", async (event) => readBody(event), { middleware: [bodyLimit(1024)] });
    const res = await t.fetch("/", { method: "POST", body: JSON.stringify({ hello: "world" }) });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ hello: "world" });
  });

  it("rejects an oversized buffered body with 413", async () => {
    // With a real transport an honest `content-length` triggers the fail-fast
    // path; in-process it is caught as the body is read. Either way: 413.
    t.app.post("/", async (event) => readBody(event), { middleware: [bodyLimit(4)] });
    const res = await t.fetch("/", { method: "POST", body: "way over the limit" });
    expect(res.status).toBe(413);
  });

  it("rejects an oversized body read via readBody with 413", async () => {
    t.app.post("/", async (event) => readBody(event), { middleware: [bodyLimit(4)] });
    const res = await t.fetch("/", {
      method: "POST",
      body: streamOf(["chunk-one", "chunk-two", "chunk-three"]),
      // @ts-expect-error duplex is required for a streaming body
      duplex: "half",
    });
    expect(res.status).toBe(413);
  });

  it("maps an oversized body in a validated handler to 413 (not 400)", async () => {
    const handler = defineValidatedHandler({
      validate: { body: z.object({ value: z.string() }) },
      handler: async (event) => event.req.json(),
    });
    // The typed handler narrows the event; registering it on a base route is a
    // known variance gap, unrelated to what this test exercises.
    t.app.post("/validated", handler as unknown as () => unknown, {
      middleware: [bodyLimit(4)],
    });
    const res = await t.fetch("/validated", {
      method: "POST",
      body: streamOf(['{"value":"', "way more than four bytes", '"}']),
      // @ts-expect-error duplex is required for a streaming body
      duplex: "half",
    });
    expect(res.status).toBe(413);
  });

  it("maps an oversized body in a JSON-RPC handler to 413 (not a parse error)", async () => {
    t.app.post("/rpc", defineJsonRpcHandler({ methods: { echo: (params: unknown) => params } }), {
      middleware: [bodyLimit(4)],
    });
    const res = await t.fetch("/rpc", {
      method: "POST",
      body: streamOf(['{"jsonrpc":"2.0","id":1,', '"method":"echo","params":[1,2,3]}']),
      // @ts-expect-error duplex is required for a streaming body
      duplex: "half",
    });
    expect(res.status).toBe(413);
  });

  // Real (socket-backed) transport only: an in-process `FormData` body is a lazy
  // undici stream that throws an unhandled "already closed" error when the
  // multipart parse is aborted mid-flight — an artifact of the in-memory source,
  // not of real requests.
  it.skipIf(t.target === "web")("maps an oversized formData read to 413 (not 400)", async () => {
    t.app.post("/upload", async (event) => {
      assertBodySize(event, 4);
      const form = await event.req.formData();
      return Object.fromEntries(form.entries());
    });
    const form = new FormData();
    form.append("field", "a value that is definitely longer than four bytes");
    const res = await t.fetch("/upload", { method: "POST", body: form });
    expect(res.status).toBe(413);
  });

  it("does not count a chunked body the handler never reads", async () => {
    t.app.post("/ignore", async () => "ok", { middleware: [bodyLimit(4)] });
    // A streamed body has no `content-length`, so nothing is enforced up-front;
    // enforcement is tied to consumption and the handler never reads it.
    const res = await t.fetch("/ignore", {
      method: "POST",
      body: streamOf(["far larger", "than four bytes"]),
      // @ts-expect-error duplex is required for a streaming body
      duplex: "half",
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
  });
});

function streamOf(parts: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream<string>({
    start(controller) {
      for (const part of parts) controller.enqueue(part);
      controller.close();
    },
  }).pipeThrough(new TextEncoderStream());
}
