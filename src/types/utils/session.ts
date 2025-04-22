import type { CookieSerializeOptions } from "cookie-es";
import type { JWEOptions } from "../../utils/internal/jwe";
import type { kGetSession } from "../../utils/internal/session";

type SessionDataT = Record<string, any>;

export type SessionData<T extends SessionDataT = SessionDataT> = Partial<T>;

export interface Session<T extends SessionDataT = SessionDataT> {
  id: string;
  createdAt: number;
  data: SessionData<T>;
  [kGetSession]?: Promise<Session<T>>;
}

export interface SessionConfig {
  /** Private key used to encrypt session tokens */
  password: string;
  /** Session expiration time in seconds */
  maxAge?: number;
  /** default is h3 */
  name?: string;
  /** Default is secure, httpOnly, / */
  cookie?: false | CookieSerializeOptions;
  /** Default is x-h3-session / x-{name}-session */
  sessionHeader?: false | string;
  /** JWE options for encryption/decryption */
  jwe?: Partial<JWEOptions>;
  /** Time skew tolerance in seconds */
  timestampSkewSec?: number;
  /** Local time offset in milliseconds */
  localtimeOffsetMsec?: number;
  crypto?: Crypto;
  /** Default is Crypto.randomUUID */
  generateId?: () => string;
}
