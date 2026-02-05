#!/usr/bin/env node
import { main } from "srvx/cli";

main({
  usage: {
    command: "h3",
    docs: "https://h3.dev",
    issues: "https://github.com/h3js/h3/issues",
  },
});
