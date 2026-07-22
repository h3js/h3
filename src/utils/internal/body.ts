import { HTTPError } from "../../error.ts";
import { EmptyObject } from "./obj.ts";
import { hasProp } from "./object.ts";

export function parseURLEncodedBody(body: string): unknown {
  return collectEntries(new URLSearchParams(body).entries());
}

export function parseFormData(form: FormData): unknown {
  return collectEntries(form.entries());
}

// Collect key/value entries into an object, keeping repeated keys as arrays
// (e.g. multi-selects or `foo=1&foo=2`) instead of dropping earlier values.
function collectEntries(entries: IterableIterator<[string, unknown]>): unknown {
  const parsed: Record<string, any> = new EmptyObject();
  for (const [key, value] of entries) {
    if (hasProp(parsed, key)) {
      if (!Array.isArray(parsed[key])) {
        parsed[key] = [parsed[key]];
      }
      parsed[key].push(value);
    } else {
      parsed[key] = value;
    }
  }
  return parsed as unknown;
}

/**
 * Wraps a request body stream so it enforces `limit` bytes as it is read.
 *
 * Pull-based (preserves backpressure, never reads ahead of the consumer): it
 * counts bytes as they flow and, the moment the running total exceeds `limit`,
 * aborts with a `413` {@link HTTPError} and cancels the upstream so the source
 * can stop producing. Consumers therefore only ever see an `HTTPError`, so body
 * readers that wrap failures (e.g. `readBody`, validated handlers, JSON-RPC)
 * can re-throw a pre-existing `HTTPError` instead of masking it.
 */
export function limitBody(
  body: ReadableStream<Uint8Array>,
  limit: number,
): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  let size = 0;
  return new ReadableStream({
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) {
        controller.close();
        return;
      }
      size += value.byteLength;
      if (size > limit) {
        const error = new HTTPError({
          status: 413,
          statusText: "Request Entity Too Large",
          message: `Request body size exceeds the limit of ${limit} bytes`,
        });
        reader.cancel(error).catch(() => {});
        controller.error(error);
        return;
      }
      controller.enqueue(value);
    },
    cancel: (reason) => reader.cancel(reason),
  });
}
