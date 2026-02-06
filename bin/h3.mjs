#!/usr/bin/env node
import { main } from "srvx/cli";
import meta from "../package.json" with { type: "json" };

main({
  meta,
  usage: {
    command: "h3",
    docs: "https://h3.dev",
    issues: "https://github.com/h3js/h3/issues",
  },
});
