#!/usr/bin/env node
import { execFileSync, execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { main } from "srvx/cli";
import meta from "../package.json" with { type: "json" };

// Docs
if (process.argv[2] === "docs") {
  const runner = [
    ["bun", "x"],
    ["pnpm", "dlx"],
    ["npm", "x"],
  ].find(([pkg]) => {
    try {
      execSync(`${pkg} -v`, { stdio: "ignore" });
      return true;
    } catch {}
  }) || ["npm", "x"];
  const docsDir = fileURLToPath(new URL("../dist/docs", import.meta.url));
  execFileSync(runner[0], [...runner.slice(1), "mdzilla", docsDir, ...process.argv.slice(3)], {
    stdio: "inherit",
  });
  process.exit(0);
}
if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log("h3 docs [--page <path>] use h3 documentation\n");
}

main({
  meta,
  usage: {
    command: "h3",
    docs: "https://h3.dev",
    issues: "https://github.com/h3js/h3/issues",
  },
});
