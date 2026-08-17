import { defineHandler } from "../handler.ts";
import { HTTPError } from "../error.ts";
import { HTTPResponse, toResponse } from "../response.ts";
import { handleCacheHeaders } from "../utils/cache.ts";
import type { H3Event } from "../event.ts";
import type { EventHandler } from "../types/handler.ts";
import type { ServerRequest } from "srvx";
import { defineCachedHandler as ocacheDefineCachedHandler, setStorage } from "ocache";
import type { CachedEventHandlerOptions, StorageInterface } from "ocache";
import { createCacheRuleHandler } from "./handlers/cache.ts";
import type { CacheRuleOptions, RuleHandler } from "./types.ts";

/**
 * Options for the ocache-backed {@link createOcacheRuleHandler}. All fields
 * are optional; the default uses ocache's in-memory storage out of the box.
 */
export interface OcacheRuleHandlerOptions {
  /** ocache storage implementation. Applied via its process-global `setStorage`. */
  storage?: StorageInterface;
  /** Default ocache options. Rule options take precedence. */
  defaults?: CachedEventHandlerOptions;
  /** Stable cache-key scope. Set this when sharing persistent storage across processes. */
  id?: string;
}

let installedStorage: StorageInterface | undefined;

// Reflected CORS headers are request-specific and must not enter a shared cache.
const VOLATILE_CORS_HEADERS = [
  "access-control-allow-origin",
  "access-control-allow-credentials",
] as const;

/** `Set-Cookie` values of a response, one per cookie. */
function getSetCookies(headers: Headers): string[] {
  // Some runtimes do not implement the newer `getSetCookie` API.
  if (typeof headers.getSetCookie === "function") {
    return headers.getSetCookie();
  }
  const value = headers.get("set-cookie");
  return value === null ? [] : [value];
}

/**
 * Keep request-specific CORS and `Set-Cookie` headers out of shared entries
 * while preserving them on the cache-miss response.
 */
function moveVolatileHeaders(res: Response, event: H3Event): Response {
  if (event.req.method !== "GET" && event.req.method !== "HEAD") {
    return res;
  }
  const moved: [name: string, value: string][] = [];
  for (const name of VOLATILE_CORS_HEADERS) {
    const value = res.headers.get(name);
    if (value !== null) {
      moved.push([name, value]);
    }
  }
  const cookies = getSetCookies(res.headers);
  if (moved.length === 0 && cookies.length === 0) {
    return res;
  }
  const strip = (headers: Headers): void => {
    for (const [name] of moved) {
      headers.delete(name);
    }
    if (cookies.length > 0) {
      headers.delete("set-cookie");
    }
  };
  try {
    strip(res.headers);
  } catch {
    // Rebuild responses whose headers are immutable.
    res = new Response(res.body, res);
    strip(res.headers);
  }
  for (const [name, value] of moved) {
    event.res.headers.set(name, value);
  }
  for (const cookie of cookies) {
    event.res.headers.append("set-cookie", cookie);
  }
  return res;
}

// Never dispatch credentials under a cache key that does not vary by them.
const CREDENTIAL_HEADERS = ["authorization", "proxy-authorization"] as const;

type HeaderValues = (string | null)[];

/** Set request headers, replacing the request when its headers are immutable. */
function setRequestHeaders(
  event: H3Event,
  names: readonly string[],
  values: HeaderValues,
): boolean {
  const apply = (headers: Headers): void => {
    for (let i = 0; i < names.length; i++) {
      const value = values[i];
      if (value == null) {
        headers.delete(names[i]!);
      } else {
        headers.set(names[i]!, value);
      }
    }
  };
  const applied = (headers: Headers): boolean =>
    names.every((name, i) => headers.get(name) === (values[i] ?? null));

  try {
    if (applied(event.req.headers)) {
      return true;
    }
    apply(event.req.headers);
    if (applied(event.req.headers)) {
      return true;
    }
  } catch {}
  try {
    const original = event.req;
    const headers = new Headers(original.headers);
    apply(headers);
    const req = new Request(original.url, { method: original.method, headers }) as ServerRequest;
    req.context = original.context;
    if (original.runtime) {
      req.runtime = original.runtime;
    }
    (event as { req: ServerRequest }).req = req;
  } catch {
    return false;
  }
  // Fetch header guards may silently reject names such as `Proxy-Authorization`.
  return applied(event.req.headers);
}

const savedHeaders = /* @__PURE__ */ new WeakMap<H3Event, HeaderValues>();

const servedCacheControl = /* @__PURE__ */ new WeakMap<H3Event, string>();

const RE_PRIVATE = /(?:^|,)\s*(?:private|no-store)(?:\s*=|\s*,|\s*$)/i;

