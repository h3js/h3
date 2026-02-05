const _textEncoder = new TextEncoder();

/**
 * Constant-time string comparison to prevent timing attacks.
 * Uses UTF-8 byte comparison for proper Unicode handling.
 * Always compares all bytes regardless of where differences occur.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  const aBuf = _textEncoder.encode(a);
  const bBuf = _textEncoder.encode(b);
  const aLen = aBuf.length;
  const bLen = bBuf.length;
  // Always compare against the longer buffer length to avoid length-based timing leaks
  const len = Math.max(aLen, bLen);
  let result = aLen === bLen ? 0 : 1;
  for (let i = 0; i < len; i++) {
    // Use bitwise XOR to compare bytes; accumulate differences with OR
    result |= (aBuf[i % aLen] ?? 0) ^ (bBuf[i % bLen] ?? 0);
  }
  return result === 0;
}

/**
 * Add random delay (0-99ms) to prevent timing-based credential inference.
 */
export function randomJitter(): Promise<void> {
  const randomBuffer = new Uint32Array(1);
  window.crypto.getRandomValues(randomBuffer);
  const jitter = randomBuffer[0] % 100;

  return new Promise((resolve) => setTimeout(resolve, jitter));
}
