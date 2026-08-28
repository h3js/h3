import type { SessionConfig } from "../src/utils/session.ts";
import { beforeEach, vi } from "vitest";
import { useSession, getSession, clearSession, readBody, H3, HTTPError } from "../src/index.ts";
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

  it("does not write session cookie when autoCreate is false until updated", async () => {
    t.app.get("/read-only-session", async (event) => {
      const session = await getSession(event, {
        ...sessionConfig,
        autoCreate: false,
      });
      return { id: session.id, data: session.data };
    });

    const res1 = await t.fetch("/read-only-session");
    expect(res1.headers.getSetCookie()).toHaveLength(0);
    expect(await res1.json()).toMatchObject({ data: {} });

    t.app.post("/write-session", async (event) => {
      const session = await useSession(event, {
        ...sessionConfig,
        autoCreate: false,
      });
      await session.update({ user: "alice" });
      return { ok: true };
    });

    const res2 = await t.fetch("/write-session", { method: "POST" });
    expect(res2.headers.getSetCookie()).toHaveLength(1);
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

  it("idleTimeout slides expiration for active sessions", async () => {
    const t0 = Date.parse("2030-01-01T00:00:00Z");
    vi.useFakeTimers({ toFake: ["Date"], now: t0 });
    try {
      let idCtr = 0;
      const config: SessionConfig = {
        name: "h3-idle",
        password: sessionConfig.password,
        idleTimeout: 60,
        generateId: () => `idle-${++idCtr}`,
      };
      t.app.get("/idle", async (event) => {
        const session = await useSession(event, config);
        await session.update((data) => ({ hits: (data.hits || 0) + 1 }));
        return { id: session.id, data: session.data };
      });
      const idleCookie = (res: Response) =>
        res.headers.getSetCookie().find((c) => c.startsWith("h3-idle="));

      // t=0: new session
      const res1 = await t.fetch("/idle");
      expect((await res1.json()).id).toBe("idle-1");
      let cookie = idleCookie(res1)!;

      // t=45s: active request keeps the session and slides the cookie expiry
      vi.setSystemTime(t0 + 45_000);
      const res2 = await t.fetch("/idle", { headers: { Cookie: cookie } });
      expect(await res2.json()).toMatchObject({ id: "idle-1", data: { hits: 2 } });
      const resealed = idleCookie(res2);
      expect(resealed).toBeDefined();
      expect(resealed).toContain(`Expires=${new Date(t0 + 45_000 + 60_000).toUTCString()}`);
      cookie = resealed!;

      // t=90s: past createdAt + idleTimeout, but only 45s idle — the session and
      // its data survive the reseals
      vi.setSystemTime(t0 + 90_000);
      const res3 = await t.fetch("/idle", { headers: { Cookie: cookie } });
      expect(await res3.json()).toMatchObject({ id: "idle-1", data: { hits: 3 } });
    } finally {
      vi.useRealTimers();
    }
  });

  it("idleTimeout expires sessions after exactly idleTimeout of inactivity", async () => {
    const t0 = Date.parse("2030-01-01T00:00:00Z");
    vi.useFakeTimers({ toFake: ["Date"], now: t0 });
    try {
      let idCtr = 0;
      const config: SessionConfig = {
        name: "h3-idle-exp",
        password: sessionConfig.password,
        idleTimeout: 60,
        generateId: () => `exp-${++idCtr}`,
      };
      t.app.get("/idle-expiry", async (event) => {
        const session = await useSession(event, config);
        return { id: session.id };
      });

      const res1 = await t.fetch("/idle-expiry");
      expect((await res1.json()).id).toBe("exp-1");
      const cookie = res1.headers.getSetCookie().find((c) => c.startsWith("h3-idle-exp="))!;

      // No clock-skew slack: still alive at 59s of inactivity
      vi.setSystemTime(t0 + 59_000);
      const res2 = await t.fetch("/idle-expiry", { headers: { Cookie: cookie } });
      expect((await res2.json()).id).toBe("exp-1");

      // ...and reset at 61s, measured from the original cookie's reseal time
      vi.setSystemTime(t0 + 61_000);
      const res3 = await t.fetch("/idle-expiry", { headers: { Cookie: cookie } });
      expect((await res3.json()).id).toBe("exp-2");
    } finally {
      vi.useRealTimers();
    }
  });

  it("maxAge caps a sliding session", async () => {
    const t0 = Date.parse("2030-01-01T00:00:00Z");
    vi.useFakeTimers({ toFake: ["Date"], now: t0 });
    try {
      let idCtr = 0;
      const config: SessionConfig = {
        name: "h3-both",
        password: sessionConfig.password,
        maxAge: 120,
        idleTimeout: 60,
        generateId: () => `both-${++idCtr}`,
      };
      t.app.get("/both", async (event) => {
        const session = await useSession(event, config);
        return { id: session.id };
      });
      const bothCookie = (res: Response) =>
        res.headers.getSetCookie().find((c) => c.startsWith("h3-both="))!;

      const res1 = await t.fetch("/both");
      expect((await res1.json()).id).toBe("both-1");
      let cookie = bothCookie(res1);

      // t=45s: idle window (t+60s) runs out before the absolute cap (t0+120s)
      vi.setSystemTime(t0 + 45_000);
      const res2 = await t.fetch("/both", { headers: { Cookie: cookie } });
      expect((await res2.json()).id).toBe("both-1");
      cookie = bothCookie(res2);
      expect(cookie).toContain(`Expires=${new Date(t0 + 105_000).toUTCString()}`);

      // t=90s: now the absolute cap is the earlier of the two, so it wins
      vi.setSystemTime(t0 + 90_000);
      const res3 = await t.fetch("/both", { headers: { Cookie: cookie } });
      expect((await res3.json()).id).toBe("both-1");
      cookie = bothCookie(res3);
      expect(cookie).toContain(`Expires=${new Date(t0 + 120_000).toUTCString()}`);

      // t=121s: only 31s idle, but past createdAt + maxAge — session resets
      vi.setSystemTime(t0 + 121_000);
      const res4 = await t.fetch("/both", { headers: { Cookie: cookie } });
      expect((await res4.json()).id).toBe("both-2");
    } finally {
      vi.useRealTimers();
    }
  });

  it("idleTimeout keeps hard expiration for header-carried sessions", async () => {
    const t0 = Date.parse("2030-01-01T00:00:00Z");
    vi.useFakeTimers({ toFake: ["Date"], now: t0 });
    try {
      let idCtr = 0;
      const config: SessionConfig = {
        name: "h3-idleh",
        password: sessionConfig.password,
        idleTimeout: 60,
        generateId: () => `idleh-${++idCtr}`,
      };
      t.app.get("/idle-header", async (event) => {
        const session = await useSession(event, config);
        return { id: session.id };
      });

      const res1 = await t.fetch("/idle-header");
      expect((await res1.json()).id).toBe("idleh-1");
      const setCookie = res1.headers.getSetCookie().find((c) => c.startsWith("h3-idleh="))!;
      const sealed = decodeURIComponent(setCookie.match(/h3-idleh=([^;]+)/)![1]);

      // t=90s: header seals are never resealed, so their `lastSeenAt` stays
      // pinned to when the seal was issued and the window cannot slide
      vi.setSystemTime(t0 + 90_000);
      const res2 = await t.fetch("/idle-header", {
        headers: { "x-h3-idleh-session": sealed },
      });
      expect((await res2.json()).id).toBe("idleh-2");
    } finally {
      vi.useRealTimers();
    }
  });

  it("idleTimeout expiration does not depend on the seal ttl", async () => {
    const t0 = Date.parse("2030-01-01T00:00:00Z");
    vi.useFakeTimers({ toFake: ["Date"], now: t0 });
    try {
      let idCtr = 0;
      const config: SessionConfig = {
        name: "h3-idle-seal",
        password: sessionConfig.password,
        idleTimeout: 60,
        generateId: () => `seal-${++idCtr}`,
        // `SealOptions` has no optional fields, so any override carries a `ttl`.
        // Expiration must not rely on it
        seal: { ...sealDefaults, ttl: 0 },
      };
      t.app.get("/idle-seal", async (event) => {
        const session = await useSession(event, config);
        return { id: session.id };
      });

      const res1 = await t.fetch("/idle-seal");
      expect((await res1.json()).id).toBe("seal-1");
      const cookie = res1.headers.getSetCookie().find((c) => c.startsWith("h3-idle-seal="))!;

      vi.setSystemTime(t0 + 61_000);
      const res2 = await t.fetch("/idle-seal", { headers: { Cookie: cookie } });
      expect((await res2.json()).id).toBe("seal-2");
    } finally {
      vi.useRealTimers();
    }
  });

  it("expires at createdAt + maxAge by default (no idleTimeout)", async () => {
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

  it("throttles idleTimeout reseals to once per half window", async () => {
    const t0 = Date.parse("2030-01-01T00:00:00Z");
    vi.useFakeTimers({ toFake: ["Date"], now: t0 });
    // Every seal runs exactly one `subtle.encrypt` (see `iron-crypto.ts`)
    const encrypt = vi.spyOn(globalThis.crypto.subtle, "encrypt");
    try {
      const config: SessionConfig = {
        name: "h3-throttle",
        password: sessionConfig.password,
        idleTimeout: 60,
      };
      t.app.get("/throttle", async (event) => {
        const session = await useSession(event, config);
        return { hits: session.data.hits || 0 };
      });
      t.app.get("/throttle-write", async (event) => {
        const session = await useSession(event, config);
        await session.update((data) => ({ hits: (data.hits || 0) + 1 }));
        return { hits: session.data.hits };
      });
      const throttleCookie = (res: Response) =>
        res.headers.getSetCookie().find((c) => c.startsWith("h3-throttle="));

      // t=0: new session, sealed once
      const res1 = await t.fetch("/throttle");
      expect(encrypt).toHaveBeenCalledTimes(1);
      let cookie = throttleCookie(res1)!;
      expect(cookie).toContain(`Expires=${new Date(t0 + 60_000).toUTCString()}`);

      // t=10s: less than half the window is used, so reading does not reseal —
      // and sets no cookie at all, leaving the response cacheable
      vi.setSystemTime(t0 + 10_000);
      encrypt.mockClear();
      const res2 = await t.fetch("/throttle", { headers: { Cookie: cookie } });
      expect(await res2.json()).toMatchObject({ hits: 0 });
      expect(encrypt).not.toHaveBeenCalled();
      expect(throttleCookie(res2)).toBeUndefined();

      // t=10s: a write seals once — not once to slide and again for the update —
      // and slides the window as a side effect of restamping `lastSeenAt`
      encrypt.mockClear();
      const res3 = await t.fetch("/throttle-write", { headers: { Cookie: cookie } });
      expect(await res3.json()).toMatchObject({ hits: 1 });
      expect(encrypt).toHaveBeenCalledTimes(1);
      cookie = throttleCookie(res3)!;
      expect(cookie).toContain(`Expires=${new Date(t0 + 70_000).toUTCString()}`);

      // t=45s: 35s of the window used, so reading reseals and slides
      vi.setSystemTime(t0 + 45_000);
      encrypt.mockClear();
      const res4 = await t.fetch("/throttle", { headers: { Cookie: cookie } });
      expect(await res4.json()).toMatchObject({ hits: 1 });
      expect(encrypt).toHaveBeenCalledTimes(1);
      cookie = throttleCookie(res4)!;
      expect(cookie).toContain(`Expires=${new Date(t0 + 105_000).toUTCString()}`);

      // t=100s: 55s idle since that reseal, so the session is still alive
      vi.setSystemTime(t0 + 100_000);
      const res5 = await t.fetch("/throttle", { headers: { Cookie: cookie } });
      expect(await res5.json()).toMatchObject({ hits: 1 });
    } finally {
      encrypt.mockRestore();
      vi.useRealTimers();
    }
  });

  it("signs out an idle session between half of idleTimeout and idleTimeout", async () => {
    const t0 = Date.parse("2030-01-01T00:00:00Z");
    vi.useFakeTimers({ toFake: ["Date"], now: t0 });
    try {
      let idCtr = 0;
      const config: SessionConfig = {
        name: "h3-floor",
        password: sessionConfig.password,
        idleTimeout: 60,
        generateId: () => `floor-${++idCtr}`,
      };
      t.app.get("/floor", async (event) => {
        const session = await useSession(event, config);
        return { id: session.id };
      });

      const res1 = await t.fetch("/floor");
      expect((await res1.json()).id).toBe("floor-1");
      const cookie = res1.headers.getSetCookie().find((c) => c.startsWith("h3-floor="))!;

      // t=29s: the last request the window is not slid on, so the session now
      // expires at t=89s — 60s after its seal, but only 31s after this request
      vi.setSystemTime(t0 + 29_000);
      const res2 = await t.fetch("/floor", { headers: { Cookie: cookie } });
      expect((await res2.json()).id).toBe("floor-1");
      expect(res2.headers.getSetCookie().find((c) => c.startsWith("h3-floor="))).toBeUndefined();

      vi.setSystemTime(t0 + 61_000);
      const res3 = await t.fetch("/floor", { headers: { Cookie: cookie } });
      expect((await res3.json()).id).toBe("floor-2");
    } finally {
      vi.useRealTimers();
    }
  });

  it("applies the session cookie to error responses", async () => {
    let idCtr = 0;
    const config: SessionConfig = {
      name: "h3-err",
      password: sessionConfig.password,
      generateId: () => `err-${++idCtr}`,
    };
    t.app.get("/err", async (event) => {
      const session = await useSession(event, config);
      throw new HTTPError({ status: 401, data: { id: session.id } });
    });
    t.app.get("/err-ok", async (event) => {
      const session = await useSession(event, config);
      return { id: session.id };
    });

    // A session created during a request that throws is still persisted
    const res1 = await t.fetch("/err");
    expect(res1.status).toBe(401);
    const cookie = res1.headers.getSetCookie().find((c) => c.startsWith("h3-err="));
    expect(cookie).toBeDefined();

    const res2 = await t.fetch("/err-ok", { headers: { Cookie: cookie! } });
    expect((await res2.json()).id).toBe("err-1");
  });

  it("slides idleTimeout on error responses", async () => {
    const t0 = Date.parse("2030-01-01T00:00:00Z");
    vi.useFakeTimers({ toFake: ["Date"], now: t0 });
    try {
      let idCtr = 0;
      const config: SessionConfig = {
        name: "h3-idle-err",
        password: sessionConfig.password,
        idleTimeout: 60,
        generateId: () => `idleerr-${++idCtr}`,
      };
      t.app.get("/idle-err", async (event) => {
        await useSession(event, config);
        throw new HTTPError({ status: 400 });
      });
      t.app.get("/idle-err-ok", async (event) => {
        const session = await useSession(event, config);
        return { id: session.id };
      });
      const idleCookie = (res: Response) =>
        res.headers.getSetCookie().find((c) => c.startsWith("h3-idle-err="))!;

      const res1 = await t.fetch("/idle-err-ok");
      expect((await res1.json()).id).toBe("idleerr-1");
      let cookie = idleCookie(res1);

      // t=45s: the request errors, but the reseal still reaches the client
      vi.setSystemTime(t0 + 45_000);
      const res2 = await t.fetch("/idle-err", { headers: { Cookie: cookie } });
      expect(res2.status).toBe(400);
      expect(idleCookie(res2)).toContain(`Expires=${new Date(t0 + 105_000).toUTCString()}`);
      cookie = idleCookie(res2);

      // t=90s: 45s idle since the errored request, so the session survives
      vi.setSystemTime(t0 + 90_000);
      const res3 = await t.fetch("/idle-err-ok", { headers: { Cookie: cookie } });
      expect((await res3.json()).id).toBe("idleerr-1");
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not resurrect a cleared session on an error response", async () => {
    const t0 = Date.parse("2030-01-01T00:00:00Z");
    vi.useFakeTimers({ toFake: ["Date"], now: t0 });
    try {
      let idCtr = 0;
      const config: SessionConfig = {
        name: "h3-clear-err",
        password: sessionConfig.password,
        idleTimeout: 60,
        generateId: () => `clr-${++idCtr}`,
      };
      t.app.get("/clear-err", async (event) => {
        await useSession(event, config);
        await clearSession(event, config);
        throw new HTTPError({ status: 403 });
      });
      t.app.get("/clear-err-ok", async (event) => {
        const session = await useSession(event, config);
        return { id: session.id };
      });

      const res1 = await t.fetch("/clear-err-ok");
      const cookie = res1.headers.getSetCookie().find((c) => c.startsWith("h3-clear-err="))!;

      // t=45s: past the reseal threshold, so `getSession` slides the window — and
      // that reseal must not outlive the clear
      vi.setSystemTime(t0 + 45_000);
      const res2 = await t.fetch("/clear-err", { headers: { Cookie: cookie } });
      expect(res2.status).toBe(403);
      const cleared = res2.headers.getSetCookie().filter((c) => c.startsWith("h3-clear-err="));
      expect(cleared).toHaveLength(1);
      expect(cleared[0]).toContain("Max-Age=0");
    } finally {
      vi.useRealTimers();
    }
  });

  it("applies every chunk of a chunked session cookie to error responses", async () => {
    const t0 = Date.parse("2030-01-01T00:00:00Z");
    vi.useFakeTimers({ toFake: ["Date"], now: t0 });
    try {
      const config: SessionConfig = {
        name: "h3-chunk-err",
        password: sessionConfig.password,
        idleTimeout: 60,
      };
      const big = "x".repeat(5000);
      t.app.get("/chunk-err-ok", async (event) => {
        const session = await useSession(event, config);
        await session.update({ big });
        return "ok";
      });
      t.app.get("/chunk-err", async (event) => {
        await useSession(event, config);
        throw new HTTPError({ status: 418 });
      });

      const res1 = await t.fetch("/chunk-err-ok");
      const setCookies = res1.headers.getSetCookie();
      expect(setCookies.length).toBeGreaterThan(1);
      const cookieHeader = setCookies.map((c) => c.split(";")[0]).join("; ");

      // t=45s: past the reseal threshold, so the errored request reseals
      vi.setSystemTime(t0 + 45_000);
      const res2 = await t.fetch("/chunk-err", { headers: { Cookie: cookieHeader } });
      expect(res2.status).toBe(418);
      expect(
        res2.headers
          .getSetCookie()
          .map((c) => c.split("=")[0])
          .sort(),
      ).toEqual(setCookies.map((c) => c.split("=")[0]).sort());
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
