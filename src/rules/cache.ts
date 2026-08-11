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
import type { CacheRuleOptions, RuleHandler } from "./types.ts";

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

/** `Set-Cookie` values of a response, one per cookie. */
function getSetCookies(headers: Headers): string[] {
  // Non-standard runtimes may not implement the (comparatively recent)
  // `getSetCookie`; the joined single value is then the best available reading,
  // and it is still the right thing to move — worst case one header carries
  // what should have been several.
  if (typeof headers.getSetCookie === "function") {
    return headers.getSetCookie();
  }
  const value = headers.get("set-cookie");
  return value === null ? [] : [value];
}

/**
 * Move the per-requester response headers off the response that is about to be
 * serialized into the shared cache, back onto the live `event.res.headers`.
 *
 * The move (not just a strip) matters: h3's inner `toResponse` above already
 * *consumed* `event.res` (cors's appended headers and the handler's cookies
 * included) into this response, so the current — cache-miss — request would
 * otherwise lose headers it produced itself. Re-set on a fresh `event.res`,
 * h3's outer `prepareResponse` merges them into the 2xx response at send time.
 * Cache *hits* need nothing from the CORS side: the `cors` rule runs on every
 * request and appends fresh, request-correct headers that `prepareResponse`
 * merges the same way.
 *
 * `Set-Cookie` is moved for the opposite reason to the CORS headers: not
 * because ocache would keep it (its serialize drops any cookie outside
 * `allowCookies`), but because it drops it from the *same live Response* the
 * miss reply is rebuilt from — so a handler under a broad rule like
 * `"/**": { swr: 60 }` silently never set its cookie, not even on the request
 * that ran it. Moving it restores that, and closes the `allowCookies` case in
 * the same stroke: an allowlisted cookie was previously stored *in* the entry
 * and replayed to every later requester sharing the key, handing one visitor's
 * session to the next. `allowCookies` stays a request-side allowlist — which
 * cookies key the entry — which is all the response can safely honor.
 */
function moveVolatileHeaders(res: Response, event: H3Event): Response {
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
    // Immutable headers (e.g. a handler-returned `fetch` Response) — rebuild.
    res = new Response(res.body, res);
    strip(res.headers);
  }
  for (const [name, value] of moved) {
    event.res.headers.set(name, value);
  }
  for (const cookie of cookies) {
    // Append, never set: `prepareResponse` forwards each `set-cookie` entry
    // separately, so a handler's multiple cookies survive as multiple headers.
    event.res.headers.append("set-cookie", cookie);
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

type HeaderValues = (string | null)[];

/**
 * Set (or, for `null`, remove) `names` on the request the cached handler is
 * about to see.
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

const savedHeaders = /* @__PURE__ */ new WeakMap<H3Event, HeaderValues>();

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
 * headers the rule allows: `strip` removed, `restore` put back from the values
 * captured before ocache's own request filter ran.
 *
 * - `strip` — `authorization`/`proxy-authorization` unless `allowAuthorization`,
 *   so the handler cannot render user-specific output into a shared entry.
 * - `restore` — every header the entry is *keyed* on. ocache filters its
 *   `varies` names out of the forwarded request, which leaves a handler unable
 *   to read the very header it varies on: `varies: ["accept-language"]` bought
 *   one entry per language, each holding the default rendering. Putting the
 *   values back is safe precisely because they are in the key (and in the
 *   response's `Vary`) — one entry per value, never a shared one. This is what
 *   already made `allowAuthorization` work; it applies to every varying header
 *   for the same reason.
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
 * A failed *restore* is not an error: the handler merely sees the filtered
 * request it saw before, and the entry is keyed per value either way.
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
        // Only a surviving credential is fatal — a restore that did not land
        // leaves the request no less safe than ocache's own filtering did.
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

/**
 * The header names ocache will key this rule's entries on — its own
 * `variableHeaderNames` computation, mirrored rather than guessed so the
 * restore list can never come to mean something the key does not.
 *
 * `cookie` drops out of it whenever `allowCookies` is set: ocache then keys on
 * — and forwards — the allowlisted crumbs only, and that narrowing is the whole
 * point of the option, so restoring the raw header would undo it.
 */
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
      const strip: readonly string[] = allowCredentials ? [] : CREDENTIAL_HEADERS;
      const restore = variableHeaderNames(cachedOpts, allowCredentials).filter(
        // A credential named in `varies` keys the entry per credential but does
        // not open the forwarding path: `allowAuthorization` stays the single
        // switch for that, so a rule set cannot let one through by accident.
        (name) => !strip.includes(name),
      );
      const ocacheHandler = ocacheDefineCachedHandler(
        // `headersOnly` caches nothing and skips ocache's own request filtering
        // (cookies included), so the request is left exactly as it arrived.
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
          // Allowlisted credentials participate in caching exactly like an
          // allowlisted cookie: they vary the key (ocache hashes every `varies`
          // header into it) and land in the response's `Vary`, so no entry is
          // ever shared between two credentials. ocache strips them from the
          // forwarded request as part of that — `withRequestHeaderFilter` puts
          // the captured values back for the handler.
          ...(allowCredentials && {
            varies: [...(cachedOpts.varies ?? []), ...CREDENTIAL_HEADERS],
          }),
        },
      );
      return defineHandler(async (event) => {
        if (restore.length > 0) {
          // Captured here, outside ocache's resolver: by the time the wrapped
          // handler runs, ocache has already rebuilt the request without them.
          savedHeaders.set(
            event,
            restore.map((name) => event.req.headers.get(name)),
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
