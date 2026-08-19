import { defineHandler } from "../handler.ts";
import { HTTPError } from "../error.ts";
import { HTTPResponse, toResponse } from "../response.ts";
import { handleCacheHeaders } from "../utils/cache.ts";
import type { H3Event } from "../event.ts";
import type { EventHandler } from "../types/handler.ts";
import type { ServerRequest } from "srvx";
import { createMemoryStorage, defineCachedHandler as ocacheDefineCachedHandler } from "ocache";
import type {
  CacheConditions as OcacheCacheConditions,
  CachedEventHandlerOptions,
  StorageInterface,
  StorageOption,
} from "ocache";
import { createCacheRuleHandler } from "./handlers/cache.ts";
import type { CacheRuleOptions, RuleHandler } from "./types.ts";

/**
 * Options for the ocache-backed {@link createOcacheRuleHandler}. All fields
 * are optional; the default uses ocache's in-memory storage out of the box.
 */
export interface OcacheRuleHandlerOptions {
  /**
   * ocache storage instance, or a factory resolved on first use. Shared by every
   * cache rule this handler serves. Defaults to one lazily created memory store.
   */
  storage?: StorageOption;
  /** Default ocache options. Rule options take precedence. */
  defaults?: CachedEventHandlerOptions;
  /** Stable cache-key scope. Set this when sharing persistent storage across processes. */
  id?: string;
}

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

// Matches the `origin` entry of a comma-separated `Vary` list.
const RE_VARY_ORIGIN = /(?:^|,)\s*origin\s*(?:,|$)/i;

/** Drop `origin` from a `Vary` list, returning `undefined` for an empty rest. */
function withoutVaryOrigin(vary: string): string | undefined {
  const rest = vary
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name && name.toLowerCase() !== "origin");
  return rest.length > 0 ? rest.join(", ") : undefined;
}

/**
 * Keep request-specific CORS and `Set-Cookie` headers out of shared entries
 * while preserving them on the cache-miss response.
 *
 * The `cors` rule's `Vary: Origin` goes with them: it declares the reflected
 * `Access-Control-Allow-Origin` this function just moved out, and the rule
 * (order -3, outside the cache) re-appends both on every request, hit or miss.
 * Left in place it would only make ocache refuse to store the entry at all —
 * an undeclared `Vary` name is not cacheable, and keying by origin instead
 * would give every origin its own copy of the same body.
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
  // Only the `cors` rule's own `Vary: Origin` is dropped — a handler that
  // declares one keeps it, and ocache then declines to store its response.
  const vary = event.context.routeRules?.cors ? res.headers.get("vary") : null;
  const dropVaryOrigin = vary !== null && RE_VARY_ORIGIN.test(vary);
  const varyRest = dropVaryOrigin ? withoutVaryOrigin(vary!) : undefined;
  if (moved.length === 0 && cookies.length === 0 && !dropVaryOrigin) {
    return res;
  }
  const strip = (headers: Headers): void => {
    for (const [name] of moved) {
      headers.delete(name);
    }
    if (cookies.length > 0) {
      headers.delete("set-cookie");
    }
    if (dropVaryOrigin) {
      if (varyRest === undefined) {
        headers.delete("vary");
      } else {
        headers.set("vary", varyRest);
      }
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
  if (dropVaryOrigin) {
    // `toResponse` above consumed the staged headers, so the miss response only
    // keeps what is staged again here — the full `Vary` the client should see.
    event.res.headers.set("vary", vary!);
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
  // ocache captures `if-none-match`/`if-modified-since` before narrowing the
  // request it forwards, so `event.req` no longer carries them on a miss —
  // `handleCacheHeaders` has to read them from here.
  conditions: OcacheCacheConditions,
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

// Default memory stores for `id`-scoped handlers. An explicit `id` declares two
// handler instances to be the same app — their cache keys already match, so the
// store has to match too for them to actually share entries, the way the
// process-global storage of earlier ocache releases made them.
const idStorages = /* @__PURE__ */ new Map<string, StorageInterface>();

function idStorage(id: string): StorageInterface {
  let storage = idStorages.get(id);
  if (!storage) {
    storage = createMemoryStorage();
    idStorages.set(id, storage);
  }
  return storage;
}

/**
 * Create an ocache-backed `cache` rule handler.
 *
 * Every rule this handler serves shares one storage instance: the supplied
 * `storage`, or a memory store shared by every handler with the same `id`.
 */
export function createOcacheRuleHandler(opts?: OcacheRuleHandlerOptions): RuleHandler<"cache"> {
  // ocache gives every cached handler a store of its own; one store per rule
  // handler keeps all of an app's routes in a single bounded cache instead.
  let memoryStorage: StorageInterface | undefined;
  const id = opts?.id;
  const storage: StorageOption =
    opts?.storage ??
    (id === undefined ? () => (memoryStorage ??= createMemoryStorage()) : () => idStorage(id));
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
          storage,
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
