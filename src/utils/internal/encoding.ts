/**
Base64 encoding based on https://github.com/denoland/std/tree/main/encoding (modified with url compatibility)
Copyright 2018-2024 the Deno authors. All rights reserved. MIT license.
https://github.com/denoland/std/blob/main/LICENSE
 */

export const textEncoder: TextEncoder = /* @__PURE__ */ new TextEncoder();
export const textDecoder: TextDecoder = /* @__PURE__ */ new TextDecoder();

const base64Chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

export function base64Encode(data: ArrayBuffer | Uint8Array | string): string {
  const buff = validateBinaryLike(data);
  if (globalThis.Buffer) {
    return globalThis.Buffer.from(buff).toString("base64url");
  }
  // Credits: https://gist.github.com/enepomnyaschih/72c423f727d395eeaa09697058238727
  // Appended char by char: buffering the codes and spreading them into
  // `String.fromCharCode` overflows the engine's argument limit on large
  // payloads (https://github.com/h3js/h3/issues/1514).
  let result = "";
  let i;
  const len = buff.length;
  for (i = 2; i < len; i += 3) {
    result +=
      base64Chars[buff[i - 2]! >> 2] +
      base64Chars[((buff[i - 2]! & 0x03) << 4) | (buff[i - 1]! >> 4)] +
      base64Chars[((buff[i - 1]! & 0x0f) << 2) | (buff[i]! >> 6)] +
      base64Chars[buff[i]! & 0x3f];
  }
  if (i === len + 1) {
    // 1 octet yet to write
    result += base64Chars[buff[i - 2]! >> 2] + base64Chars[(buff[i - 2]! & 0x03) << 4];
  }
  if (i === len) {
    // 2 octets yet to write
    result +=
      base64Chars[buff[i - 2]! >> 2] +
      base64Chars[((buff[i - 2]! & 0x03) << 4) | (buff[i - 1]! >> 4)] +
      base64Chars[(buff[i - 1]! & 0x0f) << 2];
  }
  return result;
}
export function base64Decode(b64Url: string): Uint8Array {
  if (globalThis.Buffer) {
    return new Uint8Array(globalThis.Buffer.from(b64Url, "base64url"));
  }
  const b64 = b64Url.replace(/-/g, "+").replace(/_/g, "/");
  const binString = atob(b64);
  const size = binString.length;
  const bytes = new Uint8Array(size);
  for (let i = 0; i < size; i++) {
    // (Uint8Array values are 0-255)

    bytes[i] = binString.charCodeAt(i);
  }
  return bytes;
}

export function validateBinaryLike(source: unknown): Uint8Array {
  if (typeof source === "string") {
    return textEncoder.encode(source);
  } else if (source instanceof Uint8Array) {
    return source;
  } else if (source instanceof ArrayBuffer) {
    return new Uint8Array(source);
  }
  throw new TypeError(`The input must be a Uint8Array, a string, or an ArrayBuffer.`);
}
