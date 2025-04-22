import { subtle, getRandomValues } from "uncrypto";
import type { JWSHeaderParameters } from "../../types/utils/jwt";

import { textEncoder, textDecoder } from "./encoding";

export interface JWEHeaderParameters extends JWSHeaderParameters {
  /**
   * `alg` (Algorithm): Header Parameter
   *
   * @default "PBES2-HS256+A128KW"
   */
  alg?: KeyWrappingAlgorithmType;
  /**
   * `enc` (Encryption Algorithm): Header Parameter
   *
   * @default "A256GCM"
   */
  enc?: ContentEncryptionAlgorithmType;
  /**
   * `p2c` (PBES2 Count): Header Parameter
   *
   * @default 2048
   */
  p2c?: number;
  /**
   * `p2s` (PBES2 Salt): Header Parameter
   */
  p2s?: string;
}

/**
 * JWE (JSON Web Encryption) options
 */
export interface JWEOptions {
  /**
   * Number of iterations for PBES2 key derivation
   * Also accessible as `protectedHeader.p2c`
   *
   * @default 2048
   */
  iterations?: number;
  /**
   * Size of the salt for PBES2 key derivation
   *
   * @default 16
   */
  saltSize?: number;
  /**
   * Additional protected header parameters
   */
  protectedHeader?: JWEHeaderParameters;
}

/**
 * Supported key wrapping algorithms
 */
export const KEY_WRAPPING_ALGORITHMS = /* @__PURE__ */ Object.freeze({
  "PBES2-HS256+A128KW": {
    hash: "SHA-256",
    keyLength: 128,
  },
  "PBES2-HS384+A192KW": {
    hash: "SHA-384",
    keyLength: 192,
  },
  "PBES2-HS512+A256KW": {
    hash: "SHA-512",
    keyLength: 256,
  },
});

/**
 * Supported content encryption algorithms
 */
export const CONTENT_ENCRYPTION_ALGORITHMS = /* @__PURE__ */ Object.freeze({
  // GCM algorithms
  A128GCM: {
    type: "gcm",
    keyLength: 128,
    tagLength: 16,
    ivLength: 12,
  },
  A192GCM: {
    type: "gcm",
    keyLength: 192,
    tagLength: 16,
    ivLength: 12,
  },
  A256GCM: {
    type: "gcm",
    keyLength: 256,
    tagLength: 16,
    ivLength: 12,
  },
  // TODO: implement future CBC algorithms
  "A128CBC-HS256": {
    type: "cbc",
    keyLength: 256, // Combined key length (encryption + HMAC)
    encKeyLength: 128,
    macKeyLength: 128,
    tagLength: 16,
    ivLength: 16,
    macAlgorithm: "SHA-256",
  },
  "A192CBC-HS384": {
    type: "cbc",
    keyLength: 384, // Combined key length (encryption + HMAC)
    encKeyLength: 192,
    macKeyLength: 192,
    tagLength: 24,
    ivLength: 16,
    macAlgorithm: "SHA-384",
  },
  "A256CBC-HS512": {
    type: "cbc",
    keyLength: 512, // Combined key length (encryption + HMAC)
    encKeyLength: 256,
    macKeyLength: 256,
    tagLength: 32,
    ivLength: 16,
    macAlgorithm: "SHA-512",
  },
});

type KeyWrappingAlgorithmType = keyof typeof KEY_WRAPPING_ALGORITHMS;
type ContentEncryptionAlgorithmType =
  keyof typeof CONTENT_ENCRYPTION_ALGORITHMS;

/** The default settings. */
export const defaults = /* @__PURE__ */ Object.freeze({
  saltSize: 16,
  iterations: 2048,
  alg: "PBES2-HS256+A128KW" as KeyWrappingAlgorithmType,
  enc: "A256GCM" as ContentEncryptionAlgorithmType,
});

/**
 * Seal (encrypt) data using JWE with configurable algorithms
 * @param data The data to encrypt
 * @param password The password to use for encryption
 * @param options Optional parameters
 * @returns Promise resolving to the compact JWE token
 */
