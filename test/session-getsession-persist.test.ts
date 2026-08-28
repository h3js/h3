import type { SessionConfig } from "../src/utils/session.ts";
import { getSession, updateSession } from "../src/index.ts";
import { describeMatrix } from "./_setup.ts";

describeMatrix("session getSession persist", (t, { it, expect }) => {
  const sessionConfig: SessionConfig = {
    name: "h3-get-test",
    password: "1234567123456712345671234567123456712345671234567",
  };

  it("getSession does not set a cookie for a brand-new empty session", async () => {
    t.app.get("/peek", async (event) => {
      const session = await getSession(event, sessionConfig);
      return { id: session.id, data: session.data };
    });

    const result = await t.fetch("/peek");
    expect(result.headers.getSetCookie()).toHaveLength(0);
    const body = await result.json();
    expect(body.id).toBeTruthy();
    expect(body.data).toEqual({});
  });

  it("updateSession persists after a read-only getSession", async () => {
    t.app.get("/login", async (event) => {
      await getSession(event, sessionConfig);
      const session = await updateSession(event, sessionConfig, { user: "alice" });
      return { id: session.id, data: session.data };
    });

    const result = await t.fetch("/login");
    expect(result.headers.getSetCookie()).toHaveLength(1);
    expect(result.headers.getSetCookie()[0]).toContain("h3-get-test=");
    const body = await result.json();
    expect(body.id).toBeTruthy();
    expect(body.data).toEqual({ user: "alice" });
  });
});
