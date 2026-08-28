import { seal, unseal, defaults as sealDefaults } from "./internal/iron-crypto.ts";
import { getChunkedCookie, setChunkedCookie, deleteChunkedCookie } from "./cookie.ts";
import { DEFAULT_SESSION_NAME, DEFAULT_SESSION_COOKIE } from "./internal/session.ts";
import { EmptyObject } from "./internal/obj.ts";
import { kGetSession, kLegacySeal } from "./internal/session.ts";

import type { H3Event, HTTPEvent } from "../event.ts";
import type { CookieSerializeOptions } from "cookie-es";
import type { SealOptions } from "./internal/iron-crypto.ts";
import type { H3EventContext } from "../types/context.ts";
import { getEventContext } from "./event.ts";

type SessionDataT = Record<string, any>;

export type SessionData<T extends SessionDataT = SessionDataT> = Partial<T>;

export interface Session<T extends SessionDataT = SessionDataT> {
  id: string;
  /** Time the session was created. The point `maxAge` is measured from. */
  createdAt: number;
  /**
   * Time the session was last resealed. Only stamped when `idleTimeout` is set,
   * and the point the idle window is measured from.
   */
  lastSeenAt?: number;
  data: SessionData<T>;
  [kGetSession]?: Promise<Session<T>>;
}

export interface SessionManager<T extends SessionDataT = SessionDataT> {
  readonly id: string | undefined;
  readonly data: SessionData<T>;
  update: (update: SessionUpdate<T>) => Promise<SessionManager<T>>;
  clear: () => Promise<SessionManager<T>>;
}

export interface SessionConfig {
  /**
   * Private key used to seal session tokens. Must be at least 32 characters.
   *
   * Its entropy is the security boundary: a stolen cookie can be brute-forced
   * offline, so generate this from a cryptographically random source (e.g.
   * `crypto.randomBytes(32).toString("base64")`) — a guessable passphrase is
   * unsafe even at 32+ characters.
   */
  password: string;
  /**
   * Absolute session lifetime in seconds, counted from when the session was
   * created. Reached regardless of how active the user is.
   */
  maxAge?: number;
  /**
   * Sliding session lifetime in seconds, counted from the last request. An
   * active user stays signed in; an idle one is signed out after this long.
   *
   * Equivalent to `rolling` in express-session and koa-session, but with its own
   * duration instead of reinterpreting `maxAge` — so `maxAge` remains available
   * as an absolute cap on top of the idle window rather than being replaced.
   *
   * H3 moves the window forward by resealing the session cookie with the reseal
   * time stamped into it as `lastSeenAt`; `createdAt` is untouched. Only
   * cookie-based sessions slide: a session read from the session header cannot
   * be resealed, so it expires `idleTimeout` after its seal was issued.
   *
   * The reseal is throttled to once per half window (writing the session
   * reseals it too, and counts), so `lastSeenAt` can trail the last request by
   * up to half of `idleTimeout`. An idle session is therefore signed out
   * between `idleTimeout / 2` and `idleTimeout` after the last request — never
   * later, and never while the user keeps making requests.
   */
  idleTimeout?: number;
  /** default is h3 */
  name?: string;
  /** Default is secure, httpOnly, sameSite lax, / */
  cookie?: false | (CookieSerializeOptions & { chunkMaxLength?: number });
  /** Default is x-h3-session / x-{name}-session */
  sessionHeader?: false | string;
  /**
   * Overrides for the iron seal (algorithms, PBKDF2 iterations, TTL, clock skew).
   *
   * `SealOptions` has no optional fields, so an override must specify all of
   * them. Session expiration is enforced by `maxAge`/`idleTimeout` independently
   * of the seal `ttl` set here, so a shorter or zeroed `ttl` cannot extend a
   * session beyond those limits.
   */
  seal?: SealOptions;
  /**
   * Set to `false` to reject sessions sealed with the legacy default of 1
   * PBKDF2 iteration instead of unsealing and resealing them.
   *
   */
  legacySealFallback?: boolean;
  crypto?: Crypto;
  /** Default is Crypto.randomUUID */
  generateId?: () => string;
}

