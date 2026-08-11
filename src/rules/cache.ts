// `h3/rules/cache` — the ocache-backed `cache` rule handler. This is the only
// rules module that imports ocache (an **optional** peer dependency):
// rule sets using `cache`/`swr` register a handler from here, everything else
// never pulls ocache into the bundle. Consumers with their own caching
// conventions skip this module entirely and inject a `defineCachedHandler`
// into the core `createCacheRuleHandler` (`h3/rules`) instead.

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
import type { RuleHandler } from "./types.ts";

/**
 * Options for the ocache-backed {@link createOcacheRuleHandler}. All fields
 * are optional; the default uses ocache's in-memory storage out of the box.
 */
export interface OcacheRuleHandlerOptions {
  /** ocache storage implementation (minimal `get`/`set`). Applied via `setStorage`. */
  storage?: StorageInterface;
  /**
   * Default ocache options merged into every cache rule (rule options win).
   * Fully typed against ocache — implementation hooks (`getKey`, `shouldCache`,
   * `getMaxAge`, …) that the declarative rule schema excludes go here.
   */
  defaults?: CachedEventHandlerOptions;
  /**
   * Stable cache-key scope for this handler instance. Unset (the default),
   * every wrapped route gets a process-unique scope so no two apps or matchers
   * can share a cache entry. Set it — to a value that identifies *this app* —
   * when a persistent storage backend must be shared across processes.
   * Forwarded to `createCacheRuleHandler`'s `id` option, documented there.
   */
  id?: string;
}

// Last storage handed to ocache's process-global slot, to detect (and report)
// a second handler instance silently replacing another's backend.
let installedStorage: StorageInterface | undefined;

// Per-request CORS response headers, reflected from the request `Origin` by
// the `cors` rule (h3's `appendCorsHeaders`, order -3 — it runs before the
// cache handler, so they end up on the response the resolver serializes).
// Baking them into a shared cache entry serves one requester's
// `access-control-allow-origin` to every other origin — violating the
// response's own `vary: origin` (RFC 9111 §4.1) and, with credentials,
// enabling a cross-origin leak. `vary` itself stays in the entry: it is
// correct metadata for the final response either way.
const VOLATILE_CORS_HEADERS = [
  "access-control-allow-origin",
  "access-control-allow-credentials",
] as const;

/**
 * Move volatile CORS headers off the response that is about to be serialized
 * into the shared cache, back onto the live `event.res.headers`.
 *
 * The move (not just a strip) matters: h3's inner `toResponse` above already
 * *consumed* `event.res` (cors's appended headers included) into this
 * response, so the current — cache-miss — request would otherwise lose its
 * own correct CORS headers. Re-set on a fresh `event.res`, h3's outer
 * `prepareResponse` merges them into the 2xx response at send time. Cache
 * *hits* need nothing here: the `cors` rule runs on every request and appends
 * fresh, request-correct headers that `prepareResponse` merges the same way.
 */
function moveVolatileCorsHeaders(res: Response, event: H3Event): Response {
  // Only GET/HEAD responses can ever be serialized into the cache — leave the
  // (never-cached) method-bypass path untouched.
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
  if (moved.length === 0) {
    return res;
  }
  try {
    for (const [name] of moved) {
      res.headers.delete(name);
    }
  } catch {
    // Immutable headers (e.g. a handler-returned `fetch` Response) — rebuild.
    res = new Response(res.body, res);
    for (const [name] of moved) {
      res.headers.delete(name);
    }
  }
  for (const [name, value] of moved) {
    event.res.headers.set(name, value);
  }
  return res;
}

// Credential request headers the cache handler keeps away from a cached
// dispatch, mirroring what ocache already does for `Cookie`. ocache's
// auto-generated key composes the path, the `varies` headers and the allowed
// cookies — never these — while its request filter forwards them untouched: a
// handler rendering per-user content from a bearer token would have that
// response cached under an anonymous key, served to everyone, and advertised to
// shared caches as `public, s-maxage=N`. Cookie-authenticated handlers already
// fail safe this way; these close the asymmetry.
// `proxy-authorization` is included because it is a credential by the same
// definition (RFC 9110 §11.6.3), even though it is hop-by-hop and should not
// reach an origin handler in the first place.
const CREDENTIAL_HEADERS = ["authorization", "proxy-authorization"] as const;

type CredentialValues = (string | null)[];