/** Preserve `private`/`no-store` and explicit opt-out from cache-control synthesis. */
function withPreservedCacheControl(
  event: H3Event,
  conditions: { modifiedTime?: Date; maxAge?: number; etag?: string },
  sendCacheControl: boolean,
): boolean {
  const existing = servedCacheControl.get(event) ?? event.res.headers.get("cache-control");
  const preserve = !sendCacheControl || (existing !== null && RE_PRIVATE.test(existing));
  const matched = handleCacheHeaders(event, conditions);
  if (preserve) {
    if (existing) {
      event.res.headers.set("cache-control", existing);
    } else {
      event.res.headers.delete("cache-control");
    }
  }
  return matched;
}

/**
 * Strip unkeyed credentials and restore headers included in the cache key.
 * Failing to strip is fatal because dispatch would poison a shared entry.
 */
function withRequestHeaderFilter(
  handler: EventHandler,
  strip: readonly string[],
  restore: readonly string[],
): EventHandler {
  const names = [...strip, ...restore];
  const stripped: HeaderValues = strip.map(() => null);
  return (event) => {
    if (names.length > 0 && (event.req.method === "GET" || event.req.method === "HEAD")) {
      const saved = savedHeaders.get(event);
      const values = saved ? [...stripped, ...saved] : [...stripped, ...restore.map(() => null)];
      if (!setRequestHeaders(event, names, values)) {
        for (const name of strip) {
          if (event.req.headers.get(name) !== null) {
            throw new HTTPError({
              status: 500,
              message:
                "Cache rule could not strip the credential headers from the request before a cached dispatch.",
            });
          }
        }
      }
    }
    return handler(event);
  };
}

/** Mirror ocache's varying-header calculation; never restore a narrowed cookie header. */
function variableHeaderNames(opts: CacheRuleOptions, allowCredentials: boolean): string[] {
  const allowsCookies = (opts.allowCookies ?? []).some((name) => name?.trim());
  const varies = allowCredentials
    ? [...(opts.varies ?? []), ...CREDENTIAL_HEADERS]
    : (opts.varies ?? []);
  return [...new Set(varies.filter(Boolean).map((name) => name.toLowerCase()))].filter(
    (name) => !(allowsCookies && name === "cookie"),
  );
}

/**
 * Create an ocache-backed `cache` rule handler.
 *
 * ocache storage is process-global: the last supplied `storage` affects every
 * ocache consumer. Conflicting overrides emit a warning.
 */
export function createOcacheRuleHandler(opts?: OcacheRuleHandlerOptions): RuleHandler<"cache"> {
  if (opts?.storage) {
    if (installedStorage && installedStorage !== opts.storage) {
      console.warn(
        "[h3] [rules] `createOcacheRuleHandler({ storage })` replaces ocache's process-global storage, which another cache rule handler already set. ocache has no per-handler storage; the last call wins for every consumer in this process.",
      );
    }
    installedStorage = opts.storage;
    setStorage(opts.storage);
  }
  return createCacheRuleHandler({
    defineCachedHandler: (handler, cachedOpts) => {
      const allowCredentials = cachedOpts.allowAuthorization === true;
      const strip: readonly string[] = allowCredentials ? [] : CREDENTIAL_HEADERS;
      const restore = variableHeaderNames(cachedOpts, allowCredentials).filter(
        // `varies` keys credentials but does not authorize forwarding them.
        (name) => !strip.includes(name),
      );
      const ocacheHandler = ocacheDefineCachedHandler(
        cachedOpts.headersOnly ? handler : withRequestHeaderFilter(handler, strip, restore),
        {
          toResponse: async (value, event) => {
            const res = moveVolatileHeaders(
              await toResponse(value, event as H3Event),
              event as H3Event,
            );
            const cacheControl = res.headers.get("cache-control");
            if (cacheControl) {
              servedCacheControl.set(event as H3Event, cacheControl);
            }
            return res;
          },
          handleCacheHeaders: (event, conditions) =>
            withPreservedCacheControl(
              event as H3Event,
              conditions,
              cachedOpts.sendCacheControl !== false,
            ),
          ...cachedOpts,
          ...(allowCredentials && {
            varies: [...(cachedOpts.varies ?? []), ...CREDENTIAL_HEADERS],
          }),
        },
      );
      return defineHandler(async (event) => {
        if (restore.length > 0) {
          savedHeaders.set(
            event,
            restore.map((name) => event.req.headers.get(name)),
          );
        }
        const res = await ocacheHandler(event);
        // Rebuild through h3 so final response headers reach 304s (RFC 9110 §15.4.5).
        if (res instanceof Response && res.status === 304) {
          return new HTTPResponse(null, { status: 304, headers: res.headers });
        }
        return res;
      });
    },
    defaults: opts?.defaults,
    id: opts?.id,
  });
}

/** Shared default handler imported by compiled matchers and registered explicitly at runtime. */
export const cache: RuleHandler<"cache"> = /* @__PURE__ */ createOcacheRuleHandler();
