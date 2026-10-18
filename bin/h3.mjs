#!/usr/bin/env node
import { spawn } from "node:child_process";
import { main } from "srvx/cli";
import meta from "../package.json" with { type: "json" };

// Docs
if (process.argv[2] === "docs") {
  const page = (process.argv[3] || "").replace(/^\/+/, "");
  const url = new URL(page, "https://h3.dev/").href;
  const [cmd, ...args] =
    process.platform === "win32"
      ? ["cmd", "/c", "start", "", url]
      : [process.platform === "darwin" ? "open" : "xdg-open", url];
  console.log(`Opening ${url}`);
  spawn(cmd, args, { stdio: "ignore", detached: true })
    .on("error", () => console.log(`Open ${url} in your browser.`))
    .unref();
} else {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log("h3 docs [page]  open h3 documentation (https://h3.dev)\n");
  }

  main({
    meta,
    usage: {
      command: "h3",
      docs: "https://h3.dev",
      issues: "https://github.com/h3js/h3/issues",
    },
  });
}
