import { HTTPError } from "../../error.ts";
import { EmptyObject } from "./obj.ts";
import { hasProp } from "./object.ts";

import type { ServerRequest } from "srvx";

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

// Body-consuming methods that must read through the limited stream instead of
// the request's own (unlimited) internal body.
const bodyReadMethods = /* @__PURE__ */ new Set([
  "text",
  "json",
  "formData",
  "arrayBuffer",
  "blob",
  "bytes",
] as const);

/**
 * Wraps a request so every body read is limited to `limit` bytes.
 *
 * A native `Request`'s consuming methods (`text`/`json`/`formData`/...) read its
 * internal body stream directly, not via the `.body` getter, so swapping `.body`
 * alone would not guard them. Instead of rebuilding the `Request` (which drops
 * srvx's runtime augmentation and must re-copy it prop-by-prop), this returns a
 * `Proxy` that routes every body read through a single {@link limitBody} stream
 * (lazily, via a `Response` for its parsers) and passes everything else — headers,
 * url, `runtime`, `waitUntil`, `ip`, `context`, ... — straight through to the
 * original request. Mirrors the proxy in `validatedRequest`.
 */
export function limitRequestBody(req: ServerRequest, limit: number): ServerRequest {
  if (!req.body) {
    return req;
  }
  // Lazily build one limited body; a body the handler never reads is never
  // wrapped (and never locks the original stream).
  let limited: Response | undefined;
  const limitedBody = () =>
    (limited ??= new Response(limitBody(req.body!, limit), { headers: req.headers }));
  return new Proxy(req, {
    get(target, prop: keyof ServerRequest) {
      if (prop === "body") {
        return limitedBody().body;
      }
      if (prop === "bodyUsed") {
        return (limited ?? target).bodyUsed;
      }
      if (bodyReadMethods.has(prop as any)) {
        return () => (limitedBody() as any)[prop]();
      }
      return Reflect.get(target, prop);
    },
  }) as ServerRequest;
}
