import { describe, expect, it } from "vitest";
import { H3 } from "../../src/h3.ts";
import { defineHandler } from "../../src/handler.ts";

describe("meta", () => {
  it("route meta accessible from context", async () => {
    const app = new H3().get(
      "/",
      defineHandler({
        handler: (event) => event.context.matchedRoute?.meta,
        meta: { fromHandler: true },
      }),
      { meta: { registerMeta: true } },
    );
    expect(await app.fetch("/").then((res) => res.json())).toMatchObject({
      fromHandler: true,
      registerMeta: true,
    });
  });
});
