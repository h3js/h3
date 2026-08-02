import type { SessionConfig } from "../src/utils/session.ts";
import { beforeEach, vi } from "vitest";
import { useSession, clearSession, readBody, H3 } from "../src/index.ts";
import { seal, unseal, defaults as sealDefaults } from "../src/utils/internal/iron-crypto.ts";
import { describeMatrix } from "./_setup.ts";

describeMatrix("session", (t, { it, expect }) => {
  let app: H3;

  let cookie = "";

  let sessionIdCtr = 0;
  const sessionConfig: SessionConfig = {
    name: "h3-test",
    password: "1234567123456712345671234567123456712345671234567",
    generateId: () => ++sessionIdCtr + "",
  };

  beforeEach(() => {
    app = new H3({});
    t.app.all("/", async (event) => {
      const session = await useSession(event, sessionConfig);
      if (event.req.method === "POST") {
        await session.update((await readBody(event)) as any);
      }
      return { session };
    });
    t.app.use(app.handler);
  });

  it("initiates session", async () => {
    const result = await t.fetch("/");
    expect(result.headers.getSetCookie()).toHaveLength(1);
    cookie = result.headers.getSetCookie()[0];
    expect(await result.json()).toMatchObject({
      session: { id: "1", data: {} },
    });
  });

  it("sets SameSite=Lax by default", async () => {
    const result = await t.fetch("/");
    expect(result.headers.getSetCookie()[0]).toContain("SameSite=Lax");
  });

  it("allows overriding SameSite via config.cookie", async () => {
    t.app.get("/strict", async (event) => {
      const session = await useSession(event, {
        ...sessionConfig,
        cookie: { sameSite: "strict" },
      });
      return { session };
    });
    const strict = await t.fetch("/strict");
    expect(strict.headers.getSetCookie()[0]).toContain("SameSite=Strict");

    t.app.get("/none", async (event) => {
      const session = await useSession(event, {
        ...sessionConfig,
        cookie: { sameSite: false },
      });
      return { session };
    });
    const none = await t.fetch("/none");
    expect(none.headers.getSetCookie()[0]).not.toContain("SameSite");
  });

  it("gets same session back", async () => {
    const result = await t.fetch("/", { headers: { Cookie: cookie } });
    expect(await result.json()).toMatchObject({
      session: { id: "1", data: {} },
    });
  });

  it("set session data", async () => {
    const result = await t.fetch("/", {
      method: "POST",
      headers: { Cookie: cookie },
      body: JSON.stringify({ foo: "bar" }),
    });
    cookie = result.headers.getSetCookie()[0];
    expect(await result.json()).toMatchObject({
      session: { id: "1", data: { foo: "bar" } },
    });

    const result2 = await t.fetch("/", { headers: { Cookie: cookie } });
    expect(await result2.json()).toMatchObject({
      session: { id: "1", data: { foo: "bar" } },
    });
  });

  it("gets same session back (concurrent)", async () => {
    app.get("/concurrent", async (event) => {
      const sessions = await Promise.all(
        [1, 2, 3].map(() =>
          useSession(event, sessionConfig).then((s) => ({
            id: s.id,
            data: s.data,
          })),
        ),
      );
      return {
        sessions,
      };
    });
    const result = await t.fetch("/concurrent", {
      headers: { Cookie: cookie },
    });
    expect(await result.json()).toMatchObject({
      sessions: [1, 2, 3].map(() => ({ id: "1", data: { foo: "bar" } })),
    });
  });

  it("clearSession sets maxAge=0 to delete cookie", async () => {
    t.app.get("/clear", async (event) => {
      await clearSession(event, sessionConfig);
      return { cleared: true };
    });
    const res = await t.fetch("/clear", {
      headers: { Cookie: cookie },
    });
    const cookies = res.headers.getSetCookie();
    expect(cookies.length).toBeGreaterThanOrEqual(1);
    expect(cookies[0]).toContain("Max-Age=0");
  });

  it("unseals and reseals legacy sessions sealed with iterations: 1", async () => {
    const legacySealed = await seal(
      { id: "legacy", createdAt: Date.now(), data: { foo: "legacy" } },
      sessionConfig.password,
      {
        ...sealDefaults,
        encryption: { ...sealDefaults.encryption, iterations: 1 },
        integrity: { ...sealDefaults.integrity, iterations: 1 },
      },
    );

    const result = await t.fetch("/", {
      headers: { Cookie: `h3-test=${legacySealed}` },
    });
    expect(await result.json()).toMatchObject({
      session: { id: "legacy", data: { foo: "legacy" } },
    });

    // Legacy cookie is transparently resealed with the current default
    const setCookies = result.headers.getSetCookie();
    expect(setCookies).toHaveLength(1);
    const resealed = decodeURIComponent(setCookies[0].match(/h3-test=([^;]+)/)![1]);
    expect(
      await unseal(resealed, sessionConfig.password, sealDefaults), // current iterations, no fallback
    ).toMatchObject({ id: "legacy", data: { foo: "legacy" } });
  });

  it("rejects legacy sessions with legacySealFallback: false", async () => {
    const legacySealed = await seal(
      { id: "legacy", createdAt: Date.now(), data: { foo: "legacy" } },
      sessionConfig.password,
      {
        ...sealDefaults,
        encryption: { ...sealDefaults.encryption, iterations: 1 },
        integrity: { ...sealDefaults.integrity, iterations: 1 },
      },
    );

    t.app.all("/strict", async (event) => {
      const session = await useSession(event, {
        ...sessionConfig,
        legacySealFallback: false,
      });
      return { session };
    });

    const result = await t.fetch("/strict", {
      headers: { Cookie: `h3-test=${legacySealed}` },
    });
    const body = await result.json();
    expect(body.session.id).not.toBe("legacy");
    expect(body.session.data).toEqual({});
  });

  it("autoReseal slides expiration for active sessions", async () => {
    const t0 = Date.parse("2030-01-01T00:00:00Z");
    vi.useFakeTimers({ toFake: ["Date"], now: t0 });
    try {
      let idCtr = 0;
      const config: SessionConfig = {
        name: "h3-ar",
        password: sessionConfig.password,
        maxAge: 60,
        autoReseal: true,
        generateId: () => `ar-${++idCtr}`,
      };
      t.app.get("/auto-reseal", async (event) => {
        const session = await useSession(event, config);
        return { id: session.id };
      });
      const arCookie = (res: Response) =>
        res.headers.getSetCookie().find((c) => c.startsWith("h3-ar="));

      // t=0: new session
      const res1 = await t.fetch("/auto-reseal");
      expect((await res1.json()).id).toBe("ar-1");
      let cookie = arCookie(res1)!;

      // t=45s: active request keeps the session and slides the cookie expiry
      vi.setSystemTime(t0 + 45_000);
      const res2 = await t.fetch("/auto-reseal", { headers: { Cookie: cookie } });
      expect((await res2.json()).id).toBe("ar-1");
      const resealed = arCookie(res2);
      expect(resealed).toBeDefined();
      expect(resealed).toContain(`Expires=${new Date(t0 + 45_000 + 60_000).toUTCString()}`);
      cookie = resealed!;

      // t=90s: past createdAt + maxAge, but only 45s idle — session survives
      vi.setSystemTime(t0 + 90_000);
      const res3 = await t.fetch("/auto-reseal", { headers: { Cookie: cookie } });
      expect((await res3.json()).id).toBe("ar-1");
    } finally {
      vi.useRealTimers();
    }
  });

  it("autoReseal still expires idle sessions", async () => {
    const t0 = Date.parse("2030-01-01T00:00:00Z");
    vi.useFakeTimers({ toFake: ["Date"], now: t0 });
    try {
      let idCtr = 0;
      const config: SessionConfig = {
        name: "h3-ar-idle",
        password: sessionConfig.password,
        maxAge: 60,
        autoReseal: true,
        generateId: () => `idle-${++idCtr}`,
      };
      t.app.get("/auto-reseal-idle", async (event) => {
        const session = await useSession(event, config);
        return { id: session.id };
      });

      const res1 = await t.fetch("/auto-reseal-idle");
      expect((await res1.json()).id).toBe("idle-1");
      const cookie = res1.headers.getSetCookie().find((c) => c.startsWith("h3-ar-idle="))!;

      // Idle past maxAge + the seal's 60s clock-skew allowance: session resets
      vi.setSystemTime(t0 + 121_000);
      const res2 = await t.fetch("/auto-reseal-idle", { headers: { Cookie: cookie } });
      expect((await res2.json()).id).toBe("idle-2");
    } finally {
      vi.useRealTimers();
    }
  });

  it("expires at createdAt + maxAge by default (no autoReseal)", async () => {
    const t0 = Date.parse("2030-01-01T00:00:00Z");
    vi.useFakeTimers({ toFake: ["Date"], now: t0 });
    try {
      let idCtr = 0;
      const config: SessionConfig = {
        name: "h3-hard",
        password: sessionConfig.password,
        maxAge: 60,
        generateId: () => `hard-${++idCtr}`,
      };
      t.app.get("/hard-expiry", async (event) => {
        const session = await useSession(event, config);
        return { id: session.id };
      });

      const res1 = await t.fetch("/hard-expiry");
      expect((await res1.json()).id).toBe("hard-1");
      const cookie = res1.headers.getSetCookie().find((c) => c.startsWith("h3-hard="))!;

      // Still valid just before the hard limit, no reseal happens
      vi.setSystemTime(t0 + 59_000);
      const res2 = await t.fetch("/hard-expiry", { headers: { Cookie: cookie } });
      expect((await res2.json()).id).toBe("hard-1");
      expect(res2.headers.getSetCookie()).toHaveLength(0);

      // Hard-expired at createdAt + maxAge, even though recently active
      vi.setSystemTime(t0 + 61_000);
      const res3 = await t.fetch("/hard-expiry", { headers: { Cookie: cookie } });
      expect((await res3.json()).id).toBe("hard-2");
    } finally {
      vi.useRealTimers();
    }
  });

  it("stores large data in chunks", async () => {
    const token = Array.from({ length: 5000 /* ~4k + one more */ }).fill("x").join("");
    const res = await t.fetch("/", {
      method: "POST",
      headers: { Cookie: cookie },
      body: JSON.stringify({ token }),
    });

    const cookies = res.headers.getSetCookie();
    const cookieNames = cookies.map((c) => c.split("=")[0]);
    expect(cookieNames.length).toBe(3 /* head + 2 */);
    expect(cookieNames).toMatchObject(["h3-test", "h3-test.1", "h3-test.2"]);

    const body = await res.json();
    expect(body.session.data.token).toBe(token);
  });
});
