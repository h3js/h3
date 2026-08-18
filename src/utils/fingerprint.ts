import type { HTTPEvent } from "../event.ts";
import { getRequestIP } from "./request.ts";

export interface RequestFingerprintOptions {
  /** @default SHA-256 */
  hash?: false | "SHA-1" | "SHA-256" | "SHA-384" | "SHA-512";

  /** @default `true` */
  ip?: boolean;

  /** @default `false` */
  xForwardedFor?: boolean;

  /** @default `false` */
  method?: boolean;

  /** @default `false` */
  url?: boolean;

  /** @default `false` */
  userAgent?: boolean;
}

/**
 *
 * Get a unique fingerprint for the incoming request.
 *
 * @experimental Behavior of this utility might change in the future versions
 */
export async function getRequestFingerprint(
  event: HTTPEvent,
  opts: RequestFingerprintOptions = {},
): Promise<string | null> {
  // Each enabled option keeps a fixed slot (empty when undeterminable) and values are escaped
  // so that a component value can never forge the slot structure of another request.
  const fingerprint: string[] = [];
  let hasValue = false;

  const addComponent = (value: string | null | undefined) => {
    if (value) {
      hasValue = true;
    }
    fingerprint.push(value ? escapeComponent(value) : "");
  };

  if (opts.ip !== false) {
    addComponent(getRequestIP(event, { xForwardedFor: opts.xForwardedFor }));
  }

  if (opts.method === true) {
    addComponent(event.req.method);
  }

  if (opts.url === true) {
    addComponent(event.req.url);
  }

  if (opts.userAgent === true) {
    addComponent(event.req.headers.get("user-agent"));
  }

  if (!hasValue) {
    return null;
  }

  const fingerprintString = fingerprint.join("|");

  if (opts.hash === false) {
    return fingerprintString;
  }

  const buffer = await crypto.subtle.digest(
    opts.hash || "SHA-256",
    new TextEncoder().encode(fingerprintString),
  );

  const hash = [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");

  return hash;
}

function escapeComponent(value: string): string {
  return value.replaceAll("%", "%25").replaceAll("|", "%7C");
}
