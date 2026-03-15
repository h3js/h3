import type { SessionConfig } from "../src/utils/session.ts";
import { beforeEach } from "vitest";
import { useSession, clearSession, readBody, H3 } from "../src/index.ts";
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

  it("supports password rotation", async () => {
    const oldPassword = "old_password_that_is_at_least_32_characters_long!";
    const newPassword = "new_password_that_is_at_least_32_characters_long!";

    // Create session with old password
    const oldConfig: SessionConfig = {
      name: "h3-rotation",
      password: oldPassword,
      generateId: () => "rotation-test",
    };

    t.app.post("/rotate/create", async (event) => {
      const session = await useSession(event, oldConfig);
      await session.update({ secret: "data" });
      return { id: session.id };
    });

    // Read session with rotated passwords (new + old)
    const rotatedConfig: SessionConfig = {
      name: "h3-rotation",
      password: { default: oldPassword, new: newPassword },
      generateId: () => "rotation-test-2",
    };

    t.app.get("/rotate/read", async (event) => {
      const session = await useSession(event, rotatedConfig);
      return { id: session.id, data: session.data };
    });

    // Step 1: Create with old password
    const createRes = await t.fetch("/rotate/create", { method: "POST" });
    const oldCookie = createRes.headers.getSetCookie()[0];
    expect((await createRes.json()).id).toBe("rotation-test");

    // Step 2: Read with rotated config — old password should still unseal
    const readRes = await t.fetch("/rotate/read", {
      headers: { Cookie: oldCookie },
    });
    const readBody = await readRes.json();
    expect(readBody.data.secret).toBe("data");
  });
});
