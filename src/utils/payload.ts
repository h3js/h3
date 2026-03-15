import type { H3Event, HTTPEvent } from "../event.ts";
import { getQuery } from "./request.ts";
import { readBody } from "./body.ts";
import { getRouterParams } from "./request.ts";

const _payloadMethods = new Set(["PATCH", "POST", "PUT", "DELETE"]);

/**
 * Get the request payload by merging route params, query params, and body data.
 *
 * For `GET` and `HEAD` requests, returns query params merged with route params.
 * For `POST`, `PUT`, `PATCH`, and `DELETE` requests, returns parsed body merged with route params.
 *
 * Route params take lowest priority (body/query overrides them).
 *
 * @example
 * app.post("/users/:id", async (event) => {
 *   const payload = await getPayload(event);
 *   // { id: "123", name: "Alice" } — id from route, name from body
 * });
 *
 * @example
 * app.get("/search/:category", async (event) => {
 *   const payload = await getPayload(event);
 *   // { category: "books", q: "h3" } — category from route, q from query
 * });
 */
export async function getPayload<T = Record<string, unknown>>(
  event: H3Event | HTTPEvent,
  opts?: { decode?: boolean },
): Promise<T> {
  const params = getRouterParams(event, opts);
  if (_payloadMethods.has(event.req.method)) {
    const body = (await readBody(event)) || {};
    return { ...params, ...(typeof body === "object" ? body : { body }) } as T;
  }
  const query = getQuery(event);
  return { ...params, ...query } as T;
}
