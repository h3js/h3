import { bench, run, summary } from "mitata";
import * as h3 from "../../src/index.ts";
// import * as h3Nightly from "h3-nightly";

// Create a random string
// prettier-ignore
const randomStr = Array.from({length: 1024}).map(() => String.fromCodePoint(Math.floor(Math.random() * 94) + 33)).join('');

// Implement the session benchmark
const password = "some_not_random_password_that_is_also_long_enough";
const apps = (
  [
    ["h3", h3],
    // ["h3-nightly", h3Nightly],
  ] as const
).map(([name, lib]) => {
  return [
    name,
    new lib.H3({ debug: true }).get("/", async (event: any) => {
      const session = await lib.useSession(event, { password });
      await session.update((data) => {
        data.ctr = (data.ctr || 0) + 1;
        data.str = randomStr;
      });
      return {
        id: session.id,
        ctr: session.data.ctr,
      };
    }).fetch,
  ] as const;
});

// Quick test
for (const [name, _fetch] of apps) {
  for (let i = 0; i < 128; i++) {
    const res = await _fetch("/");
    const cookie = res.headers.getSetCookie()[0] || "";
    const session1 = await res.json();
    const res2 = await _fetch("/", {
      headers: {
        cookie,
      },
    });
    const session2 = await res2.json();
    if (session1.id !== session2.id) {
      throw new Error(`Session ID should be the same (${name})`);
    }
  }
}

summary(async () => {
  for (const [name, _fetch] of apps) {
    bench(name, async () => {
      const res = await _fetch("/");
      const cookie = res.headers.getSetCookie()[0] || "";
      await _fetch("/", {
        headers: {
          cookie,
        },
      });
    });
  }
});

await run();
