import type { H3Event } from "../types/event.ts";
import { getRequestIP } from "./request.ts";

export interface RequestFingerprintOptions {
  /** @default SHA-1 */
  hash?: false | "SHA-1";

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
  event: H3Event,
  opts: RequestFingerprintOptions = {},
): Promise<string | null> {
  const fingerprint: unknown[] = [];

  if (opts.ip !== false) {
    fingerprint.push(
      getRequestIP(event, { xForwardedFor: opts.xForwardedFor }),
    );
  }

  if (opts.method === true) {
    fingerprint.push(event.req.method);
  }

  if (opts.url === true) {
    fingerprint.push(event.url.href);
  }

  if (opts.userAgent === true) {
    fingerprint.push(event.req.headers.get("user-agent"));
  }

  const fingerprintString = fingerprint.filter(Boolean).join("|");

  if (!fingerprintString) {
    return null;
  }

  if (opts.hash === false) {
    return fingerprintString;
  }

  const buffer = await crypto.subtle.digest(
    opts.hash || "SHA-1",
    new TextEncoder().encode(fingerprintString),
  );

  const hash = [...new Uint8Array(buffer)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return hash;
}