export async function seal(
  data: string | Uint8Array,
  password: string | Uint8Array,
  options: JWEOptions = {},
): Promise<string> {
  // Configure options with defaults
  const protectedHeader = options.protectedHeader || {};
  const iterations =
    protectedHeader.p2c || options.iterations || defaults.iterations;
  const saltSize = options.saltSize || defaults.saltSize;

  // Set algorithms with defaults
  const alg = (protectedHeader.alg || defaults.alg) as KeyWrappingAlgorithmType;
  const enc = (protectedHeader.enc ||
    defaults.enc) as ContentEncryptionAlgorithmType;

  // Validate both algorithms
  validateKeyWrappingAlgorithm(alg);
  const encConfig = validateContentEncryptionAlgorithm(enc);

  // Convert input data to Uint8Array if it's a string
  const plaintext = typeof data === "string" ? textEncoder.encode(data) : data;

  // Generate random salt for PBES2
  const saltInput = randomBytes(saltSize);

  // Set up the protected header
  const header = {
    alg,
    enc,
    p2s: base64UrlEncode(saltInput),
    p2c: iterations,
    ...protectedHeader,
  };

  // Encode the protected header
  const encodedHeader = base64UrlEncode(
    textEncoder.encode(JSON.stringify(header)),
  );

  // Derive the key for key wrapping
  const derivedKey = await deriveKeyFromPassword(
    password,
    saltInput,
    iterations,
    alg,
  );

  // Generate a random Content Encryption Key and wrap it
  const {
    wrappedKey,
    rawCek: _,
    cek,
  } = await generateAndWrapCEK(derivedKey, encConfig);

  // Generate random initialization vector
  const iv = randomBytes(encConfig.ivLength);

  let ciphertext: Uint8Array;
  let tag: Uint8Array;

  // Encrypt the plaintext based on the encryption type
  if (encConfig.type === "gcm") {
    const result = await encryptGCM(
      plaintext,
      cek as CryptoKey,
      iv,
      textEncoder.encode(encodedHeader),
      encConfig,
    );
    ciphertext = result.ciphertext;
    tag = result.tag;
  } else {
    // TODO: CBC encryption
    throw new Error(`Unsupported encryption type: ${(encConfig as any).type}`);
  }

  // Construct the JWE compact serialization
  return [
    encodedHeader,
    base64UrlEncode(new Uint8Array(wrappedKey)),
    base64UrlEncode(iv),
    base64UrlEncode(ciphertext),
    base64UrlEncode(tag),
  ].join(".");
}

/**
 * Decrypts a JWE (JSON Web Encryption) token
 * @param token The JWE token string in compact serialization format
 * @param password The password used to derive the encryption key
 * @returns The decrypted content as a string
 */
export async function unseal(
  token: string,
  password: string | Uint8Array,
): Promise<string>;
/**
 * Decrypts a JWE (JSON Web Encryption) token
 * @param token The JWE token string in compact serialization format
 * @param password The password used to derive the encryption key
 * @param options Decryption options
 * @returns The decrypted content as a string
 */
export async function unseal(
  token: string,
  password: string | Uint8Array,
  options: { textOutput: true },
): Promise<string>;
/**
 * Decrypts a JWE (JSON Web Encryption) token
 * @param token The JWE token string in compact serialization format
 * @param password The password used to derive the encryption key
 * @param options Decryption options
 * @returns The decrypted content as a Uint8Array
 */
export async function unseal(
  token: string,
  password: string | Uint8Array,
  options: { textOutput: false },
): Promise<Uint8Array>;
/**
 * Decrypts a JWE (JSON Web Encryption) token
 * @param token The JWE token string in compact serialization format
 * @param password The password used to derive the encryption key
 * @param options Decryption options
 * @returns The decrypted content
 */
