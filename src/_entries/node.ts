import type { ServerOptions, Server } from "srvx";
import type { H3 } from "../h3.ts";
import type { H3Event } from "../event.ts";
import type { NodeHandler } from "../adapters.ts";
import type { ServeStaticOptions } from "../utils/static.ts";

import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { Readable } from "node:stream";
import { serve as srvxServe, toNodeHandler as _toNodeHandler } from "srvx/node";

import { serveStatic } from "../utils/static.ts";
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

export interface ServeStaticDirOptions extends Omit<
  ServeStaticOptions,
  "getMeta" | "getContents"
> {
  /**
   * Local directory path to serve static files from.
   */
  dir: string;

  /**
   * Optional URL path prefix to strip before resolving files inside `dir`.
   */
  base?: string;
}

/**
 * Serve static files from a local directory on Node.js.
 */
export function serveStaticDir(
  event: H3Event,
  options: ServeStaticDirOptions,
) {
  const rootDir = resolve(options.dir);
  const rootPrefix = rootDir.endsWith(sep) ? rootDir : `${rootDir}${sep}`;
  const normalizedBase = options.base
    ? (options.base.startsWith("/") ? options.base : `/${options.base}`).replace(
        /\/+$/,
        "",
      )
    : "";

  const resolveFilePath = (id: string): string | undefined => {
    let relativeId = id;
    if (normalizedBase) {
      if (id === normalizedBase) {
        relativeId = "/";
      } else if (id.startsWith(`${normalizedBase}/`)) {
        relativeId = id.slice(normalizedBase.length);
      } else {
        return undefined;
      }
    }

    if (relativeId.includes("\0")) {
      return undefined;
    }

    const filePath = resolve(rootDir, `.${relativeId}`);
    if (filePath !== rootDir && !filePath.startsWith(rootPrefix)) {
      return undefined;
    }
    return filePath;
  };

  return serveStatic(event, {
    ...options,
    getMeta: async (id) => {
      const filePath = resolveFilePath(id);
      if (!filePath) {
        return undefined;
      }
      const stats = await stat(filePath).catch(() => undefined);
      if (!stats?.isFile()) {
        return undefined;
      }
      return {
        size: stats.size,
        mtime: stats.mtimeMs,
      };
    },
    getContents: (id) => {
      const filePath = resolveFilePath(id);
      if (!filePath) {
        return undefined;
      }
      return Readable.toWeb(createReadStream(filePath)) as ReadableStream;
    },
  });
}
