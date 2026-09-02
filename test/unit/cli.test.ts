import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

describe("h3 CLI docs", () => {
  it("resolves docs directory to valid filesystem path instead of URL pathname", () => {
    const binContent = readFileSync(new URL("../../bin/h3.mjs", import.meta.url), "utf8");
    expect(binContent).toMatch(
      /fileURLToPath\(new URL\(['"]\.\.\/dist\/docs['"], import\.meta\.url\)\)/,
    );
    expect(binContent).toMatch(/`\${runnerCmd} mdzilla "\${docsDir}"/);
  });

  it("fileURLToPath correctly handles spaces and special characters compared to URL.pathname", () => {
    const sampleUrl = new URL("file:///path%20with%20spaces/docs");
    expect(sampleUrl.pathname).toBe("/path%20with%20spaces/docs");
    expect(fileURLToPath(sampleUrl)).toBe("/path with spaces/docs");
  });
});