/**
 * Create a session manager for the current request.
 *
 */
export async function useSession<T extends SessionData = SessionData>(
  event: HTTPEvent,
  config: SessionConfig,
): Promise<SessionManager<T>> {
  // Create a synced wrapper around the session
  const sessionName = config.name || DEFAULT_SESSION_NAME;
  await getSession(event, config, { persistNew: true }); // Force init
  const sessionManager = {
    get id() {
      const context = getEventContext<H3EventContext>(event);
      return context?.sessions?.[sessionName]?.id;
    },
    get data() {
      const context = getEventContext<H3EventContext>(event);
      return (context.sessions?.[sessionName]?.data || {}) as T;
    },
    update: async (update: SessionUpdate<T>) => {
      await updateSession<T>(event, config, update);
      return sessionManager;
    },
    clear: () => {
      clearSession(event, config);
      return Promise.resolve(sessionManager);
    },
  };
  return sessionManager;
}

/**
 * Get the session for the current request.
 */
export type GetSessionOptions = {
  /**
   * Persist a newly created empty session as a cookie.
   * Used by {@link useSession} to keep its force-init contract.
   * @internal
   */
  persistNew?: boolean;
};

export async function getSession<T extends SessionData = SessionData>(
  event: HTTPEvent,
  config: SessionConfig,
  opts?: GetSessionOptions,
): Promise<Session<T>> {
  const sessionName = config.name || DEFAULT_SESSION_NAME;

  const context = getEventContext<H3EventContext>(event);

  // Return existing session if available
  if (!context.sessions) {
    context.sessions = new EmptyObject();
  }
  // Wait for existing session to load
  const existingSession = context.sessions![sessionName] as Session<T>;
  if (existingSession) {
    return existingSession[kGetSession] || existingSession;
  }

  // Prepare an empty session object and store in context
  const session: Session<T> = {
    id: "",
    createdAt: 0,
    data: new EmptyObject(),
  };
  context.sessions![sessionName] = session;

  // Try to load session
  let sealedSession: string | undefined;
  // Try header first
  if (config.sessionHeader !== false) {
    const headerName =
      typeof config.sessionHeader === "string"
        ? config.sessionHeader.toLowerCase()
        : `x-${sessionName.toLowerCase()}-session`;
    const headerValue = event.req.headers.get(headerName);
    if (typeof headerValue === "string") {
      sealedSession = headerValue;
    }
  }
  // Fallback to cookies
  let sessionFromCookie = false;
  if (!sealedSession) {
    sealedSession = getChunkedCookie(event, sessionName);
    sessionFromCookie = true;
  }
  if (sealedSession) {
    // Unseal session data from cookie
    const promise = unsealSession(event, config, sealedSession)
      .catch(() => {})
      .then(async (unsealed) => {
        const legacySeal = unsealed && (unsealed as any)[kLegacySeal];
        if (legacySeal) {
          delete (unsealed as any)[kLegacySeal];
        }
        Object.assign(session, unsealed);
        delete context.sessions![sessionName][kGetSession];
        // Proactively reseal legacy cookies with the current seal options, and
        // reseal under idleTimeout to slide the window (see `shouldSlide`). A
        // session that failed to unseal has no id and is replaced below, so
        // resealing it here is wasted work.
        if (session.id && sessionFromCookie && (legacySeal || shouldSlide(session, config))) {
          await updateSession(event, config);
        }
        return session as Session<T>;
      });
    context.sessions![sessionName][kGetSession] = promise;
    await promise;
  }

  // Assign id for a new session. Persist only when requested (useSession
  // force-init); plain getSession stays read-only so auth peeks do not mint cookies.
  if (!session.id) {
    session.id = config.generateId?.() ?? (config.crypto || crypto).randomUUID();
    session.createdAt = Date.now();
    if (opts?.persistNew) {
      await updateSession(event, config);
    }
  }

  return session;
}

type SessionUpdate<T extends SessionData = SessionData> =
  | Partial<SessionData<T>>
  | ((oldData: SessionData<T>) => Partial<SessionData<T>> | undefined);

