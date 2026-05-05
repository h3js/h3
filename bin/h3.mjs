#!/usr/bin/env node
import { execSync } from "node:child_process";
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
  const runnerCmd = [runner[0], runner[1]].filter(Boolean).join(" ");
  const docsDir = new URL("../dist/docs", import.meta.url).pathname;
  const args = process.argv.slice(3).join(" ");
  execSync(`${runnerCmd} mdzilla ${docsDir}${args ? ` ${args}` : ""}`, { stdio: "inherit" });
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
