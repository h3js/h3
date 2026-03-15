import type { H3Event } from "../event.ts";
import type { H3EventContext } from "../types/context.ts";

/**
 * Append a `Server-Timing` entry to the response.
 *
 * Multiple calls append to the same header (comma-separated per spec).
 *
 * @see https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Server-Timing
 *
 * @example
 * app.get("/", (event) => {
 *   setServerTiming(event, "db", { dur: 53, desc: "Database query" });
 *   return { data: "..." };
 * });
 * // Response header: Server-Timing: db;desc="Database query";dur=53
 */
export function setServerTiming(
  event: H3Event,
  name: string,
  opts?: { dur?: number; desc?: string },
): void {
  if (!_isValidToken(name)) {
    throw new TypeError(`Invalid Server-Timing metric name: ${name}`);
  }
  if (opts?.dur !== undefined && (!Number.isFinite(opts.dur) || opts.dur < 0)) {
    throw new TypeError(`Invalid Server-Timing duration: ${opts.dur}`);
  }
  const value =
    name +
    (opts?.desc ? `;desc="${_escapeDesc(opts.desc)}"` : "") +
    (opts?.dur !== undefined ? `;dur=${opts.dur}` : "");
  event.res.headers.append("server-timing", value);
  const ctx = event.context as H3EventContext;
  if (!Array.isArray(ctx.timing)) {
    ctx.timing = [];
  }
  ctx.timing.push({ name, ...opts });
}

/**
 * Measure an async operation and append the timing to the `Server-Timing` header.
 *
 * Uses `performance.now()` for high-resolution timing.
 *
 * @see https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Server-Timing
 *
 * @example
 * app.get("/", async (event) => {
 *   const users = await withServerTiming(event, "db", () => fetchUsers());
 *   return users;
 * });
 * // Response header: Server-Timing: db;dur=42.5
 */
export async function withServerTiming<T>(
  event: H3Event,
  name: string,
  fn: () => T | Promise<T>,
): Promise<T> {
  const start = performance.now();
  try {
    return await fn();
  } finally {
    setServerTiming(event, name, { dur: performance.now() - start });
  }
}

// RFC 7230 token: !#$%&'*+-.^_`|~ DIGIT ALPHA
const _tokenRE = /^[\w!#$%&'*+.^`|~-]+$/;

function _isValidToken(value: string): boolean {
  return _tokenRE.test(value);
}

function _escapeDesc(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}