/**
 * Update the session data for the current request.
 */
export async function updateSession<T extends SessionData = SessionData>(
  event: HTTPEvent,
  config: SessionConfig,
  update?: SessionUpdate<T>,
): Promise<Session<T>> {
  const sessionName = config.name || DEFAULT_SESSION_NAME;

  // Access current session
  const context = getEventContext<H3EventContext>(event);
  const session: Session<T> =
    (context.sessions?.[sessionName] as Session<T>) || (await getSession<T>(event, config));

  // Update session data if provided
  if (typeof update === "function") {
    update = update(session.data);
  }
  if (update) {
    Object.assign(session.data, update);
  }

  // Seal and store in cookie
  if (config.cookie !== false && (event as H3Event).res) {
    const sealed = await sealSession(event, config);
    setChunkedCookie(event as H3Event, sessionName, sealed, {
      ...DEFAULT_SESSION_COOKIE,
      expires: sessionExpires(session, config),
      ...config.cookie,
    });
    stageSessionErrCookies(event as H3Event, sessionName);
  }

  return session;
}

/**
 * Encrypt and sign the session data for the current request.
 */
export async function sealSession<T extends SessionData = SessionData>(
  event: HTTPEvent,
  config: SessionConfig,
): Promise<string> {
  const sessionName = config.name || DEFAULT_SESSION_NAME;

  // Access current session
  const context = getEventContext<H3EventContext>(event);
  const session: Session<T> =
    (context.sessions?.[sessionName] as Session<T>) || (await getSession<T>(event, config));

  if (config.idleTimeout) {
    // The idle window is measured from the last reseal rather than from
    // createdAt. Only stamped when enabled, so the default sealed payload is
    // unchanged.
    session.lastSeenAt = Date.now();
  }

  const sealed = await seal(session, config.password, {
    ...sealDefaults,
    ttl: (config.maxAge || config.idleTimeout || 0) * 1000,
    ...config.seal,
  });

  return sealed;
}

/**
 * Decrypt and verify the session data for the current request.
 */
export async function unsealSession(
  _event: HTTPEvent,
  config: SessionConfig,
  sealed: string,
): Promise<Partial<Session>> {
  const sealOptions = {
    ...sealDefaults,
    ttl: (config.maxAge || config.idleTimeout || 0) * 1000,
    ...config.seal,
  };
  let unsealed: Partial<Session>;
  try {
    unsealed = (await unseal(sealed, config.password, sealOptions)) as Partial<Session>;
  } catch (error) {
    // TODO: Remove this fallback before the v2 stable release
    // Sessions sealed before the default PBKDF2 iterations were raised from 1
    // to 8192 fail HMAC verification; retry with the legacy count so existing
    // sessions survive the upgrade (getSession reseals them with the current
    // options).
    if (
      config.legacySealFallback === false ||
      sealOptions.integrity.iterations === 1 ||
      !(error instanceof Error) ||
      error.message !== "Bad hmac value"
    ) {
      throw error;
    }
    unsealed = (await unseal(sealed, config.password, {
      ...sealOptions,
      encryption: { ...sealOptions.encryption, iterations: 1 },
      integrity: { ...sealOptions.integrity, iterations: 1 },
    })) as Partial<Session>;
    if (unsealed) {
      (unsealed as any)[kLegacySeal] = true;
    }
  }
  // Absolute lifetime, counted from when the session was created
  if (config.maxAge) {
    const age = Date.now() - (unsealed.createdAt || Number.NEGATIVE_INFINITY);
    if (age > config.maxAge * 1000) {
      throw new Error("Session expired!");
    }
  }
  // Idle window, counted from the last reseal. Sessions sealed before
  // idleTimeout was configured, and sessions read from the session header (which
  // are never resealed), fall back to createdAt
  if (config.idleTimeout) {
    const idle =
      Date.now() - (unsealed.lastSeenAt || unsealed.createdAt || Number.NEGATIVE_INFINITY);
    if (idle > config.idleTimeout * 1000) {
      throw new Error("Session expired!");
    }
  }
  return unsealed;
}

