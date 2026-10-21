#!/usr/bin/env node
import { spawn } from "node:child_process";
import { main } from "srvx/cli";
import meta from "../package.json" with { type: "json" };

// Docs
if (process.argv[2] === "docs") {
  const page = (process.argv[3] || "").replace(/^\/+/, "");
  const url = new URL(page, "https://h3.dev/");
  // Only open h3.dev pages (blocks absolute, file:, javascript:, //host, \\host, ...)
  if (url.origin !== "https://h3.dev") {
    console.error(`Invalid docs page: ${JSON.stringify(page)}`);
    process.exit(1);
  }
  url.username = url.password = "";
  url.pathname = url.pathname.replace(/\/{2,}/g, "/");
  // rundll32 instead of `cmd /c start` so cmd.exe never parses the URL (& | % ...)
  // Absolute path so a rundll32.exe in cwd is never picked up
  const [cmd, ...args] =
    process.platform === "win32"
      ? [
          `${process.env.SystemRoot || "C:\\Windows"}\\System32\\rundll32.exe`,
          "url.dll,FileProtocolHandler",
          url.href,
        ]
      : [process.platform === "darwin" ? "open" : "xdg-open", url.href];
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
