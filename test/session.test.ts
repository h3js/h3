import type { SessionConfig } from "../src/utils/session.ts";
import { beforeEach } from "vitest";
import { useSession, readBody, H3 } from "../src/index.ts";
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

  it.only("stores large data in chunks", async () => {
    const token = Array.from({ length: 5000 /* ~4k + one more */ })
      .fill("x")
      .join("");
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
    expect(body.data.token).toBe(token);
  });
});
