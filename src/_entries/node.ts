import type { ServerOptions, Server } from "srvx";
import type { H3 } from "../h3.ts";
import type { NodeHandler } from "../adapters.ts";

import { serve as srvxServe, toNodeHandler as _toNodeHandler } from "srvx/node";

import { freezeApp } from "./_common.ts";

// Main exports
export * from "../index.ts";

/**
 * Serve the H3 app.
 */
export function serve(app: H3, options?: Omit<ServerOptions, "fetch">): Server {
  freezeApp(app);
  return srvxServe({ fetch: app.fetch, ...options });
}

/**
 * Convert H3 app instance to a NodeHandler with (IncomingMessage, ServerResponse) => void signature.
 */
export function toNodeHandler(app: H3): NodeHandler {
  return _toNodeHandler(app.fetch) as NodeHandler;
}
