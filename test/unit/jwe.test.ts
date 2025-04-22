import { describe, it, expect, assert } from "vitest";
import * as JWE from "../../src/utils/internal/jwe";

const testObject = JSON.stringify({ a: 1, b: 2, c: [3, 4, 5], d: { e: "f" } });
const password = "some_not_random_password_that_is_also_long_enough";

describe("JWE", () => {
  it("seals and unseals data correctly", async () => {
    const sealed = await JWE.seal(testObject, password);
    const unsealed = await JWE.unseal(sealed, password);
    assert.equal(unsealed, testObject);
  });

  it("should accept Uint8Array as password", async () => {
    const sealed = await JWE.seal(
      testObject,
      new TextEncoder().encode(password),
    );
    const unsealed = await JWE.unseal(
      sealed,
      new TextEncoder().encode(password),
    );
    assert.equal(unsealed, testObject);
  });

  it("should reject if missing password", async () => {
    await expect(JWE.seal(testObject, "")).rejects.toThrow();
    await expect(JWE.unseal("", "")).rejects.toThrow();
  });

  it("seals and unseals primitive values correctly", async () => {
    // Test with string
    const stringValue = "Just a simple string";
    const sealedString = await JWE.seal(stringValue, password);
    const unsealedString = await JWE.unseal(sealedString, password);
    assert.equal(unsealedString, stringValue);

    // Test with numbers and other types (need to be stringified first)
    const numberValue = "12345"; // As string
    const sealedNumber = await JWE.seal(numberValue, password);
    const unsealedNumber = await JWE.unseal(sealedNumber, password);
    assert.equal(unsealedNumber, numberValue);

    // Test with boolean as string
    const boolValue = "true"; // As string
    const sealedBool = await JWE.seal(boolValue, password);
    const unsealedBool = await JWE.unseal(sealedBool, password);
    assert.equal(unsealedBool, boolValue);

    // Test with null as string
    const nullValue = "null"; // As string
    const sealedNull = await JWE.seal(nullValue, password);
    const unsealedNull = await JWE.unseal(sealedNull, password);
    assert.equal(unsealedNull, nullValue);
  });

  it("works with Uint8Array data", async () => {
    const uint8Data = new TextEncoder().encode("Hello, world!");
    const sealed = await JWE.seal(uint8Data, password);
    const unsealed = await JWE.unseal(sealed, password, { textOutput: false });

    // Compare byte arrays
    assert.instanceOf(unsealed, Uint8Array);
    assert.equal(
      new TextDecoder().decode(unsealed as Uint8Array),
      "Hello, world!",
    );
  });

  it("rejects invalid passwords", async () => {
    const sealed = await JWE.seal(testObject, password);

    await expect(JWE.unseal(sealed, "wrong_password")).rejects.toThrow();
  });

  it("rejects invalid JWE formats", async () => {
    await expect(JWE.unseal("invalid.jwe.token", password)).rejects.toThrow();

    await expect(
      JWE.unseal("part1.part2.part3.part4.part5.extrastuff", password),
    ).rejects.toThrow();
  });

  it("rejects tampered tokens", async () => {
    const sealed = await JWE.seal(testObject, password);
    const parts = sealed.split(".");

    // Tamper with the ciphertext
    const tamperedSeal = [
      parts[0],
      parts[1],
      parts[2],
      parts[3] + "x", // tamper with ciphertext
      parts[4],
    ].join(".");

    await expect(JWE.unseal(tamperedSeal, password)).rejects.toThrow();

    // Tamper with the tag
    const tamperedTag = [
      parts[0],
      parts[1],
      parts[2],
      parts[3],
      parts[4] + "x", // tamper with tag
    ].join(".");

    await expect(JWE.unseal(tamperedTag, password)).rejects.toThrow();
  });

  it("rejects unsupported algorithms", async () => {
    await expect(
      JWE.seal(testObject, password, {
        protectedHeader: { enc: "A128CBC-HS256" },
      }),
    ).rejects.toThrow("Unsupported encryption type: cbc");

    const sealed = await JWE.seal(testObject, password);
    const parts = sealed.split(".");
    const header = JSON.parse(
      atob(parts[0].replace(/-/g, "+").replace(/_/g, "/")),
    );

    // Create a header with unsupported algorithm
    const invalidAlgHeader = JWE.base64UrlEncode(
      new TextEncoder().encode(
        JSON.stringify({
          ...header,
          alg: "PBES2-HS384+A192KW",
          enc: "A128CBC-HS256",
        }),
      ),
    );

    const invalidAlgJWE = [
      invalidAlgHeader,
      parts[1],
      parts[2],
      parts[3],
      parts[4],
    ].join(".");

    await expect(JWE.unseal(invalidAlgJWE, password)).rejects.toThrow(
      "Unsupported encryption type: cbc",
    );
  });

  it("handles complex nested objects as strings", async () => {
    const complexObj = JSON.stringify({
      array: [1, 2, 3, 4, 5],
      nested: {
        a: { b: { c: { d: { e: "deep" } } } },
        arr: [
          [1, 2],
          [3, 4],
        ],
      },
      date: new Date().toISOString(),
      nullValue: null,
      booleans: [true, false],
    });

    const sealed = await JWE.seal(complexObj, password);
    const unsealed = await JWE.unseal(sealed, password);
    assert.equal(unsealed, complexObj);
  });

  it("handles empty strings", async () => {
    const sealed = await JWE.seal("", password);
    const unsealed = await JWE.unseal(sealed, password);
    assert.equal(unsealed, "");
  });

  it("supports custom headers", async () => {
    const options = {
      protectedHeader: {
        kid: "test-key-id",
        customHeader: "custom-value",
      },
    };

    const sealed = await JWE.seal(testObject, password, options);
    const parts = sealed.split(".");

    // Decode the header to verify it contains our custom values
    const headerJson = atob(parts[0].replace(/-/g, "+").replace(/_/g, "/"));
    const header = JSON.parse(headerJson);

    assert.equal(header.kid, "test-key-id");
    assert.equal(header.customHeader, "custom-value");

    // Verify we can still decrypt with the custom headers
    const unsealed = await JWE.unseal(sealed, password);
    assert.equal(unsealed, testObject);
  });

  it("allows changing iteration count", async () => {
    const options = {
      iterations: 1024, // Lower iterations for testing
    };

    const sealed = await JWE.seal(testObject, password, options);
    const unsealed = await JWE.unseal(sealed, password);
    assert.equal(unsealed, testObject);
  });

  it("allows changing salt size", async () => {
    const options = {
      saltSize: 32, // Larger salt size
    };

    const sealed = await JWE.seal(testObject, password, options);
    const unsealed = await JWE.unseal(sealed, password);
    assert.equal(unsealed, testObject);
  });

  // Add tests focusing on the remaining uncovered lines

  // Test error paths in seal/unseal functions
  it("handles explicit type errors in seal and unseal", async () => {
    // Test with explicitly unsupported encryption type to hit lines 192-193
    await expect(
      JWE.seal(testObject, password, {
        protectedHeader: {
          enc: "unsupported-enc" as any,
        },
      }),
    ).rejects.toThrow("Unsupported content encryption algorithm");

    // Test with explicitly unsupported alg type to hit related branches
    await expect(
      JWE.seal(testObject, password, {
        protectedHeader: {
          alg: "unsupported-alg" as any,
        },
      }),
    ).rejects.toThrow("Unsupported key wrapping algorithm");

    // Create a token with malformed parts to hit lines 317-318
    const sealed = await JWE.seal(testObject, password);
    const parts = sealed.split(".");

    // Corrupt header to force JSON parsing error
    const corruptedToken = [
      "invalid-base64", // Invalid base64 to trigger decode error
      parts[1],
      parts[2],
      parts[3],
      parts[4],
    ].join(".");

    await expect(JWE.unseal(corruptedToken, password)).rejects.toThrow();
  });

  // Test edge cases for randomBytes and encoding functions
  it("handles edge cases in encoding and randomness", async () => {
    // Test with zero-length input to various internal functions
    const emptyData = new Uint8Array(0);
    const sealed = await JWE.seal(emptyData, password);
    const unsealed = await JWE.unseal(sealed, password, { textOutput: false });
    assert.equal(unsealed.length, 0);

    // Test with very small and specific lengths to hit edge cases
    for (const length of [1, 2, 3, 4, 5]) {
      const smallData = new Uint8Array(length).fill(1);
      const smallSealed = await JWE.seal(smallData, password);
      const smallUnsealed = await JWE.unseal(smallSealed, password, {
        textOutput: false,
      });
      assert.equal(smallUnsealed.length, length);
    }
  });

  // Test function parameter variations to catch edge cases
  it("tests all parameter variations thoroughly", async () => {
    // Test that options are properly propagated to internal functions
    // This covers lines 435-436, 472-473 by ensuring all paths in validation are hit

    // Test with empty options object
    const sealed1 = await JWE.seal(testObject, password, {});
    const unsealed1 = await JWE.unseal(sealed1, password);
    assert.equal(unsealed1, testObject);

    // Test with only protectedHeader but no alg/enc specified
    const sealed2 = await JWE.seal(testObject, password, {
      protectedHeader: { kid: "test-key" },
    });
    const unsealed2 = await JWE.unseal(sealed2, password);
    assert.equal(unsealed2, testObject);

    // Test with exactly minimum iteration count
    const sealed3 = await JWE.seal(testObject, password, {
      iterations: 1,
    });
    const unsealed3 = await JWE.unseal(sealed3, password);
    assert.equal(unsealed3, testObject);
  });

  // Test error cases in encryption/decryption to hit lines 502-503
  it("tests error cases in crypto operations", async () => {
    // Test with malformed wrapped key
    const sealed = await JWE.seal(testObject, password);
    const parts = sealed.split(".");

    // Replace encrypted key with something too short
    const badKeyToken = [
      parts[0],
      "Q", // Very short invalid key
      parts[2],
      parts[3],
      parts[4],
    ].join(".");

    await expect(JWE.unseal(badKeyToken, password)).rejects.toThrow();

    // Test with malformed IV
    const badIVToken = [
      parts[0],
      parts[1],
      "a", // Invalid IV
      parts[3],
      parts[4],
    ].join(".");

    await expect(JWE.unseal(badIVToken, password)).rejects.toThrow();
  });

  // Test with different key lengths and algorithm combinations
  it("tests all supported algorithm combinations", async () => {
    const algOptions = [
      "PBES2-HS256+A128KW",
      "PBES2-HS384+A192KW",
      "PBES2-HS512+A256KW",
    ] as const;
    const encOptions = ["A128GCM", "A192GCM", "A256GCM"] as const;

    // Test every combination of alg and enc
    for (const alg of algOptions) {
      for (const enc of encOptions) {
        const sealed = await JWE.seal(testObject, password, {
          protectedHeader: { alg, enc },
        });
        const unsealed = await JWE.unseal(sealed, password);
        assert.equal(unsealed, testObject);
      }
    }
  });

  // Test different input data types and encodings
  it("handles all input data types correctly", async () => {
    // Test with ArrayBuffer
    const buffer = new ArrayBuffer(16);
    const view = new Uint8Array(buffer);
    for (let i = 0; i < view.length; i++) view[i] = i;

    const sealed = await JWE.seal(view, password);
    const unsealed = await JWE.unseal(sealed, password, { textOutput: false });
    assert.instanceOf(unsealed, Uint8Array);

    // Test with non-UTF8 data
    const nonUtf8 = new Uint8Array([0xff, 0xfe, 0xfd, 0xfc]);
    const sealedBinary = await JWE.seal(nonUtf8, password);
    const unsealedBinary = await JWE.unseal(sealedBinary, password, {
      textOutput: false,
    });
    assert.instanceOf(unsealedBinary, Uint8Array);
    assert.equal((unsealedBinary as Uint8Array).length, nonUtf8.length);

    // Test with Uint8Array of exactly the block size
    const blockSized = new Uint8Array(16); // AES block size
    blockSized.fill(1);
    const sealedBlock = await JWE.seal(blockSized, password);
    const unsealedBlock = await JWE.unseal(sealedBlock, password, {
      textOutput: false,
    });
    assert.equal((unsealedBlock as Uint8Array).length, blockSized.length);
  });

  // Test password handling edge cases
  it("tests password handling edge cases", async () => {
    // Test with password that's exactly a Uint8Array
    const binaryPassword = new Uint8Array(32);
    for (let i = 0; i < binaryPassword.length; i++) binaryPassword[i] = i + 1;

    const sealed = await JWE.seal(testObject, binaryPassword);
    const unsealed = await JWE.unseal(sealed, binaryPassword);
    assert.equal(unsealed, testObject);

    // Test with very short valid password
    const shortPassword = "x";
    const sealedShort = await JWE.seal(testObject, shortPassword);
    const unsealedShort = await JWE.unseal(sealedShort, shortPassword);
    assert.equal(unsealedShort, testObject);
  });

  // Test special cases for base64 encoding/decoding
  it("tests base64 encoding edge cases", async () => {
    // Test with data that would produce different padding lengths
    for (let i = 0; i < 5; i++) {
      const testData = new Uint8Array(i);
      testData.fill(0xff);

      const sealed = await JWE.seal(testData, password);
      const unsealed = await JWE.unseal(sealed, password, {
        textOutput: false,
      });

      assert.equal((unsealed as Uint8Array).length, i);
    }
  });
});
