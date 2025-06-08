import type { ServerOptions, Server } from "srvx";
import type { H3 } from "../h3.ts";
import { serve as srvxServe } from "srvx/bun";

// Main exports
export * from "../index.ts";

/**
 * Serve the H3 app.
 */
export function serve(app: H3, options?: Omit<ServerOptions, "fetch">): Server {
  return srvxServe({ fetch: app._fetch, ...options });
}