export async function unseal(
  token: string,
  password: string | Uint8Array,
  options: {
    /**
     * Whether to return the decrypted data as a string (true) or as a Uint8Array (false).
     * @default true
     */
    textOutput?: boolean;
  } = {},
): Promise<string | Uint8Array> {
  if (!token) {
    throw new Error("Missing JWE token");
  }

  const textOutput = options.textOutput !== false;

  // Split the JWE token
  const [
    encodedHeader,
    encryptedKey,
    encodedIv,
    encodedCiphertext,
    encodedTag,
  ] = token.split(".");

  // Decode the header
  const header = JSON.parse(textDecoder.decode(base64UrlDecode(encodedHeader)));

  // Get the algorithms
  const alg = header.alg as KeyWrappingAlgorithmType;
  const enc = header.enc as ContentEncryptionAlgorithmType;

  // Validate both algorithms
  validateKeyWrappingAlgorithm(alg);
  const encConfig = validateContentEncryptionAlgorithm(enc);

  // Extract PBES2 parameters
  const iterations = header.p2c;
  const saltInput = base64UrlDecode(header.p2s);

  // Derive the key unwrapping key
  const derivedKey = await deriveKeyFromPassword(
    password,
    saltInput,
    iterations,
    alg,
  );

  // Decode the encrypted key, iv, ciphertext and tag
  const wrappedKey = base64UrlDecode(encryptedKey);
  const iv = base64UrlDecode(encodedIv);
  const ciphertext = base64UrlDecode(encodedCiphertext);
  const tag = base64UrlDecode(encodedTag);

  // Unwrap the CEK
  const cek = await unwrapCEK(wrappedKey, derivedKey, encConfig);

  let decrypted: Uint8Array;

  // Decrypt based on encryption type
  if (encConfig.type === "gcm") {
    decrypted = await decryptGCM(
      ciphertext,
      tag,
      cek as CryptoKey,
      iv,
      textEncoder.encode(encodedHeader),
    );
  } else {
    // TODO: CBC decryption
    throw new Error(`Unsupported encryption type: ${(encConfig as any).type}`);
  }

  // Return the decrypted data
  return textOutput ? textDecoder.decode(decrypted) : decrypted;
}

// Base64 URL encoding function
export function base64UrlEncode(data: Uint8Array): string {
  return btoa(String.fromCharCode(...data))
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

// Base64 URL decoding function
export function base64UrlDecode(str: string): Uint8Array {
  if (!str) {
    return new Uint8Array(0);
  }
  str = str.replace(/-/g, "+").replace(/_/g, "/");
  while (str.length % 4) str += "=";
  return new Uint8Array([...atob(str)].map((c) => c.charCodeAt(0)));
}

// Generate a random Uint8Array of specified length
function randomBytes(length: number): Uint8Array {
  return getRandomValues(new Uint8Array(length));
}

/**
 * Derives a key from a password using PBKDF2
 * @param password The password to derive the key from
 * @param saltInput Salt input for key derivation
 * @param iterations Number of iterations for key derivation
 * @param alg Key wrapping algorithm
 * @returns Promise resolving to the derived CryptoKey
 */
async function deriveKeyFromPassword(
  password: string | Uint8Array,
  saltInput: Uint8Array,
  iterations: number,
  alg: KeyWrappingAlgorithmType,
): Promise<CryptoKey> {
  if (!password) {
    throw new Error("Missing password");
  }

  const algConfig = validateKeyWrappingAlgorithm(alg);

  const baseKey = await subtle.importKey(
    "raw",
    typeof password === "string" ? textEncoder.encode(password) : password,
    { name: "PBKDF2" },
    false,
    ["deriveKey"],
  );

  // Prepare the salt with algorithm prefix
  const salt = concatUint8Arrays(
    textEncoder.encode(alg),
    new Uint8Array([0]),
    saltInput,
  );

  return subtle.deriveKey(
    {
      name: "PBKDF2",
      hash: algConfig.hash,
      salt,
      iterations,
    },
    baseKey,
    { name: "AES-KW", length: algConfig.keyLength },
    false,
    ["wrapKey", "unwrapKey"],
  );
}

/**
 * Concatenates multiple Uint8Arrays
 * @param arrays Arrays to concatenate
 * @returns Concatenated array
 */
function concatUint8Arrays(...arrays: Uint8Array[]): Uint8Array {
  const totalLength = arrays.reduce((length, arr) => length + arr.length, 0);
  const result = new Uint8Array(totalLength);

  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }

  return result;
}

/**
 * Validates and returns information about a key wrapping algorithm
 * @param alg The key wrapping algorithm to validate
 * @returns The algorithm configuration
 * @throws Error if the algorithm is not supported
 */
function validateKeyWrappingAlgorithm(alg: string) {
  const config = KEY_WRAPPING_ALGORITHMS[alg as KeyWrappingAlgorithmType];
  if (!config) {
    throw new Error(`Unsupported key wrapping algorithm: ${alg}`);
  }
  return { alg, ...config };
}

/**
 * Validates and returns information about a content encryption algorithm
 * @param enc The content encryption algorithm to validate
 * @returns The algorithm configuration
 * @throws Error if the algorithm is not supported
 */
