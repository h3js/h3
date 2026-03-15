import type { H3Event } from "../event.ts";

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
  let value = name;
  if (opts?.desc) {
    value += `;desc="${opts.desc}"`;
  }
  if (opts?.dur !== undefined) {
    value += `;dur=${opts.dur}`;
  }
  event.res.headers.append("server-timing", value);
  const ctx = event.context as Record<string, unknown>;
  ((ctx.timing as Record<string, unknown>[]) ||= []).push({ name, ...opts });
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
  const result = await fn();
  setServerTiming(event, name, { dur: performance.now() - start });
  return result;
}
