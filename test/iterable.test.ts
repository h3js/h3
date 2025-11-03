import { ReadableStream } from "node:stream/web";
import { vi } from "vitest";
import { iterable } from "../src/index.ts";
import { describeMatrix } from "./_setup.ts";

describeMatrix("iterable", (t, { it, expect, describe }) => {
  describe("iterable", () => {
    it("sends empty body for an empty iterator", async () => {
      t.app.use(() => iterable([]));
      const result = await t.fetch("/");
      expect(result.headers.get("content-length")).toBe(null);
      expect(await result.text()).toBe("");
    });

    it("concatenates iterated values", async () => {
      t.app.use(() => iterable(["a", "b", "c"]));
      const result = await t.fetch("/");
      expect(await result.text()).toBe("abc");
    });

    describe("iterable support", () => {
      it.each([
        { type: "Array", iterable: ["the-value"] },
        { type: "Set", iterable: new Set(["the-value"]) },
        {
          type: "Map.keys()",
          iterable: new Map([["the-value", "unused"]]).keys(),
        },
        {
          type: "Map.values()",
          iterable: new Map([["unused", "the-value"]]).values(),
        },
        {
          type: "Iterator object",
          iterable: { next: () => ({ value: "the-value", done: true }) },
        },
        {
          type: "AsyncIterator object",
          iterable: {
            next: () => Promise.resolve({ value: "the-value", done: true }),
          },
        },
        {
          type: "Generator (yield)",
          iterable: (function* () {
            yield "the-value";
          })(),
        },
        {
          type: "Generator (return)",
          // eslint-disable-next-line require-yield
          iterable: (function* () {
            return "the-value";
          })(),
        },
        {
          type: "Generator (yield*)",
          iterable: (function* () {
            // prettier-ignore
            yield * ["the-value"];
          })(),
        },
        {
          type: "AsyncGenerator",
          iterable: (async function* () {
            await Promise.resolve();
            yield "the-value";
          })(),
        },
        {
          type: "ReadableStream (push-mode)",
          iterable: new ReadableStream({
            start(controller) {
              controller.enqueue("the-value");
              controller.close();
            },
          }),
        },
        {
          type: "ReadableStream (pull-mode)",
          iterable: new ReadableStream({
            pull(controller) {
              controller.enqueue("the-value");
              controller.close();
            },
          }),
        },
      ])("$type", async (c) => {
        t.app.use(() => iterable(c.iterable as any));
        const response = await t.fetch("/");
        expect(await response.text()).toBe("the-value");
      });
    });

    describe("serializer argument", () => {
      it("is called for every value", async () => {
        const testIterable = [1, "2", { field: 3 }, null];
        const textEncoder = new TextEncoder();
        const serializer = vi.fn(() => textEncoder.encode("x"));
        t.app.use(() => iterable(testIterable, { serializer }));
        const response = await t.fetch("/");
        expect(await response.text()).toBe("x".repeat(testIterable.length));
        expect(serializer).toBeCalledTimes(4);
        for (const [i, obj] of testIterable.entries()) {
          expect.soft(serializer).toHaveBeenNthCalledWith(i + 1, obj);
        }
      });
    });
  });
});