function validateContentEncryptionAlgorithm(enc: string) {
  const config =
    CONTENT_ENCRYPTION_ALGORITHMS[enc as ContentEncryptionAlgorithmType];
  if (!config) {
    throw new Error(`Unsupported content encryption algorithm: ${enc}`);
  }
  return { enc, ...config };
}

/**
 * Generates and wraps a content encryption key
 * @param derivedKey Key used for wrapping
 * @param encConfig Encryption configuration
 * @returns Promise resolving to the wrapped key and the raw CEK
 */
async function generateAndWrapCEK(
  derivedKey: CryptoKey,
  encConfig: (typeof CONTENT_ENCRYPTION_ALGORITHMS)[ContentEncryptionAlgorithmType],
): Promise<{
  wrappedKey: ArrayBuffer;
  rawCek: Uint8Array | null;
  cek: CryptoKey;
}> {
  if (encConfig.type === "gcm") {
    // For GCM, use the WebCrypto API to generate a key
    const cek = await subtle.generateKey(
      { name: "AES-GCM", length: encConfig.keyLength },
      true,
      ["encrypt", "decrypt", "wrapKey", "unwrapKey"],
    );

    // Wrap the key
    const wrappedKey = await subtle.wrapKey("raw", cek, derivedKey, {
      name: "AES-KW",
    });

    return { wrappedKey, rawCek: null, cek };
  }

  // TODO: CBC key generation

  throw new Error(`Unsupported encryption type: ${(encConfig as any).type}`);
}

/**
 * Unwraps a content encryption key
 * @param wrappedKey The wrapped key to unwrap
 * @param derivedKey Key used for unwrapping
 * @param encConfig Encryption configuration
 * @returns Promise resolving to the unwrapped key
 */
async function unwrapCEK(
  wrappedKey: Uint8Array,
  derivedKey: CryptoKey,
  encConfig: (typeof CONTENT_ENCRYPTION_ALGORITHMS)[ContentEncryptionAlgorithmType],
): Promise<CryptoKey | Uint8Array> {
  if (encConfig.type === "gcm") {
    // For GCM, unwrap to AES-GCM key
    return subtle.unwrapKey(
      "raw",
      wrappedKey,
      derivedKey,
      { name: "AES-KW" },
      { name: "AES-GCM", length: encConfig.keyLength },
      false,
      ["decrypt"],
    );
  }

  // TODO: CBC unwrapping

  throw new Error(`Unsupported encryption type: ${(encConfig as any).type}`);
}

/**
 * Performs GCM encryption
 * @param plaintext Data to encrypt
 * @param cek Content encryption key
 * @param iv Initialization vector
 * @param aad Additional authenticated data
 * @param encConfig Encryption configuration
 * @returns Promise resolving to encrypted data with tag
 */
async function encryptGCM(
  plaintext: Uint8Array,
  cek: CryptoKey,
  iv: Uint8Array,
  aad: Uint8Array,
  encConfig: (typeof CONTENT_ENCRYPTION_ALGORITHMS)[ContentEncryptionAlgorithmType],
): Promise<{ ciphertext: Uint8Array; tag: Uint8Array }> {
  const ciphertext = await subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
      additionalData: aad,
    },
    cek,
    plaintext,
  );

  const encrypted = new Uint8Array(ciphertext);
  const tag = encrypted.slice(-encConfig.tagLength);
  const ciphertextOutput = encrypted.slice(0, -encConfig.tagLength);

  return { ciphertext: ciphertextOutput, tag };
}

/**
 * Performs GCM decryption
 * @param ciphertext Encrypted data
 * @param tag Authentication tag
 * @param cek Content encryption key
 * @param iv Initialization vector
 * @param aad Additional authenticated data
 * @returns Promise resolving to decrypted data
 */
async function decryptGCM(
  ciphertext: Uint8Array,
  tag: Uint8Array,
  cek: CryptoKey,
  iv: Uint8Array,
  aad: Uint8Array,
): Promise<Uint8Array> {
  // Combine ciphertext and authentication tag
  const encryptedData = concatUint8Arrays(ciphertext, tag);

  // Decrypt the data
  const decrypted = await subtle.decrypt(
    {
      name: "AES-GCM",
      iv,
      additionalData: aad,
    },
    cek,
    encryptedData,
  );

  return new Uint8Array(decrypted);
}
