import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("h3 CLI docs", () => {
  it("opens https://h3.dev instead of bundled docs", () => {
    const binContent = readFileSync(new URL("../../bin/h3.mjs", import.meta.url), "utf8");
    expect(binContent).toMatch(/["']https:\/\/h3\.dev\/["']/);
    expect(binContent).not.toMatch(/dist\/docs/);
    expect(binContent).not.toMatch(/mdzilla/);
  });
});
