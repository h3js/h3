import { HTTPError, HTTPResponse, setServerTiming, withServerTiming } from "../src/index.ts";
import { describeMatrix } from "./_setup.ts";

const timingEntries = (res: Response): string[] =>
  res.headers
    .get("server-timing")
    ?.split(",")
    .map((entry) => entry.trim()) ?? [];

describeMatrix("server-timing", (t, { it, expect }) => {
  for (const withOnError of [false, true]) {
    const hook = withOnError ? "with onError" : "without onError";

    it(`keeps each entry once on a success response ${hook}`, async () => {
      if (!withOnError) t.app.config.onError = undefined;
      t.app.use((event) => {
        setServerTiming(event, "mw", { dur: 1 });
      });
      t.app.get("/", (event) => {
        setServerTiming(event, "db", { dur: 2, desc: "Query" });
        return { ok: true };
      });

      const res = await t.fetch("/");
      expect(res.status).toBe(200);
      expect(timingEntries(res)).toEqual(["mw;dur=1", 'db;desc="Query";dur=2']);
    });

    it(`keeps each entry once on a returned success Response ${hook}`, async () => {
      if (!withOnError) t.app.config.onError = undefined;
      t.app.get("/", (event) => {
        setServerTiming(event, "db", { dur: 2 });
        return new Response("ok");
      });

      const res = await t.fetch("/");
      expect(res.status).toBe(200);
      expect(timingEntries(res)).toEqual(["db;dur=2"]);
    });

    it(`sends middleware entries on a thrown HTTPError ${hook}`, async () => {
      if (!withOnError) t.app.config.onError = undefined;
      t.app.use((event) => {
        setServerTiming(event, "mw", { dur: 1 });
      });
      t.app.get("/", (event) => {
        setServerTiming(event, "db", { dur: 2 });
        throw new HTTPError({ status: 503 });
      });

      const res = await t.fetch("/");
      expect(res.status).toBe(503);
      expect(timingEntries(res)).toEqual(["mw;dur=1", "db;dur=2"]);
      expect(t.hooks.onError).toHaveBeenCalledTimes(withOnError ? 1 : 0);
    });

    it(`sends middleware entries on a 404 ${hook}`, async () => {
      if (!withOnError) t.app.config.onError = undefined;
      t.app.use((event) => {
        setServerTiming(event, "mw", { dur: 1 });
      });

      const res = await t.fetch("/missing");
      expect(res.status).toBe(404);
      expect(timingEntries(res)).toEqual(["mw;dur=1"]);
    });

    it(`sends entries on a returned error Response ${hook}`, async () => {
      if (!withOnError) t.app.config.onError = undefined;
      t.app.get("/", (event) => {
        setServerTiming(event, "db", { dur: 2 });
        return new Response("x", { status: 500 });
      });

      const res = await t.fetch("/");
      expect(res.status).toBe(500);
      expect(await res.text()).toBe("x");
      expect(timingEntries(res)).toEqual(["db;dur=2"]);
    });

    it(`sends withServerTiming entries when the measured function throws ${hook}`, async () => {
      if (!withOnError) t.app.config.onError = undefined;
      t.app.get("/", async (event) => {
        await withServerTiming(event, "db", () => {
          throw new HTTPError({ status: 502 });
        });
      });

      const res = await t.fetch("/");
      expect(res.status).toBe(502);
      const entries = timingEntries(res);
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatch(/^db;dur=\d/);
    });

    for (const method of ["GET", "HEAD"]) {
      it(`keeps staged and HTTPError entries on a ${method} error ${hook}`, async () => {
        if (!withOnError) t.app.config.onError = undefined;
        t.app.use((event) => {
          setServerTiming(event, "mw", { dur: 1 });
        });
        t.app.get("/", () => {
          throw new HTTPError({ status: 503, headers: { "server-timing": "own;dur=9" } });
        });

        const res = await t.fetch("/", { method });
        expect(res.status).toBe(503);
        expect(timingEntries(res)).toEqual(["mw;dur=1", "own;dur=9"]);
      });

      it(`keeps staged and Response entries on a ${method} error Response ${hook}`, async () => {
        if (!withOnError) t.app.config.onError = undefined;
        t.app.use((event) => {
          setServerTiming(event, "mw", { dur: 1 });
        });
        t.app.get("/", () => {
          return new Response("x", { status: 500, headers: { "server-timing": "own;dur=9" } });
        });

        const res = await t.fetch("/", { method });
        expect(res.status).toBe(500);
        expect(timingEntries(res)).toEqual(["mw;dur=1", "own;dur=9"]);
      });

      it(`keeps staged and Response entries on a ${method} success Response ${hook}`, async () => {
        if (!withOnError) t.app.config.onError = undefined;
        t.app.use((event) => {
          setServerTiming(event, "mw", { dur: 1 });
        });
        t.app.get("/", () => {
          return new Response("x", { headers: { "server-timing": "own;dur=9" } });
        });

        const res = await t.fetch("/", { method });
        expect(res.status).toBe(200);
        expect(timingEntries(res)).toEqual(["mw;dur=1", "own;dur=9"]);
      });

      it(`keeps staged and HTTPResponse entries on a ${method} response ${hook}`, async () => {
        if (!withOnError) t.app.config.onError = undefined;
        t.app.use((event) => {
          setServerTiming(event, "mw", { dur: 1 });
        });
        t.app.get("/", () => {
          return new HTTPResponse("x", { headers: { "server-timing": "own;dur=9" } });
        });

        const res = await t.fetch("/", { method });
        expect(res.status).toBe(200);
        expect(timingEntries(res)).toEqual(["mw;dur=1", "own;dur=9"]);
      });
    }
  }

  it("keeps staged and HTTPError entries once when onError returns nothing", async () => {
    t.app.use((event) => {
      setServerTiming(event, "mw", { dur: 1 });
    });
    t.app.get("/", () => {
      throw new HTTPError({ status: 503, headers: { "server-timing": "own;dur=9" } });
    });

    const res = await t.fetch("/");
    expect(t.hooks.onError).toHaveBeenCalledTimes(1);
    expect(timingEntries(res)).toEqual(["mw;dur=1", "own;dur=9"]);
  });

  it("sends entries set by the onError hook", async () => {
    t.hooks.onError.mockImplementation((_error, event) => {
      setServerTiming(event, "onerror");
    });
    t.app.use((event) => {
      setServerTiming(event, "mw", { dur: 1 });
    });
    t.app.get("/", () => {
      throw new HTTPError({ status: 503 });
    });

    const res = await t.fetch("/");
    expect(res.status).toBe(503);
    expect(timingEntries(res)).toEqual(["mw;dur=1", "onerror"]);
  });
});
