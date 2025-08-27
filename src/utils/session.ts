import {
  seal,
  unseal,
  defaults as sealDefaults,
} from "./internal/iron-crypto.ts";
import { getChunkedCookie, setChunkedCookie } from "./cookie.ts";
import {
  DEFAULT_SESSION_NAME,
  DEFAULT_SESSION_COOKIE,
} from "./internal/session.ts";
import { EmptyObject } from "./internal/obj.ts";
import { kGetSession } from "./internal/session.ts";

import type { H3Event, HTTPEvent } from "../event.ts";
import type { CookieSerializeOptions } from "cookie-es";
import type { SealOptions } from "./internal/iron-crypto.ts";
import type { H3EventContext } from "../types/context.ts";
import { getEventContext } from "./event.ts";

type SessionDataT = Record<string, any>;

export type SessionData<T extends SessionDataT = SessionDataT> = Partial<T>;

export interface Session<T extends SessionDataT = SessionDataT> {
  id: string;
  createdAt: number;
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
  /** Private key used to encrypt session tokens */
  password: string;
  /** Session expiration time in seconds */
  maxAge?: number;
  /** default is h3 */
  name?: string;
  /** Default is secure, httpOnly, / */
  cookie?: false | (CookieSerializeOptions & { chunkMaxLength?: number });
  /** Default is x-h3-session / x-{name}-session */
  sessionHeader?: false | string;
  seal?: SealOptions;
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
  await getSession(event, config); // Force init
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
export async function getSession<T extends SessionData = SessionData>(
  event: HTTPEvent,
  config: SessionConfig,
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
  if (!sealedSession) {
    sealedSession = getChunkedCookie(event, sessionName);
  }
  if (sealedSession) {
    // Unseal session data from cookie
    const promise = unsealSession(event, config, sealedSession)
      .catch(() => {})
      .then((unsealed) => {
        Object.assign(session, unsealed);
        delete context.sessions![sessionName][kGetSession];
        return session as Session<T>;
      });
    context.sessions![sessionName][kGetSession] = promise;
    await promise;
  }

  // New session store in response cookies
  if (!session.id) {
    session.id =
      config.generateId?.() ?? (config.crypto || crypto).randomUUID();
    session.createdAt = Date.now();
    await updateSession(event, config);
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
    (context.sessions?.[sessionName] as Session<T>) ||
    (await getSession<T>(event, config));

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
      expires: config.maxAge
        ? new Date(session.createdAt + config.maxAge * 1000)
        : undefined,
      ...config.cookie,
    });
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
    (context.sessions?.[sessionName] as Session<T>) ||
    (await getSession<T>(event, config));

  const sealed = await seal(session, config.password, {
    ...sealDefaults,
    ttl: config.maxAge ? config.maxAge * 1000 : 0,
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
  const unsealed = (await unseal(sealed, config.password, {
    ...sealDefaults,
    ttl: config.maxAge ? config.maxAge * 1000 : 0,
    ...config.seal,
  })) as Partial<Session>;
  if (config.maxAge) {
    const age = Date.now() - (unsealed.createdAt || Number.NEGATIVE_INFINITY);
    if (age > config.maxAge * 1000) {
      throw new Error("Session expired!");
    }
  }
  return unsealed;
}

/**
 * Clear the session data for the current request.
 */
export function clearSession(
  event: HTTPEvent,
  config: Partial<SessionConfig>,
): Promise<void> {
  const context = getEventContext<H3EventContext>(event);
  const sessionName = config.name || DEFAULT_SESSION_NAME;
  if (context.sessions?.[sessionName]) {
    delete context.sessions![sessionName];
  }
  if ((event as H3Event).res && config.cookie !== false) {
    setChunkedCookie(event as H3Event, sessionName, "", {
      ...DEFAULT_SESSION_COOKIE,
      ...config.cookie,
    });
  }
  return Promise.resolve();
}
