import { ReadableStream } from "node:stream/web";
import { vi } from "vitest";
import { HTTPError, iterable } from "../src/index.ts";
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
      const cases: [string, () => unknown][] = [
        ["Array", () => ["the-value"]],
        ["Set", () => new Set(["the-value"])],
        ["Map.keys()", () => new Map([["the-value", "unused"]]).keys()],
        ["Map.values()", () => new Map([["unused", "the-value"]]).values()],
        ["Iterator object", () => ({ next: () => ({ value: "the-value", done: true }) })],
        [
          "AsyncIterator object",
          () => ({
            next: () => Promise.resolve({ value: "the-value", done: true }),
          }),
        ],
        [
          "Generator (yield)",
          () =>
            (function* () {
              yield "the-value";
            })(),
        ],
        [
          "Generator (return)",
          () =>
            // eslint-disable-next-line require-yield
            (function* () {
              return "the-value" as unknown;
            })(),
        ],
        [
          "Generator (yield*)",
          () =>
            (function* () {
              yield* ["the-value"];
            })(),
        ],
        [
          "AsyncGenerator",
          () =>
            (async function* () {
              await Promise.resolve();
              yield "the-value";
            })(),
        ],
        [
          "ReadableStream (push-mode)",
          () =>
            new ReadableStream({
              start(controller) {
                controller.enqueue("the-value");
                controller.close();
              },
            }),
        ],
        [
          "ReadableStream (pull-mode)",
          () =>
            new ReadableStream({
              pull(controller) {
                controller.enqueue("the-value");
                controller.close();
              },
            }),
        ],
      ];

      for (const [type, makeIterable] of cases) {
        it(type, async () => {
          t.app.use(() => iterable(makeIterable() as any));
          const response = await t.fetch("/");
          expect(await response.text()).toBe("the-value");
        });
      }
    });

    describe("response status and headers", () => {
      it("keeps the status staged before the iterable is returned", async () => {
        t.app.use((event) => {
          event.res.status = 201;
          return iterable(["a"]);
        });
        const result = await t.fetch("/");
        expect(result.status).toBe(201);
        expect(await result.text()).toBe("a");
      });

      it("applies status and headers set while producing the first chunk", async () => {
        t.app.use((event) =>
          iterable(async function* () {
            await Promise.resolve();
            event.res.status = 201;
            event.res.headers.set("hello", "world");
            yield "a";
            yield "b";
          }),
        );
        const result = await t.fetch("/");
        expect(result.status).toBe(201);
        expect(result.headers.get("hello")).toBe("world");
        expect(await result.text()).toBe("ab");
      });

      it("ignores changes made after the first chunk", async () => {
        t.app.use((event) =>
          iterable(async function* () {
            yield "a";
            event.res.status = 201;
            yield "b";
          }),
        );
        const result = await t.fetch("/");
        expect(result.status).toBe(200);
        expect(await result.text()).toBe("ab");
      });

      it("renders an error response when the first chunk throws", async () => {
        t.app.use(() =>
          iterable(async function* () {
            throw new HTTPError({ status: 418, message: "nope" });
            // eslint-disable-next-line no-unreachable
            yield "a";
          }),
        );
        const result = await t.fetch("/");
        expect(result.status).toBe(418);
        expect((await result.json()).message).toBe("nope");
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