/**
 * Set (or, for `null`, remove) the credential headers on the request the cached
 * handler is about to see.
 *
 * Rewrites `event.req.headers` in place when the runtime allows it — that keeps
 * srvx's request extras (`runtime`, `ip`, `waitUntil`, …) intact — and falls
 * back to replacing `event.req` with an equivalent `Request` when the headers
 * are immutable, the same escape hatch ocache uses for its own filtering.
 *
 * @returns whether the request the handler will see now carries exactly
 * `values`. `false` means neither route worked, so the caller must decide —
 * for a *strip* there is nothing safe left to do but fail the request.
 */
function setCredentialHeaders(event: H3Event, values: CredentialValues): boolean {
  const apply = (headers: Headers): void => {
    for (let i = 0; i < CREDENTIAL_HEADERS.length; i++) {
      const value = values[i];
      if (value == null) {
        headers.delete(CREDENTIAL_HEADERS[i]!);
      } else {
        headers.set(CREDENTIAL_HEADERS[i]!, value);
      }
    }
  };
  const applied = (headers: Headers): boolean =>
    CREDENTIAL_HEADERS.every((name, i) => headers.get(name) === (values[i] ?? null));

  try {
    if (applied(event.req.headers)) {
      return true;
    }
    apply(event.req.headers);
    if (applied(event.req.headers)) {
      return true;
    }
  } catch {
    // Immutable headers — fall through to a replacement request.
  }
  try {
    const original = event.req;
    const headers = new Headers(original.headers);
    apply(headers);
    // GET/HEAD only (the caller guards): no body to carry over.
    const req = new Request(original.url, { method: original.method, headers }) as ServerRequest;
    req.context = original.context;
    if (original.runtime) {
      req.runtime = original.runtime;
    }
    (event as { req: ServerRequest }).req = req;
  } catch {
    return false;
  }
  // A runtime may drop or refuse header names while filling the new request
  // (e.g. the `Proxy-` prefix is a forbidden header name under a fetch-spec
  // header guard), so confirm rather than assume.
  return applied(event.req.headers);
}

const savedCredentials = /* @__PURE__ */ new WeakMap<H3Event, CredentialValues>();

// `Cache-Control` of the response the handler produced for this event, captured
// on the way into the cache. See `withPreservedCacheControl`.
const servedCacheControl = /* @__PURE__ */ new WeakMap<H3Event, string>();

// Matches a whole `private` / `no-store` directive in a Cache-Control header
// (mirrors both h3's own `RE_PRIVATE` and ocache's `_forbidsSharedCaching`,
// neither of which is exported).
const RE_PRIVATE = /(?:^|,)\s*(?:private|no-store)(?:\s*=|\s*,|\s*$)/i;

/**
 * Wrap h3's {@link handleCacheHeaders} so it can no longer *widen* a response's
 * caching.
 *
 * ocache calls this hook on every request through a cache rule with only
 * `{ modifiedTime, etag, maxAge }` — never `cacheControls` — so h3's function
 * always computes from an empty directive list, its `private`/`no-store` guard
 * inspects nothing, and its final unconditional
 * `event.res.headers.set("cache-control", …)` overwrites whatever the handler
 * declared: a `private, no-store` dashboard went out as
 * `public, max-age=N, s-maxage=N`, i.e. cacheable by every shared cache in
 * front of the app. (ocache itself refuses to *store* such a response — the
 * contradiction was only ever on the wire.)
 *
 * So: put the response's own header back verbatim whenever it forbids shared
 * caching — or whenever the rule opted out of `Cache-Control` synthesis
 * altogether (`sendCacheControl: false`, ocache's "server-side caching only"
 * switch, which the hook overrode just the same). `etag` / `last-modified` /
 * the 304 decision are untouched in every case, and a response that declares
 * nothing still gets h3's synthesized directives.
 */
