/**
 * Constant-time string comparison to prevent timing attacks.
 * Always compares all characters regardless of where differences occur.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  const aLen = a.length;
  const bLen = b.length;
  // Always compare against the longer string length to avoid length-based timing leaks
  const len = Math.max(aLen, bLen);
  let result = aLen === bLen ? 0 : 1;
  for (let i = 0; i < len; i++) {
    // Use bitwise XOR to compare characters; accumulate differences with OR
    result |= (a.charCodeAt(i % aLen) || 0) ^ (b.charCodeAt(i % bLen) || 0);
  }
  return result === 0;
}

/**
 * Add random delay (0-100ms) to prevent timing-based credential inference.
 */
export function randomJitter(): Promise<void> {
  const jitter = Math.floor(Math.random() * 100);
  return new Promise((resolve) => setTimeout(resolve, jitter));
}
