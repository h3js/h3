import type { H3Event, Session, SessionConfig, SessionData } from "../types";
import { seal, unseal } from "./internal/jwe";
import { getCookie, setCookie } from "./cookie";
import {
  DEFAULT_SESSION_NAME,
  DEFAULT_SESSION_COOKIE,
  kGetSession,
} from "./internal/session";
import { EmptyObject } from "./internal/obj";

// Session defaults for time-related options
const SESSION_DEFAULTS = {
  timestampSkewSec: 60,
  localtimeOffsetMsec: 0,
};

/**
 * Create a session manager for the current request.
 *
 */
export async function useSession<T extends SessionData = SessionData>(
  event: H3Event,
  config: SessionConfig,
) {
  // Create a synced wrapper around the session
  const sessionName = config.name || DEFAULT_SESSION_NAME;
  await getSession(event, config); // Force init
  const sessionManager = {
    get id() {
      return event.context.sessions?.[sessionName]?.id;
    },
    get data() {
      return (event.context.sessions?.[sessionName]?.data || {}) as T;
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
  event: H3Event,
  config: SessionConfig,
): Promise<Session<T>> {
  const sessionName = config.name || DEFAULT_SESSION_NAME;

  // Return existing session if available
  if (!event.context.sessions) {
    event.context.sessions = new EmptyObject();
  }
  // Wait for existing session to load
  const existingSession = event.context.sessions![sessionName] as Session<T>;
  if (existingSession) {
    return existingSession[kGetSession] || existingSession;
  }

  // Prepare an empty session object and store in context
  const session: Session<T> = {
    id: "",
    createdAt: 0,
    data: new EmptyObject(),
  };
  event.context.sessions![sessionName] = session;

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
    sealedSession = getCookie(event, sessionName);
  }
  if (sealedSession) {
    // Unseal session data from cookie
    const promise = unsealSession(event, config, sealedSession)
      .catch(() => {})
      .then((unsealed) => {
        Object.assign(session, unsealed);
        delete event.context.sessions![sessionName][kGetSession];
        return session as Session<T>;
      });
    event.context.sessions![sessionName][kGetSession] = promise;
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
  event: H3Event,
  config: SessionConfig,
  update?: SessionUpdate<T>,
): Promise<Session<T>> {
  const sessionName = config.name || DEFAULT_SESSION_NAME;

  // Access current session
  const session: Session<T> =
    (event.context.sessions?.[sessionName] as Session<T>) ||
    (await getSession<T>(event, config));

  // Update session data if provided
  if (typeof update === "function") {
    update = update(session.data);
  }
  if (update) {
    Object.assign(session.data, update);
  }

  // Seal and store in cookie
  if (config.cookie !== false) {
    const sealed = await sealSession(event, config);
    setCookie(event, sessionName, sealed, {
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
  event: H3Event,
  config: SessionConfig,
) {
  const sessionName = config.name || DEFAULT_SESSION_NAME;

  // Access current session
  const session: Session<T> =
    (event.context.sessions?.[sessionName] as Session<T>) ||
    (await getSession<T>(event, config));

  // Add timestamp metadata
  const now =
    Date.now() +
    (config.localtimeOffsetMsec || SESSION_DEFAULTS.localtimeOffsetMsec);
  const payload = {
    session,
    iat: now,
    ...(config.maxAge ? { exp: now + config.maxAge * 1000 } : {}),
  };

  const sealed = await seal(JSON.stringify(payload), config.password, {
    ...config.jwe,
    protectedHeader: {
      ...config.jwe?.protectedHeader,
      cty: 'application/json',
    }
  });

  return sealed;
}

/**
 * Decrypt and verify the session data for the current request.
 */
export async function unsealSession(
  _event: H3Event,
  config: Omit<SessionConfig, 'jwe'>,
  sealed: string,
) {
  const now =
    Date.now() +
    (config.localtimeOffsetMsec || SESSION_DEFAULTS.localtimeOffsetMsec);
  const timestampSkewSec =
    config.timestampSkewSec || SESSION_DEFAULTS.timestampSkewSec;

  // Decrypt the payload
  const _payload = await unseal(sealed, config.password);
  const payload = JSON.parse(_payload);

  // Type check for expected format
  if (!payload || typeof payload !== "object" || !payload.session) {
    throw new Error("Invalid session format");
  }

  // Verify expiration
  if (
    payload.exp &&
    typeof payload.exp === "number" &&
    payload.exp <= now - timestampSkewSec * 1000
  ) {
    throw new Error("Session expired");
  }

  return payload.session;
}

/**
 * Clear the session data for the current request.
 */
export function clearSession(
  event: H3Event,
  config: Partial<Omit<SessionConfig, 'jwe'>>,
): Promise<void> {
  const sessionName = config.name || DEFAULT_SESSION_NAME;
  if (event.context.sessions?.[sessionName]) {
    delete event.context.sessions![sessionName];
  }
  setCookie(event, sessionName, "", {
    ...DEFAULT_SESSION_COOKIE,
    ...config.cookie,
  });
  return Promise.resolve();
}