function withPreservedCacheControl(
  event: H3Event,
  conditions: { modifiedTime?: Date; maxAge?: number; etag?: string },
  sendCacheControl: boolean,
): boolean {
  // On a miss the response is already built (and `event.res` consumed by
  // `toResponse`), so the captured value is the authoritative one; on the
  // `headersOnly` path nothing is captured and `event.res` is all there is.
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
 * Wrap the dispatched route handler so the request it sees carries exactly the
 * credentials the rule allows.
 *
 * - default: `authorization`/`proxy-authorization` are removed, so the handler
 *   cannot render user-specific output into a shared entry.
 * - `allowAuthorization`: the values captured before ocache's filter ran are put
 *   back. They are in `varies` (see below), so they are part of the cache key
 *   and of the response's `Vary` — one entry per credential, not one shared one.
 *
 * Only cacheable methods are touched, matching ocache: a bypassed request
 * (`POST`, …) is never cached and reaches the handler untouched.
 *
 * A *strip* that cannot be carried out fails the request with a 500. It is the
 * one case where we know the credential is still on the request the handler is
 * about to answer — and that answer is stored under a credential-free key, so
 * dispatching would poison the entry for the whole TTL and hand the response to
 * every later caller. Neither alternative is acceptable: a log line in a server
 * process is very likely to go unread, and quietly bypassing the cache would
 * turn an exotic-runtime quirk into a permanent, invisible cache miss.
 * A failed *restore* (`allowAuthorization`) is not an error: the handler merely
 * sees no credential, and the entry is keyed per credential either way.
 */
function withCredentialFilter(handler: EventHandler, allow: boolean): EventHandler {
  const stripped: CredentialValues = CREDENTIAL_HEADERS.map(() => null);
  return (event) => {
    if (event.req.method === "GET" || event.req.method === "HEAD") {
      const values = allow ? (savedCredentials.get(event) ?? stripped) : stripped;
      if (!setCredentialHeaders(event, values) && !allow) {
        throw new HTTPError({
          status: 500,
          message:
            "Cache rule could not strip the credential headers from the request before a cached dispatch.",
        });
      }
    }
    return handler(event);
  };
}

/**
 * Create an ocache-backed `cache` rule handler: ocache wired with h3's
 * `toResponse` / `handleCacheHeaders` so h3 handler return values (objects,
 * streams, …) serialize with full fidelity. No srvx / unstorage dependency —
 * global `Response` and ocache's in-memory storage by default.
 *
 * Memoization of wrapped handlers is instance-scoped (see the core
 * `createCacheRuleHandler` in `h3/rules`) — create one handler per matcher.
 *
 * ⚠️ **`storage` is process-global, not instance-scoped.** ocache resolves its
 * backend through a single module-level slot (`setStorage`/`useStorage`) and
 * exposes no per-handler storage option, so the *last* `createOcacheRuleHandler`
 * call that passes `storage` wins for every ocache consumer in the process —
 * including handlers created earlier and any `defineCachedFunction` of your own.
 * Two apps in one process must therefore agree on one storage backend (their
 * *entries* stay isolated regardless — cache keys are scoped per handler, see
 * `createCacheRuleHandler`'s `id` option). A conflicting override is reported via
 * `console.warn` rather than silently applied.
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
      const ocacheHandler = ocacheDefineCachedHandler(
        // `headersOnly` caches nothing and skips ocache's own request filtering
        // (cookies included), so the request is left exactly as it arrived.
        cachedOpts.headersOnly ? handler : withCredentialFilter(handler, allowCredentials),
        {
          toResponse: async (value, event) => {
            const res = moveVolatileCorsHeaders(
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
          // Allowlisted credentials participate in caching exactly like an
          // allowlisted cookie: they vary the key (ocache hashes every `varies`
          // header into it) and land in the response's `Vary`, so no entry is
          // ever shared between two credentials. ocache strips them from the
          // forwarded request as part of that — `withCredentialFilter` puts the
          // captured values back for the handler.
          ...(allowCredentials && {
            varies: [...(cachedOpts.varies ?? []), ...CREDENTIAL_HEADERS],
          }),
        },
      );
      return defineHandler(async (event) => {
        if (allowCredentials) {
          savedCredentials.set(
            event,
            CREDENTIAL_HEADERS.map((name) => event.req.headers.get(name)),
          );
        }
        const res = await ocacheHandler(event);
        // ocache's conditional-revalidation path builds a bare 304 `Response`,
        // and h3's `prepareResponse` merges `event.res.headers` only into 2xx
        // `Response` instances — the conditional headers set by
        // `handleCacheHeaders` (etag / cache-control / last-modified) and by
        // post-response `headers` rules would never reach the client, but a
        // 304 must carry what the 200 would (RFC 9110 §15.4.5). Returning
        // h3's `HTTPResponse` instead defers response construction to
        // `prepareResponse`, which merges the final `event.res.headers` over
        // the 304's own (`x-cache` / `vary`) for any status.
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

/**
 * Shared default ocache-backed `cache` rule handler — the named export
 * compiled matchers import (`import { cache } from "h3/rules/cache"`, the
 * `DEFAULT_RUNTIME_RULES` source for `cache`), so its memoization is
 * module-scoped — shared by every app in the process. Both the wrapper and the
 * ocache storage key are scoped per route handler (see `createCacheRuleHandler`),
 * so two apps registering the same rule pattern for the same route path never
 * read or write each other's entries. Runtime matchers register it explicitly
 * (`handlers: { cache }`); for custom wiring point `runtimeRules`
 * (`{ cache: "#your/cache" }`) / `handlers` at your own instance instead.
 */
export const cache: RuleHandler<"cache"> = /* @__PURE__ */ createOcacheRuleHandler();
