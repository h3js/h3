import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const binPath = fileURLToPath(new URL("../../bin/h3.mjs", import.meta.url));

// Non-existent PATH/SystemRoot so no real browser opener (xdg-open/open/rundll32) can be spawned
const emptyPath = join(tmpdir(), "h3-cli-test-no-such-dir");

function runDocs(page: string) {
  return spawnSync(process.execPath, [binPath, "docs", page], {
    encoding: "utf8",
    timeout: 10_000,
    env: { ...process.env, PATH: emptyPath, Path: emptyPath, SystemRoot: emptyPath },
  });
}

describe("h3 CLI docs", () => {
  it("opens https://h3.dev instead of bundled docs", () => {
    const binContent = readFileSync(binPath, "utf8");
    expect(binContent).toMatch(/["']https:\/\/h3\.dev\/["']/);
    expect(binContent).not.toMatch(/dist\/docs/);
    expect(binContent).not.toMatch(/mdzilla/);
  });

  it.each([
    ["", "https://h3.dev/"],
    ["guide", "https://h3.dev/guide"],
    ["/guide/basics/routing", "https://h3.dev/guide/basics/routing"],
    ["utils/request#getquery", "https://h3.dev/utils/request#getquery"],
    ["https://h3.dev/guide/websocket", "https://h3.dev/guide/websocket"],
    ["..//evil.example", "https://h3.dev/evil.example"],
    ["/\\evil.example", "https://h3.dev/evil.example"],
    ["https://evil.example:pw@h3.dev/x", "https://h3.dev/x"],
    // cmd.exe metacharacters are harmless path chars (rundll32 does not parse them)
    ["x&calc.exe", "https://h3.dev/x&calc.exe"],
    ["%USERNAME%", "https://h3.dev/%USERNAME%"],
  ])("opens h3.dev page %j", (page, expected) => {
    const res = runDocs(page);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain(`Opening ${expected}\n`);
  });

  it.each([
    "https://evil.example/x",
    "https://h3.dev@evil.example/",
    "https://h3.dev.evil.example/",
    "http://h3.dev/",
    " //evil.example",
    "\t//evil.example",
    "\\\\evil.example",
    "file:///etc/passwd",
    "javascript:alert(1)",
    String.raw`C:\Windows\System32\calc.exe`,
  ])("rejects unsafe page %j", (page) => {
    const res = runDocs(page);
    expect(res.status).toBe(1);
    expect(res.stdout).not.toContain("Opening");
    expect(res.stderr).toContain("Invalid docs page");
  });
});
