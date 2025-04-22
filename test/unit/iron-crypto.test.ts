/**
Based on https://github.com/brc-dd/iron-webcrypto/tree/v1.2.1
Copyright (c) 2021 Divyansh Singh.
https://github.com/brc-dd/iron-webcrypto/blob/v1.2.1/LICENSE.md
*/

import { describe, it, assert, expect, vi } from "vitest";
import { createHmac } from "node:crypto";
import * as Iron from "../../src/utils/internal/iron-crypto.ts";
import { base64Encode } from "../../src/utils/internal/encoding.ts";

async function rejects(
  promise: Promise<unknown>,
  msgIncludes: string | RegExp,
): Promise<void> {
  return expect(promise).rejects.toThrow(msgIncludes);
}

const obj = { a: 1, b: 2, c: [3, 4, 5], d: { e: "f" } };
const password = "some_not_random_password_that_is_also_long_enough";

describe(`iron crypto`, () => {
  it("turns object into a ticket than parses the ticket successfully", async () => {
    const sealed = await Iron.seal(obj, password, Iron.defaults);
    const unsealed = await Iron.unseal(
      sealed,
      { default: password },
      Iron.defaults,
    );
    assert.deepEqual(unsealed, obj);
  });

  // TODO: Mocking Buffer makes randomly vite internals fail
  it.skip("turns object into a ticket than parses the ticket successfully (no buffer)", async () => {
    vi.stubGlobal("Buffer", undefined);
    const sealed = await Iron.seal(obj, password, Iron.defaults);
    const unsealed = await Iron.unseal(
      sealed,
      { default: password },
      Iron.defaults,
    );
    vi.unstubAllGlobals();
    assert.deepEqual(unsealed, obj);
  });

  it("unseal and sealed object with expiration", async () => {
    const options = { ...Iron.defaults, ttl: 200 };
    const sealed = await Iron.seal(obj, password, options);
    const unsealed = await Iron.unseal(
      sealed,
      { default: password },
      Iron.defaults,
    );
    assert.deepEqual(unsealed, obj);
  });

  it("unseal and sealed object with expiration and time offset", async () => {
    // prettier-ignore
    const options = { ...Iron.defaults, ttl: 200, localtimeOffsetMsec: -100_000 };
    const sealed = await Iron.seal(obj, password, options);

    const options2 = { ...Iron.defaults, localtimeOffsetMsec: -100_000 };
    const unsealed = await Iron.unseal(sealed, { default: password }, options2);
    assert.deepEqual(unsealed, obj);
  });

  it("unseal and sealed object without time offset", async () => {
    const options = { ...Iron.defaults, ttl: 200, localtimeOffsetMsec: 0 };
    const sealed = await Iron.seal(obj, password, options);

    const options2 = { ...Iron.defaults, localtimeOffsetMsec: 0 };
    const unsealed = await Iron.unseal(sealed, { default: password }, options2);
    assert.deepEqual(unsealed, obj);
  });

  it("turns object into a ticket than parses the ticket successfully (password buffer)", async () => {
    const key = Iron.randomBits(256);
    const sealed = await Iron.seal(obj, key, Iron.defaults);
    const unsealed = await Iron.unseal(sealed, key, Iron.defaults);
    assert.deepEqual(unsealed, obj);
  });

  it("turns object into a ticket than parses the ticket successfully (password buffer in object)", async () => {
    const key = Iron.randomBits(256);
    const sealed = await Iron.seal(obj, key, Iron.defaults);
    const unsealed = await Iron.unseal(sealed, { default: key }, Iron.defaults);
    assert.deepEqual(unsealed, obj);
  });

  it("fails to turns object into a ticket (password buffer too short)", async () => {
    const key = Iron.randomBits(128);
    await rejects(
      Iron.seal(obj, key, Iron.defaults),
      "Key buffer (password) too small",
    );
  });

  it("fails to turn object into a ticket (failed to stringify object)", async () => {
    const cyclic: unknown[] = [];
    cyclic[0] = cyclic;
    const key = Iron.randomBits(128);
    await rejects(
      Iron.seal(cyclic, key, Iron.defaults),
      "Converting circular structure to JSON",
    );
  });

  it("turns object into a ticket than parses the ticket successfully (password object)", async () => {
    const sealed = await Iron.seal(
      obj,
      { id: "1", secret: password },
      Iron.defaults,
    );
    const unsealed = await Iron.unseal(
      sealed,
      { "1": password },
      Iron.defaults,
    );
    assert.deepEqual(unsealed, obj);
  });

  it("handles separate password buffers (password object)", async () => {
    const key = {
      id: "1",
      encryption: Iron.randomBits(256),
      integrity: Iron.randomBits(256),
    };
    const sealed = await Iron.seal(obj, key, Iron.defaults);
    const unsealed = await Iron.unseal(sealed, { "1": key }, Iron.defaults);
    assert.deepEqual(unsealed, obj);
  });

  it("handles a common password buffer (password object)", async () => {
    const key = { id: "1", secret: Iron.randomBits(256) };
    const sealed = await Iron.seal(obj, key, Iron.defaults);
    const unsealed = await Iron.unseal(sealed, { "1": key }, Iron.defaults);
    assert.deepEqual(unsealed, obj);
  });

  it("fails to parse a sealed object when password not found", async () => {
    const sealed = await Iron.seal(
      obj,
      { id: "1", secret: password },
      Iron.defaults,
    );
    await rejects(
      Iron.unseal(sealed, { "2": password }, Iron.defaults),
      "Cannot find password: 1",
    );
  });

  describe("generateKey()", () => {
    it("returns an error when password is missing", async () => {
      await rejects(
        Iron.generateKey(null as any, null as any),
        "Empty password",
      );
    });

    it("returns an error when password is too short", async () => {
      await rejects(
        Iron.generateKey("password", Iron.defaults.encryption),
        "Password string too short (min 32 characters required)",
      );
    });

    it("returns an error when options are missing", async () => {
      await rejects(Iron.generateKey(password, null as any), "Bad options");

      await rejects(Iron.generateKey(password, "abc" as any), "Bad options");
    });

    it("returns an error when an unknown algorithm is specified", async () => {
      await rejects(
        Iron.generateKey(password, { algorithm: "unknown" } as any),
        "Unknown algorithm: unknown",
      );
    });

    it("returns an error when no salt and no salt bits are provided", async () => {
      const options = {
        algorithm: "sha256" as const,
        iterations: 2,
        minPasswordlength: 32,
      };
      await rejects(
        Iron.generateKey(password, options),
        "Missing salt and saltBits options",
      );
    });

    it("returns an error when invalid salt bits are provided", async () => {
      const options = {
        saltBits: 999_999_999_999_999,
        algorithm: "sha256" as const,
        iterations: 2,
        minPasswordlength: 32,
      };
      await rejects(
        Iron.generateKey(password, options),
        /Invalid typed array length|Array buffer allocation failed/,
      );
    });
  });

  describe("encrypt()", () => {
    it("returns an error when password is missing", async () => {
      await rejects(
        Iron.encrypt(null as any, null as any, "data"),
        "Empty password",
      );
    });
  });

  describe("decrypt", () => {
    it("returns an error when password is missing", async () => {
      await rejects(
        Iron.decrypt(null as any, null as any, "data"),
        "Empty password",
      );
    });
  });

  describe("hmacWithPassword()", () => {
    it("returns an error when password is missing", async () => {
      await rejects(
        Iron.hmacWithPassword(null as any, null as any, "data"),
        "Empty password",
      );
    });

    if (createHmac)
      it("produces the same mac when used with buffer password", async () => {
        const data = "Not so random";
        const key = Iron.randomBits(256);
        const hmac = createHmac(Iron.defaults.integrity.algorithm, key).update(
          data,
        );
        const digest = base64Encode(hmac.digest());
        const mac = await Iron.hmacWithPassword(
          key,
          Iron.defaults.integrity,
          data,
        );
        assert.deepEqual(mac.digest, digest);
      });
  });

  describe("seal()", () => {
    it("returns an error when password is missing", async () => {
      await rejects(
        Iron.seal("data", null as any, Iron.defaults),
        "Empty password",
      );
    });

    it("returns an error when integrity options are missing", async () => {
      const options = {
        ...Iron.defaults,
        integrity: {} as any,
      };
      await rejects(
        Iron.seal("data", password, options),
        "Unknown algorithm: undefined",
      );
    });

    it("returns an error when password.id is invalid", async () => {
      await rejects(
        Iron.seal("data", { id: "asd$", secret: "asd" }, Iron.defaults),
        "Invalid password id",
      );
    });
  });

  describe("unseal()", () => {
    it("unseals a ticket", async () => {
      const ticket =
        "Fe26.2**0cdd607945dd1dffb7da0b0bf5f1a7daa6218cbae14cac51dcbd91fb077aeb5b*aOZLCKLhCt0D5IU1qLTtYw*g0ilNDlQ3TsdFUqJCqAm9iL7Wa60H7eYcHL_5oP136TOJREkS3BzheDC1dlxz5oJ**05b8943049af490e913bbc3a2485bee2aaf7b823f4c41d0ff0b7c168371a3772*R8yscVdTBRMdsoVbdDiFmUL8zb-c3PQLGJn4Y8C-AqI";
      const unsealed = await Iron.unseal(ticket, password, Iron.defaults);
      assert.deepEqual(unsealed, obj);
    });

    it("unseals a aes-128-ctr ticket", async () => {
      const ticket =
        "Fe26.2**63c87cc87254b834dbb13cc62abc8713d1da035a9b38f54e5d5795135e217167*TpIsHHn-7txnl14Or7-D6A*HFGMGpcTRPUBSTQobuo27KOZ76MhVWgOsjA5SkFoy3vyqaHuixbd**3c8c403569a744a39c58adfb81e654f6860cb01f145488313e1895276e719f52*d5J1jY3WxP61klQza6q7zTqiYpjWPwocqHmjtDcSeq0";
      const options = {
        ...Iron.defaults,
        encryption: {
          ...Iron.defaults.encryption,
          algorithm: "aes-128-ctr" as any,
        },
      };
      const unsealed = await Iron.unseal(ticket, password, options);
      assert.deepEqual(unsealed, obj);
    });

    it("returns an error when number of sealed components is wrong", async () => {
      const ticket =
        "x*Fe26.2**a6dc6339e5ea5dfe7a135631cf3b7dcf47ea38246369d45767c928ea81781694*D3DLEoi-Hn3c972TPpZXqw*mCBhmhHhRKk9KtBjwu3h-1lx1MHKkgloQPKRkQZxpnDwYnFkb3RqdVTQRcuhGf4M**ff2bf988aa0edf2b34c02d220a45c4a3c572dac6b995771ed20de58da919bfa5*HfWzyJlz_UP9odmXvUaVK1TtdDuOCaezr-TAg2GjBCU";
      await rejects(
        Iron.unseal(ticket, password, Iron.defaults),
        "Incorrect number of sealed components",
      );
    });

    it("returns an error when password is missing", async () => {
      const ticket =
        "Fe26.2**a6dc6339e5ea5dfe7a135631cf3b7dcf47ea38246369d45767c928ea81781694*D3DLEoi-Hn3c972TPpZXqw*mCBhmhHhRKk9KtBjwu3h-1lx1MHKkgloQPKRkQZxpnDwYnFkb3RqdVTQRcuhGf4M**ff2bf988aa0edf2b34c02d220a45c4a3c572dac6b995771ed20de58da919bfa5*HfWzyJlz_UP9odmXvUaVK1TtdDuOCaezr-TAg2GjBCU";

      await rejects(
        Iron.unseal(ticket, null as any, Iron.defaults),
        "Empty password",
      );
    });

    it("returns an error when mac prefix is wrong", async () => {
      const ticket =
        "Fe27.2**a6dc6339e5ea5dfe7a135631cf3b7dcf47ea38246369d45767c928ea81781694*D3DLEoi-Hn3c972TPpZXqw*mCBhmhHhRKk9KtBjwu3h-1lx1MHKkgloQPKRkQZxpnDwYnFkb3RqdVTQRcuhGf4M**ff2bf988aa0edf2b34c02d220a45c4a3c572dac6b995771ed20de58da919bfa5*HfWzyJlz_UP9odmXvUaVK1TtdDuOCaezr-TAg2GjBCU";
      await rejects(
        Iron.unseal(ticket, password, Iron.defaults),
        "Wrong mac prefix",
      );
    });

    it("returns an error when integrity check fails", async () => {
      const ticket =
        "Fe26.2**b3ad22402ccc60fa4d527f7d1c9ff2e37e9b2e5723e9e2ffba39a489e9849609*QKCeXLs6Rp7f4LL56V7hBg*OvZEoAq_nGOpA1zae-fAtl7VNCNdhZhCqo-hWFCBeWuTTpSupJ7LxQqzSQBRAcgw**72018a21d3fac5c1608a0f9e461de0fcf17b2befe97855978c17a793faa01db1*Qj53DFE3GZd5yigt-mVl9lnp0VUoSjh5a5jgDmod1EZ";
      await rejects(
        Iron.unseal(ticket, password, Iron.defaults),
        "Bad hmac value",
      );
    });

    it("returns an error when decryption fails", async () => {
      const macBaseString =
        "Fe26.2**a6dc6339e5ea5dfe7a135631cf3b7dcf47ea38246369d45767c928ea81781694*D3DLEoi-Hn3c972TPpZXqw*mCBhmhHhRKk9KtBjwu3h-1lx1MHKkgloQPKRkQZxpnDwYnFkb3RqdVTQRcuhGf4M??*";
      const options: Iron.GenerateKeyOptions<Iron.IntegrityAlgorithm> = {
        ...Iron.defaults.integrity,
        salt: "ff2bf988aa0edf2b34c02d220a45c4a3c572dac6b995771ed20de58da919bfa5",
      };
      const mac = await Iron.hmacWithPassword(password, options, macBaseString);
      const ticket = `${macBaseString}*${mac.salt}*${mac.digest}`;
      await rejects(
        Iron.unseal(ticket, password, Iron.defaults),
        /Invalid character|The operation failed for an operation-specific reason/,
      );
    });

    it("returns an error when iv base64 decoding fails", async () => {
      const macBaseString =
        "Fe26.2**a6dc6339e5ea5dfe7a135631cf3b7dcf47ea38246369d45767c928ea81781694*D3DLEoi-Hn3c972TPpZXqw??*mCBhmhHhRKk9KtBjwu3h-1lx1MHKkgloQPKRkQZxpnDwYnFkb3RqdVTQRcuhGf4M*";
      const options: Iron.GenerateKeyOptions<Iron.IntegrityAlgorithm> = {
        ...Iron.defaults.integrity,
        salt: "ff2bf988aa0edf2b34c02d220a45c4a3c572dac6b995771ed20de58da919bfa5",
      };
      const mac = await Iron.hmacWithPassword(password, options, macBaseString);
      const ticket = `${macBaseString}*${mac.salt}*${mac.digest}`;
      await rejects(
        Iron.unseal(ticket, password, Iron.defaults),
        /Invalid character|The operation failed for an operation-specific reason/,
      );
    });

    it("returns an error when decrypted object is invalid", async () => {
      const badJson = "{asdasd";
      const { encrypted, key } = await Iron.encrypt(
        password,
        Iron.defaults.encryption,
        badJson,
      );
      const encryptedB64 = base64Encode(encrypted);
      const iv = base64Encode(key.iv);
      const macBaseString = `${Iron.macPrefix}**${key.salt}*${iv}*${encryptedB64}*`;
      const mac = await Iron.hmacWithPassword(
        password,
        Iron.defaults.integrity,
        macBaseString,
      );
      const ticket = `${macBaseString}*${mac.salt}*${mac.digest}`;
      await rejects(
        Iron.unseal(ticket, password, Iron.defaults),
        /Expected property name or '}' in JSON at position 1|Unexpected token a in JSON at position 1/,
      );
    });

    it("returns an error when expired", async () => {
      const macBaseString =
        "Fe26.2**a38dc7a7bf2f8ff650b103d8c669d76ad219527fbfff3d98e3b30bbecbe9bd3b*nTsatb7AQE1t0uMXDx-2aw*uIO5bRFTwEBlPC1Nd_hfSkZfqxkxuY1EO2Be_jJPNQCqFNumRBjQAl8WIKBW1beF*1380495854060";
      const options: Iron.GenerateKeyOptions<Iron.IntegrityAlgorithm> = {
        ...Iron.defaults.integrity,
        salt: "e4fe33b6dc4c7ef5ad7907f015deb7b03723b03a54764aceeb2ab1235cc8dce3",
      };
      const mac = await Iron.hmacWithPassword(password, options, macBaseString);
      const ticket = `${macBaseString}*${mac.salt}*${mac.digest}`;
      await rejects(
        Iron.unseal(ticket, password, Iron.defaults),
        "Expired seal",
      );
    });

    it("returns an error when expiration NaN", async () => {
      const macBaseString =
        "Fe26.2**a38dc7a7bf2f8ff650b103d8c669d76ad219527fbfff3d98e3b30bbecbe9bd3b*nTsatb7AQE1t0uMXDx-2aw*uIO5bRFTwEBlPC1Nd_hfSkZfqxkxuY1EO2Be_jJPNQCqFNumRBjQAl8WIKBW1beF*a";
      const options: Iron.GenerateKeyOptions<Iron.IntegrityAlgorithm> = {
        ...Iron.defaults.integrity,
        salt: "e4fe33b6dc4c7ef5ad7907f015deb7b03723b03a54764aceeb2ab1235cc8dce3",
        ivBits: 128,
      };
      const mac = await Iron.hmacWithPassword(password, options, macBaseString);
      const ticket = `${macBaseString}*${mac.salt}*${mac.digest}`;
      await rejects(
        Iron.unseal(ticket, password, Iron.defaults),
        "Invalid expiration",
      );
    });
  });
});
