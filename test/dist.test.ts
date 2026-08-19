import { describe, it, expect, beforeAll } from "vitest";
import { existsSync } from "node:fs";

// Every other test in this suite runs against `src`, so whatever the bundler
// changes on the way to `dist` is invisible to it. That gap shipped a real bug:
// rolldown considers `decodeURI()` pure and deleted the side-effect-only call
// that detected malformed percent-encoding, so the published package answered
// `/foo%` and `/%c0%afadmin` with 200 while `src` answered 400.
//
// These assertions exercise the built output, and deliberately cover behaviour
// that depends on code a bundler could drop as dead.
//
// Requires a prior `pnpm build` — CI builds before running vitest, and so does
// `pnpm release`. Skipped when `dist/` is absent so a bare `vitest` still runs
// on a clean checkout.

const distDir = new URL("../dist/_entries/", import.meta.url);

describe.skipIf(!existsSync(distDir))("built output (dist/)", () => {
  for (const entry of ["generic", "node"]) {
    describe(entry, () => {
      let H3: typeof import("../src/index.ts").H3;
      let HTTPError: typeof import("../src/index.ts").HTTPError;

      beforeAll(async () => {
        ({ H3, HTTPError } = await import(new URL(`${entry}.mjs`, distDir).href));
      });

      // The B1 regression: guard tree-shaken out of the shipped bundle.
      for (const path of ["/foo%", "/bar%2", "/%ZZ", "/%", "/%80", "/%c0%afadmin"]) {
        it(`returns 400 for malformed ${path}`, async () => {
          const app = new H3().all("/**", (event) => event.url.pathname);
          const res = await app.request(path);
          expect(res.status).toBe(400);
        });
      }

      it("canonicalizes needless escapes", async () => {
        const app = new H3().all("/**", (event) => event.url.pathname);
        expect(await (await app.request("/api/%61dmin")).text()).toBe("/api/admin");
        expect(await (await app.request("/a%20b")).text()).toBe("/a%20b");
      });

      it("routes and serializes", async () => {
        const app = new H3().get("/users/:id", (event) => ({ id: event.context.params!.id }));
        const res = await app.request("/users/42");
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ id: "42" });
      });

      it("handles thrown errors", async () => {
        const app = new H3().get("/err", () => {
          throw new HTTPError({ status: 418, message: "teapot" });
        });
        const res = await app.request("/err");
        expect(res.status).toBe(418);
        expect((await res.json()).message).toBe("teapot");
      });
    });
  }
});
