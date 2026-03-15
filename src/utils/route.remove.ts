import { removeRoute as _removeRoute } from "rou3";
import type { H3 as H3Type, HTTPMethod } from "../types/h3.ts";

/**
 * Remove a route handler from the app.
 *
 * @example
 * ```ts
 * import { H3, removeRoute } from "h3";
 *
 * const app = new H3();
 * app.get("/temp", () => "hello");
 *
 * removeRoute(app, "GET", "/temp"); // route removed
 * ```
 */
export function removeRoute(
  app: H3Type,
  method: HTTPMethod | Lowercase<HTTPMethod> | "",
  route: string,
): void {
  const _method = (method || "").toUpperCase();
  route = new URL(route, "http://_").pathname;
  _removeRoute(app["~rou3"], _method, route);
  const idx = app["~routes"].findIndex(
    (r) => r.route === route && (!_method || r.method === _method),
  );
  if (idx !== -1) {
    app["~routes"].splice(idx, 1);
  }
}