/**
 * Clear the session data for the current request.
 */
export function clearSession(event: HTTPEvent, config: Partial<SessionConfig>): Promise<void> {
  const context = getEventContext<H3EventContext>(event);
  const sessionName = config.name || DEFAULT_SESSION_NAME;
  if (context.sessions?.[sessionName]) {
    delete context.sessions![sessionName];
  }
  if ((event as H3Event).res && config.cookie !== false) {
    deleteChunkedCookie(event as H3Event, sessionName, {
      ...DEFAULT_SESSION_COOKIE,
      ...config.cookie,
    });
    stageSessionErrCookies(event as H3Event, sessionName);
  }
  return Promise.resolve();
}

/**
 * Fraction of the idle window that has to be used up before `getSession`
 * reseals to slide it. See {@link shouldSlide}.
 */
const SLIDE_THRESHOLD = 0.5;

/**
 * Whether reading the session should also reseal it to move the idle window
 * forward.
 *
 * Sliding the window means writing `lastSeenAt` back into the cookie, and that
 * seal is by far the most expensive thing a session does. Doing it on every
 * request also wastes it twice over on a request that writes the session: the
 * handler's `update()` reseals with the same fresh `lastSeenAt`, and
 * `setCookie`'s dedupe drops the first `Set-Cookie` anyway.
 *
 * So reseal only once the window is more than half used. Any `updateSession`
 * (from a handler write, or from the reseal itself) restamps `lastSeenAt`, so
 * writes keep sliding the window for free and a request that both reads and
 * writes almost never seals twice.
 *
 * The trade-off is granularity, in the safe direction: `lastSeenAt` can trail
 * the last request by up to half the window, so an idle session is signed out
 * somewhere between `idleTimeout / 2` and `idleTimeout` after the last request,
 * never later.
 */
function shouldSlide(session: Session<any>, config: SessionConfig): boolean {
  if (!config.idleTimeout) {
    return false;
  }
  // Sessions sealed before `idleTimeout` was configured have no `lastSeenAt`
  const lastSeenAt = session.lastSeenAt || session.createdAt || 0;
  return Date.now() - lastSeenAt > config.idleTimeout * 1000 * SLIDE_THRESHOLD;
}

/**
 * Mirror this session's `Set-Cookie` headers into `event.res.errHeaders`.
 *
 * Error responses only receive headers explicitly staged as `errHeaders`, so
 * without this a request that throws drops the session cookie entirely: a
 * session created during that request is lost, and under `idleTimeout` the idle
 * window fails to slide even though the user was active.
 *
 * Re-staged from scratch on every write so the latest state wins — in
 * particular, a `clearSession` after a reseal must not leave the stale reseal
 * cookie behind to resurrect the session on an error response.
 */
function stageSessionErrCookies(event: H3Event, sessionName: string): void {
  // Chunks are stored as `{name}.{n}` by `setChunkedCookie`
  const isSessionCookie = (cookie: string) =>
    cookie.startsWith(`${sessionName}=`) || cookie.startsWith(`${sessionName}.`);

  const errHeaders = event.res.errHeaders;
  const staged = [
    ...errHeaders.getSetCookie().filter((cookie) => !isSessionCookie(cookie)),
    ...event.res.headers.getSetCookie().filter((cookie) => isSessionCookie(cookie)),
  ];
  errHeaders.delete("set-cookie");
  for (const cookie of staged) {
    errHeaders.append("set-cookie", cookie);
  }
}

/**
 * Cookie expiry: whichever of the absolute lifetime and the idle window runs out
 * first, or none if neither is configured.
 */
function sessionExpires(session: Session<any>, config: SessionConfig): Date | undefined {
  const times: number[] = [];
  if (config.maxAge) {
    times.push(session.createdAt + config.maxAge * 1000);
  }
  if (config.idleTimeout) {
    times.push((session.lastSeenAt || session.createdAt) + config.idleTimeout * 1000);
  }
  return times.length > 0 ? new Date(Math.min(...times)) : undefined;
}
