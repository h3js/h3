import type { ServerOptions, Server } from "srvx";
import type { H3 } from "../h3.ts";
import { serve as srvxServe } from "srvx/cloudflare";
import { freezeApp } from "./_common.ts";

// Main exports
export * from "../index.ts";

/**
 * Serve the H3 app.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function serve(app: H3, options?: Omit<ServerOptions, "fetch">): Server<any> {
  freezeApp(app);
  return srvxServe({ fetch: app.fetch, ...options });
}
