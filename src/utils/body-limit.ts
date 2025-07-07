import type { H3Event } from "../event.ts";
import type { H3Plugin } from "../types/h3.ts";
import { HTTPError } from "../error.ts";
import { defineMiddleware } from "../middleware.ts";

export interface BodySizeLimitOptions {
  /**
   * Maximum allowed body size in bytes
   */
  maxSize: number;
  /**
   * Routes to apply the limit to (optional)
   * If not specified, applies to all routes
   */
  routes?: Array<string | RegExp>;
  /**
   * Routes to exclude from the limit (optional)
   */
  exclude?: Array<string | RegExp>;
}

/**
 * Define a plugin that limits request body size
 *
 * @example
 * ```js
 * import { defineBodySizeLimitPlugin } from "h3";
 *
 * const bodySizeLimit = defineBodySizeLimitPlugin({
 *   maxSize: 1024 * 1024, // 1MB
 *   routes: ["/api/upload", /^\/api\/files/],
 *   exclude: ["/api/large-upload"]
 * });
 *
 * app.register(bodySizeLimit);
 * ```
 */
export function defineBodySizeLimitPlugin(
  options: BodySizeLimitOptions,
): H3Plugin {
  return (h3) => {
    h3.use(
      defineMiddleware(async (event: H3Event) => {
        const url = event.req.url;
        const path = url ? new URL(url, "http://localhost").pathname : "/";

        // Check if route should be excluded
        if (options.exclude) {
          for (const pattern of options.exclude) {
            if (typeof pattern === "string" && path === pattern) return;
            if (pattern instanceof RegExp && pattern.test(path)) return;
          }
        }

        // Check if route matches (if routes specified)
        if (options.routes) {
          let matches = false;
          for (const pattern of options.routes) {
            if (typeof pattern === "string" && path === pattern) {
              matches = true;
              break;
            }
            if (pattern instanceof RegExp && pattern.test(path)) {
              matches = true;
              break;
            }
          }
          if (!matches) return;
        }

        // Check Content-Length header first
        const contentLength = event.req.headers.get("content-length");
        if (contentLength) {
          const size = Number.parseInt(contentLength, 10);
          if (!Number.isNaN(size) && size > options.maxSize) {
            throw new HTTPError({
              status: 413,
              statusText: "Payload Too Large",
              message: `Request body size ${size} exceeds the limit of ${options.maxSize} bytes`,
            });
          }
        }
      }),
    );
  };
}
