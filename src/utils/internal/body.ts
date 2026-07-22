import { limitBodyStream } from "srvx/body-limit";

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
 * Uses srvx's pull-based {@link limitBodyStream} for the counting (preserving
 * backpressure, no pre-buffering) but converts its `ERR_BODY_TOO_LARGE` abort
 * into a proper `413` {@link HTTPError}. This is the single place that knows the
 * srvx error shape: every consumer of the body only ever sees an `HTTPError`,
 * so body readers that wrap failures (e.g. `readBody`, validated handlers,
 * JSON-RPC) just re-throw a pre-existing `HTTPError` instead of masking it.
 */
export function limitBody(
  body: ReadableStream<Uint8Array>,
  limit: number,
): ReadableStream<Uint8Array> {
  const reader = limitBodyStream(body, limit).getReader();
  return new ReadableStream({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          controller.close();
        } else {
          controller.enqueue(value);
        }
      } catch (error) {
        controller.error(
          (error as { code?: string } | undefined)?.code === "ERR_BODY_TOO_LARGE"
            ? new HTTPError({
                status: 413,
                statusText: "Request Entity Too Large",
                message: `Request body size exceeds the limit of ${limit} bytes`,
              })
            : error,
        );
      }
    },
    cancel: (reason) => reader.cancel(reason),
  });
}
