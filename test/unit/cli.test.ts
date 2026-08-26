import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("CLI docs path resolution", () => {
  it("resolves docs directory using fileURLToPath instead of URL.pathname", () => {
    const cliSource = readFileSync(new URL("../../bin/h3.mjs", import.meta.url), "utf8");
    expect(cliSource).toContain("fileURLToPath(new URL(\"../dist/docs\", import.meta.url))");
  });

  it("handles paths with spaces when using fileURLToPath", () => {
    const importMetaUrl = "file:///path%20with%20spaces/bin/h3.mjs";
    const docsDir = fileURLToPath(new URL("../dist/docs", importMetaUrl));
    expect(docsDir).toBe("/path with spaces/dist/docs");
  });
});
